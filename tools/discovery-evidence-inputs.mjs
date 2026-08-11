import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectionDefinitions } from "./postman-collection-definitions.mjs";
import { captureRecipesByTitle } from "./portal-discovery-metadata.mjs";
import { buildSpecRouteInventory, repoRoot as defaultRepoRoot } from "./spec-quality-lib.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const portfolio = JSON.parse(readFileSync(path.join(toolDirectory, "portal-discovery-portfolio.json"), "utf8"));
export const canonicalDiscoverySpecIds = Object.freeze(portfolio.portals.map((entry) => entry.specId).sort());
if (canonicalDiscoverySpecIds.length !== 20 || new Set(canonicalDiscoverySpecIds).size !== 20) {
  throw new Error("The canonical discovery portfolio must define exactly 20 unique spec IDs.");
}

export const authoritativeEvidenceSources = Object.freeze([
  { kind: "operation-live-capture", path: "src/generated/operationLiveCaptureLedger.json" },
  { kind: "operation-context", path: "src/generated/operationContextLedger.json" },
  { kind: "portal-coverage", path: "src/generated/portalCoverageLedger.json" },
]);

const metadataPaths = [
  "tools/portal-discovery-metadata.mjs",
  "tools/portal-discovery-portfolio.json",
];

function portable(value) {
  return value.replaceAll("\\", "/");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestRecords(records) {
  return digestBytes(records.map((record) => `${record.path}\0${record.digest}`).join("\0"));
}

function operationReference(entry) {
  return {
    method: String(entry.method || "").toUpperCase(),
    path: entry.path,
    operationId: entry.operationId ?? null,
  };
}

export function classifyEvidenceProvenance(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (/authenticated|browser|live|network|portal traffic|capture/u.test(normalized)) return "live-capture";
  if (/bundle|static|source declaration|code/u.test(normalized)) return "static-analysis";
  if (/generated|curated|metadata|ledger/u.test(normalized)) return "curated";
  return "unknown";
}

function normalizeSourceRecord(source, entry) {
  if (source.kind === "operation-live-capture") {
    return {
      sourceKind: source.kind,
      sourcePath: source.path,
      semantics: "observed",
      provenance: "live-capture",
      operation: operationReference(entry),
      details: {
        source: entry.source,
        browsedPages: [...(entry.browsedPages ?? [])].sort(),
        additionalPageCount: entry.additionalPageCount ?? 0,
      },
    };
  }
  if (source.kind === "operation-context") {
    const provenance = (entry.operationContext?.provenance ?? []).map((item) => ({
      source: item.source,
      confidence: item.confidence,
      classification: classifyEvidenceProvenance(item.source),
      notes: item.notes ?? [],
    }));
    return {
      sourceKind: source.kind,
      sourcePath: source.path,
      semantics: provenance.some((item) => item.classification === "live-capture") ? "observed" : "unknown",
      provenance: provenance.some((item) => item.classification === "live-capture") ? "live-capture" : "curated",
      operation: operationReference(entry),
      details: { operationContext: entry.operationContext, provenance },
    };
  }
  return {
    sourceKind: source.kind,
    sourcePath: source.path,
    semantics: "observed",
    provenance: "curated",
    operation: entry.method && entry.path ? operationReference(entry) : null,
    details: entry,
  };
}

function validateLedger(kind, parsed) {
  if (!Array.isArray(parsed)) throw new Error(`${kind} must contain a JSON array.`);
  for (const [index, entry] of parsed.entries()) {
    if (!entry || typeof entry !== "object" || typeof entry.specId !== "string") {
      throw new Error(`${kind}[${index}] is missing specId.`);
    }
    if (kind !== "portal-coverage" && !Array.isArray(entry.operations)) {
      throw new Error(`${kind}[${index}] is missing operations.`);
    }
  }
  return parsed;
}

export function parseAuthoritativeEvidenceSource(source, text, specId) {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`${source.path}: invalid JSON (${error.message}).`);
  }
  const ledger = validateLedger(source.kind, parsed);
  const spec = ledger.find((entry) => entry.specId === specId);
  if (!spec) return [];
  if (source.kind === "portal-coverage") {
    return [
      ...(spec.promotedDiscoveries ?? []).map((entry) => normalizeSourceRecord(source, entry)),
      ...(spec.knownTelemetryExclusions ?? []).map((entry) => ({
        ...normalizeSourceRecord(source, entry),
        semantics: "notObserved",
        details: { ...entry, classification: "telemetry-exclusion" },
      })),
    ];
  }
  return spec.operations.map((entry) => normalizeSourceRecord(source, entry));
}

async function readOptional(root, relativePath, overrides) {
  if (overrides?.has(relativePath)) return overrides.get(relativePath);
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function discoverNormalizedEvidence(specId, options = {}) {
  assertCanonicalSpecId(specId);
  const root = options.repoRoot ?? defaultRepoRoot;
  const records = [];
  const sources = [];
  const errors = [];
  for (const source of authoritativeEvidenceSources) {
    const text = await readOptional(root, source.path, options.contentOverrides);
    if (text === null) {
      sources.push({ ...source, present: false, semantics: "unknown", recordCount: 0 });
      continue;
    }
    try {
      const sourceRecords = parseAuthoritativeEvidenceSource(source, text, specId);
      records.push(...sourceRecords);
      sources.push({ ...source, present: true, semantics: sourceRecords.length ? "observed" : "unknown", recordCount: sourceRecords.length });
    } catch (error) {
      errors.push({ sourceKind: source.kind, sourcePath: source.path, message: error.message });
      sources.push({ ...source, present: true, semantics: "unknown", recordCount: 0 });
    }
  }
  const inventory = options.inventory ?? await buildSpecRouteInventory();
  const spec = inventory.find((entry) => entry.specId === specId);
  if (!spec) throw new Error(`Canonical spec ${specId} is missing from the repository inventory.`);
  const specificationSource = { kind: "spec-operation-context", path: spec.specPath };
  const specificationRecords = spec.operations
    .filter((entry) => entry.operationContext)
    .map((entry) => normalizeSourceRecord({ ...specificationSource, kind: "operation-context" }, entry))
    .map((entry) => ({ ...entry, sourceKind: specificationSource.kind, sourcePath: specificationSource.path }));
  records.push(...specificationRecords);
  sources.push({
    ...specificationSource,
    present: true,
    semantics: specificationRecords.length ? "observed" : "unknown",
    recordCount: specificationRecords.length,
  });
  if (errors.length && options.strict !== false) {
    throw new AggregateError(errors.map((entry) => new Error(entry.message)), `Invalid discovery evidence for ${specId}.`);
  }
  records.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return {
    schemaVersion: 1,
    specId,
    semantics: records.some((entry) => entry.semantics === "observed") ? "observed" : "unknown",
    sources,
    records,
    errors,
  };
}

export function assertCanonicalSpecId(specId) {
  if (!canonicalDiscoverySpecIds.includes(specId)) {
    throw new Error(`Unknown discovery spec ID "${specId}".`);
  }
  return specId;
}

async function listSpecFiles(root, specPath) {
  const directory = path.dirname(path.join(root, specPath));
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => portable(path.relative(root, path.join(directory, entry.name))))
    .sort();
}

async function fileRecord(root, relativePath, category, overrides) {
  const text = await readOptional(root, relativePath, overrides);
  if (text === null) throw new Error(`Missing semantic input ${relativePath}.`);
  return {
    path: relativePath,
    category,
    digest: digestBytes(text),
  };
}

export async function buildDiscoveryInputManifest(specId, options = {}) {
  assertCanonicalSpecId(specId);
  const root = options.repoRoot ?? defaultRepoRoot;
  const inventory = options.inventory ?? await buildSpecRouteInventory();
  const spec = inventory.find((entry) => entry.specId === specId);
  if (!spec) throw new Error(`Canonical spec ${specId} is missing from the repository inventory.`);
  const definition = collectionDefinitions.find((entry) => portable(entry.spec) === spec.specPath);
  if (!definition) throw new Error(`Canonical spec ${specId} has no Postman collection definition.`);
  const specFiles = await listSpecFiles(root, spec.specPath);
  const evidence = await discoverNormalizedEvidence(specId, { ...options, repoRoot: root, inventory });
  const presentEvidenceSources = authoritativeEvidenceSources.filter((source) =>
    evidence.sources.some((entry) => entry.kind === source.kind && entry.present));
  const recipePaths = [...(captureRecipesByTitle[spec.title] ?? [])].sort();
  const categories = {
    specification: await Promise.all(specFiles.map((file) => fileRecord(root, file, "specification", options.contentOverrides))),
    collection: [await fileRecord(root, portable(definition.output), "collection", options.contentOverrides)],
    evidence: await Promise.all(presentEvidenceSources.map((source) => fileRecord(root, source.path, "evidence", options.contentOverrides))),
    metadata: await Promise.all(metadataPaths.map((file) => fileRecord(root, file, "metadata", options.contentOverrides))),
    recipe: await Promise.all(recipePaths.map((file) => fileRecord(root, file, "recipe", options.contentOverrides))),
  };
  const componentDigests = Object.fromEntries(Object.entries(categories).map(([category, records]) => [category, digestRecords(records)]));
  const files = Object.values(categories).flat().sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    specId,
    files,
    componentDigests,
    fingerprint: digestBytes(stableJson(componentDigests)),
  };
}

export async function inspectDiscoveryInputs(specId, mode = "all", options = {}) {
  if (!new Set(["all", "evidence", "manifest"]).has(mode)) throw new Error(`Unsupported inspection mode "${mode}".`);
  const result = { schemaVersion: 1, specId: assertCanonicalSpecId(specId), mode };
  if (mode !== "manifest") result.evidence = await discoverNormalizedEvidence(specId, options);
  if (mode !== "evidence") result.manifest = await buildDiscoveryInputManifest(specId, options);
  return result;
}
