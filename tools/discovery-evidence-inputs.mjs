import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOperationContextLedger,
  loadBundledSpecification,
} from "./spec-quality-lib.mjs";
import {
  captureRecipesByTitle,
  coverageOverlayByTitle,
  crawlMetadataByTitle,
} from "./portal-discovery-metadata.mjs";
import { collectionDefinitions } from "./postman-collection-definitions.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const methods = new Set(["get", "put", "post", "patch", "delete", "head", "options", "trace"]);
const sourceRegistry = [
  ["operation-live-capture-ledger", "src/generated/operationLiveCaptureLedger.json", true],
  ["operation-context-ledger", "src/generated/operationContextLedger.json", true],
  ["portal-coverage-ledger", "src/generated/portalCoverageLedger.json", true],
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort(lexicalCompare).map((key) => [key, canonical(value[key])]));
}

export function stableJson(value, space = 0) {
  return `${JSON.stringify(canonical(value), null, space)}\n`;
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function posix(relativePath) {
  return relativePath.replaceAll("\\", "/");
}

function provenanceClass(provenance = []) {
  const sources = provenance.map((entry) => String(entry?.source ?? "").toLowerCase());
  if (sources.some((source) => source.includes("live") || source.includes("authenticated"))) return "live";
  if (sources.some((source) => source.includes("bundle") || source.includes("static"))) return "static";
  return sources.length > 0 ? "documented" : "unspecified";
}

function operationRecord(specId, sourceKind, sourcePath, operation, status, provenance = []) {
  return {
    specId, sourceKind, sourcePath, status,
    provenance: provenanceClass(provenance),
    ...(operation.method ? { method: operation.method } : {}),
    ...(operation.path ? { path: operation.path } : {}),
    ...(operation.operationId ? { operationId: operation.operationId } : {}),
  };
}

async function readJsonSource(root, [kind, relativePath, optional], errors) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return optional ? { kind, path: posix(relativePath), missing: true } : [];
  try {
    const value = JSON.parse(await readFile(absolutePath, "utf8"));
    if (!Array.isArray(value)) throw new Error("top level must be an array");
    return { kind, path: posix(relativePath), value };
  } catch (error) {
    errors.push({ sourceKind: kind, sourcePath: posix(relativePath), message: error.message });
    return null;
  }
}

async function inventory(root) {
  const portfolioPath = "tools/portal-discovery-portfolio.json";
  const portfolio = JSON.parse(await readFile(path.join(root, portfolioPath), "utf8"));
  if (!Array.isArray(portfolio.portals)) throw new Error(`${portfolioPath}: portals must be an array`);
  const ids = portfolio.portals.map(({ specId }) => specId);
  if (ids.length !== 20 || new Set(ids).size !== 20) throw new Error(`${portfolioPath}: expected exactly 20 unique spec IDs`);
  const directories = (await readdir(path.join(root, "specifications"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("nodoc-"))
    .map((entry) => entry.name.slice(6)).sort(lexicalCompare);
  const sortedIds = [...ids].sort(lexicalCompare);
  if (stableJson(directories) !== stableJson(sortedIds)) throw new Error("portfolio and bundled specification inventories differ");
  return { ids: sortedIds, portfolio, portfolioPath };
}

export async function getCanonicalSpecIds(options = {}) {
  return (await inventory(options.repoRoot ?? repoRoot)).ids;
}

function contextRecords(specId, sourceKind, sourcePath, entry) {
  return (entry?.operations ?? []).map((operation) => {
    const provenance = operation.operationContext?.provenance ?? [];
    return operationRecord(
      specId, sourceKind, sourcePath, operation,
      provenanceClass(provenance) === "live" ? "observed" : "unknown",
      provenance,
    );
  });
}

export async function buildEvidence(specId, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const { ids } = await inventory(root);
  if (!ids.includes(specId)) throw new Error(`Unknown spec ID: ${specId}`);
  const errors = [];
  const sources = (await Promise.all(sourceRegistry.map((source) => readJsonSource(root, source, errors)))).filter(Boolean);
  const records = [];
  for (const source of sources) {
    if (source.missing) {
      records.push({ specId, sourceKind: source.kind, sourcePath: source.path, status: "unknown", provenance: "unspecified" });
      continue;
    }
    const entry = source.value.find((item) => item?.specId === specId);
    if (source.kind === "operation-live-capture-ledger") {
      records.push(...(entry?.operations ?? []).map((operation) => operationRecord(specId, source.kind, source.path, operation, "observed", [{ source: "live-capture" }])));
      if (!entry) records.push({ specId, sourceKind: source.kind, sourcePath: source.path, status: "unknown", provenance: "unspecified" });
    } else if (source.kind === "operation-context-ledger") {
      records.push(...contextRecords(specId, source.kind, source.path, entry));
      if (!entry) records.push({ specId, sourceKind: source.kind, sourcePath: source.path, status: "unknown", provenance: "unspecified" });
    } else if (entry) {
      for (const route of entry.promotedDiscoveries ?? []) records.push(operationRecord(specId, source.kind, source.path, route, "observed", [{ source: "portal-coverage" }]));
      for (const gap of entry.openGaps ?? []) records.push({ specId, sourceKind: source.kind, sourcePath: source.path, status: "notObserved", provenance: "documented", detail: gap });
      if ((entry.observedHosts ?? []).length === 0 && (entry.promotedDiscoveries ?? []).length === 0 && (entry.openGaps ?? []).length === 0) {
        records.push({ specId, sourceKind: source.kind, sourcePath: source.path, status: "unknown", provenance: "unspecified" });
      }
    }
  }
  if (root === repoRoot) {
    const bundledEntry = (await buildOperationContextLedger()).find((entry) => entry.specId === specId);
    records.push(...contextRecords(specId, "bundled-operation-provenance", `specifications/nodoc-${specId}/specification/openapi.yml`, bundledEntry));
  }
  records.sort((a, b) => lexicalCompare(stableJson(a), stableJson(b)));
  errors.sort((a, b) => lexicalCompare(stableJson(a), stableJson(b)));
  return { specId, records, errors };
}

async function fileInput(root, relativePath) {
  return { path: posix(relativePath), sha256: digest(await readFile(path.join(root, relativePath), "utf8")) };
}

function objectInput(relativePath, value) {
  return { path: posix(relativePath), sha256: digest(value) };
}

export async function buildManifest(specId, options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const { ids, portfolio, portfolioPath } = await inventory(root);
  if (!ids.includes(specId)) throw new Error(`Unknown spec ID: ${specId}`);
  const specDirectory = `specifications/nodoc-${specId}/specification`;
  const specification = (await readdir(path.join(root, specDirectory), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => `${specDirectory}/${entry.name}`).sort(lexicalCompare);
  const bundledSpecification = await loadBundledSpecification(path.join(root, specDirectory, "openapi.yml"));
  const categories = { specification: await Promise.all(specification.map((item) => fileInput(root, item))) };
  const definitions = options.collectionDefinitions ?? collectionDefinitions;
  const definition = definitions.find((item) => item.specId === specId);
  if (definition) categories.postman = [objectInput("tools/postman-collection-definitions.mjs", definition)];
  const portfolioEntry = portfolio.portals.find((item) => item.specId === specId);
  const title = definition?.name ?? bundledSpecification.info?.title;
  const metadata = options.discoveryMetadata ?? {
    captureRecipesByTitle, coverageOverlayByTitle, crawlMetadataByTitle,
  };
  categories.discovery = [
    objectInput(portfolioPath, portfolioEntry),
    objectInput("tools/portal-discovery-metadata.mjs", {
      crawl: metadata.crawlMetadataByTitle[title], overlay: metadata.coverageOverlayByTitle[title], recipes: metadata.captureRecipesByTitle[title] ?? [],
    }),
  ];
  const recipes = (metadata.captureRecipesByTitle[title] ?? []).filter((item) => existsSync(path.join(root, item))).sort(lexicalCompare);
  if (recipes.length > 0) categories.recipes = await Promise.all(recipes.map((item) => fileInput(root, item)));
  const evidence = [];
  for (const source of sourceRegistry) {
    const absolutePath = path.join(root, source[1]);
    if (!existsSync(absolutePath)) continue;
    const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
    const entry = parsed.find((item) => item?.specId === specId);
    if (entry) evidence.push(objectInput(source[1], entry));
  }
  if (evidence.length > 0) categories.evidence = evidence;
  for (const entries of Object.values(categories)) entries.sort((a, b) => lexicalCompare(stableJson(a), stableJson(b)));
  const sortedCategories = Object.fromEntries(Object.keys(categories).sort(lexicalCompare).map((name) => [name, categories[name]]));
  const categoryFingerprints = Object.fromEntries(Object.keys(sortedCategories).map((name) => [name, digest(sortedCategories[name])]));
  return { specId, categories: sortedCategories, categoryFingerprints, fingerprint: digest(categoryFingerprints) };
}

export async function inspectDiscoveryInputs(specId, mode = "all", options = {}) {
  if (!new Set(["evidence", "manifest", "all"]).has(mode)) throw new Error(`Unknown mode: ${mode}`);
  return {
    specId, mode,
    ...(mode !== "manifest" ? { evidence: await buildEvidence(specId, options) } : {}),
    ...(mode !== "evidence" ? { manifest: await buildManifest(specId, options) } : {}),
  };
}
