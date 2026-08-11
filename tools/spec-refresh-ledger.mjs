import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  canonicalOperationKey,
  getEffectiveServerUrls,
  loadSpecificationInventory,
  reconcileOpenApiPostman,
  validatePostmanServerRouting,
} from "./spec-quality-lib.mjs";
import {
  getCaptureRecipes,
  getCoverageOverlay,
} from "./portal-discovery-metadata.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const outputRoot = path.join(repoRoot, "reports", "spec-refresh");
export const canonicalSpecIds = [
  "defender-xdr", "entra-b2c", "ibiza-iam", "entra-idgov", "entra-iga",
  "entra-pim", "exchange-beta", "intune-autopatch", "intune-portal", "m365-admin",
  "m365-apps-config", "m365-apps-inventory", "m365-apps-services", "power-platform",
  "purview", "purview-portal", "security-copilot", "sharepoint-admin", "teams", "viva-engage",
];

const httpMethods = new Set(["get", "put", "post", "patch", "delete", "head", "options", "trace"]);
const statusValues = new Set(["complete", "incomplete", "blocked", "unavailable", "unknown"]);
const packetLimit = 16 * 1024;
const totalLimit = 400 * 1024;
const topLimit = 5;
const collectionNames = new Map([
  ["defender-xdr", "defender"],
  ["ibiza-iam", "entra-iam"],
]);

const slash = (value) => value.replaceAll("\\", "/");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const stableJson = (value, pretty = false) => `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
const digestText = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const digestValue = (value) => digestText(stableJson(value));
const exists = async (filePath) => access(filePath).then(() => true, () => false);

function operationEntries(specification) {
  return Object.entries(specification.paths ?? {}).flatMap(([pathname, pathItem]) => (
    Object.entries(pathItem ?? {})
      .filter(([method, operation]) => httpMethods.has(method) && operation && typeof operation === "object")
      .map(([method, operation]) => ({
        key: canonicalOperationKey({ method, path: pathname }),
        method: method.toUpperCase(),
        path: pathname,
        operationId: operation.operationId ?? null,
        summary: operation.summary ?? null,
        serverUrls: getEffectiveServerUrls(specification, pathItem, operation),
      }))
  )).sort((left, right) => compareText(left.key, right.key));
}

async function authoritativeSpecs() {
  const portfolio = JSON.parse(await readFile(path.join(repoRoot, "tools", "portal-discovery-portfolio.json"), "utf8"));
  const ids = portfolio.portals.map(({ specId }) => specId);
  if (JSON.stringify(ids) !== JSON.stringify(canonicalSpecIds)) {
    throw new Error(`Canonical specification IDs changed: ${ids.join(", ")}`);
  }
  return portfolio.portals;
}

async function sourceFingerprint(specId, moduleFiles) {
  const specificationDir = path.join(repoRoot, "specifications", `nodoc-${specId}`, "specification");
  const sourceFiles = (await readdir(specificationDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:yaml|yml|json)$/u.test(entry.name))
    .map((entry) => path.join(specificationDir, entry.name));
  const sharedFiles = [
    path.join(repoRoot, "tools", "portal-discovery-portfolio.json"),
    path.join(repoRoot, "tools", "portal-discovery-metadata.mjs"),
  ];
  const files = [...new Set([...sourceFiles, ...moduleFiles.map((file) => path.resolve(specificationDir, file))])]
    .filter((file) => file.startsWith(repoRoot) && !file.startsWith(outputRoot));
  const entries = [];
  for (const file of [...files, ...sharedFiles].sort()) {
    if (!await exists(file)) continue;
    if (!(await stat(file)).isFile()) continue;
    entries.push({ path: slash(path.relative(repoRoot, file)), digest: digestText(await readFile(file, "utf8")) });
  }
  return { digest: digestValue(entries), fileCount: entries.length };
}

function evidenceSummary(title, liveEntry) {
  const overlay = getCoverageOverlay(title);
  const recipes = getCaptureRecipes(title);
  const references = [...new Set([
    ...recipes,
    ...(liveEntry ? ["src/generated/operationLiveCaptureLedger.json"] : []),
    ...(overlay.promotedDiscoveries.length || overlay.openGaps.length ? ["tools/portal-discovery-metadata.mjs"] : []),
  ])].sort();
  const observedCount = liveEntry?.operations?.length ?? 0;
  return {
    state: observedCount > 0 ? "observed" : references.length > 0 ? "notObserved" : "unknown",
    observedCount,
    referenceCount: references.length,
    references,
    digest: digestValue({ references, observed: liveEntry?.operations?.map(({ method, path: pathname }) => `${method} ${pathname}`).sort() ?? [] }),
    reason: observedCount > 0
      ? "Machine-readable live-capture records are present."
      : references.length > 0
        ? "Static recipes or metadata exist, but no machine-readable live-capture record was observed."
        : "No searched evidence reference was found; absence is not treated as unavailability.",
  };
}

export function phaseStatus({ evidence, parity, parseError }) {
  const phases = {
    sourceInventory: parseError
      ? { status: "blocked", reason: parseError }
      : { status: "complete", reason: "Canonical source modules parsed and inventoried." },
    derivativeParity: parity.state === "observed" && parity.counts.unresolved === 0 && parity.counts.orphaned === 0
      ? { status: "complete", reason: "A checked-in derivative exists with no unresolved or orphaned routes." }
      : parity.state === "observed"
        ? { status: "incomplete", reason: "A checked-in derivative exists with parity gaps." }
        : { status: "unknown", reason: "No checked-in derivative was found; absence is not unavailability." },
    discoveryEvidence: evidence.state === "observed"
      ? { status: "complete", reason: evidence.reason }
      : evidence.state === "notObserved"
        ? { status: "incomplete", reason: evidence.reason }
        : { status: "unknown", reason: evidence.reason },
    refreshReadiness: parseError
      ? { status: "blocked", reason: "Source inventory must succeed before refresh orchestration." }
      : evidence.state !== "observed"
        ? { status: "incomplete", reason: "Discovery evidence is absent or static-only; metadata validation alone is insufficient." }
        : parity.state !== "observed" || parity.counts.unresolved > 0 || parity.counts.orphaned > 0
          ? { status: "incomplete", reason: "Derivative parity is absent or has explicit gaps." }
          : { status: "complete", reason: "Source, derivative parity, and observed evidence are all explicit." },
  };
  for (const phase of Object.values(phases)) {
    if (!statusValues.has(phase.status) || !phase.reason) throw new Error("Invalid phase status or missing reason.");
  }
  return phases;
}

async function buildSpecRecord(specId, liveById) {
  const specPath = slash(path.join("specifications", `nodoc-${specId}`, "specification", "openapi.yml"));
  const absoluteSpecPath = path.join(repoRoot, specPath);
  const { bundledSpecification, moduleFiles, schemaKeys } = await loadSpecificationInventory(absoluteSpecPath);
  const operations = operationEntries(bundledSpecification);
  const title = bundledSpecification.info?.title ?? specId;
  const collectionPath = slash(path.join("postman", "collections", `${collectionNames.get(specId) ?? specId}.collection.json`));
  const absoluteCollectionPath = path.join(repoRoot, collectionPath);
  let parity;
  let collection = null;
  if (await exists(absoluteCollectionPath)) {
    collection = JSON.parse(await readFile(absoluteCollectionPath, "utf8"));
    if (specId === "security-copilot") {
      validatePostmanServerRouting(operations, collection, `${title} Postman collection`);
    }
    const report = reconcileOpenApiPostman(operations, collection);
    parity = {
      state: "observed",
      path: collectionPath,
      counts: report.counts,
      requestCount: report.postmanRequestCount,
      digest: digestValue({ counts: report.counts, emitted: report.emitted.map(({ key }) => key), unresolved: report.unresolved.map(({ key }) => key), orphaned: report.orphaned.map(({ key }) => key) }),
      exceptions: [...report.unresolved.map(({ key }) => ({ kind: "unresolved", key })), ...report.orphaned.map(({ key }) => ({ kind: "orphaned", key }))]
        .sort((left, right) => compareText(`${left.kind}:${left.key}`, `${right.kind}:${right.key}`)),
    };
  } else {
    parity = { state: "unknown", path: collectionPath, counts: { emitted: null, intentionallyFiltered: null, orphaned: null, duplicateShadowed: null, unresolved: null }, requestCount: null, digest: null, exceptions: [] };
  }
  const evidence = evidenceSummary(title, liveById.get(specId));
  const fingerprint = await sourceFingerprint(specId, moduleFiles);
  const authoritative = {
    operationCount: operations.length,
    operationDigest: digestValue(operations.map(({ key, operationId }) => ({ key, operationId }))),
    schemaCount: schemaKeys.length,
    schemaDigest: digestValue(schemaKeys),
    moduleCount: moduleFiles.length,
  };
  const phases = phaseStatus({ evidence, parity, parseError: null });
  const overlay = getCoverageOverlay(title);
  const candidates = [
    ...overlay.openGaps.map((reason) => ({ kind: "openGap", reason })),
    ...parity.exceptions.map(({ kind, key }) => ({ kind, key })),
  ].sort((left, right) => compareText(stableJson(left), stableJson(right)));
  return {
    index: {
      id: specId,
      title,
      path: specPath,
      authoritative,
      parity: { state: parity.state, path: parity.path, counts: parity.counts, requestCount: parity.requestCount, digest: parity.digest },
      evidence: { state: evidence.state, observedCount: evidence.observedCount, referenceCount: evidence.referenceCount, digest: evidence.digest, reason: evidence.reason },
      fingerprint,
      phases,
      gaps: {
        openMetadata: overlay.openGaps.length,
        parity: parity.exceptions.length,
        total: candidates.length,
      },
    },
    packet: {
      schemaVersion: 1,
      id: specId,
      phases,
      counts: { ...authoritative, evidenceObserved: evidence.observedCount, evidenceReferences: evidence.referenceCount, parityExceptions: parity.exceptions.length, openMetadataGaps: overlay.openGaps.length },
      digests: { operations: authoritative.operationDigest, schemas: authoritative.schemaDigest, evidence: evidence.digest, parity: parity.digest, sources: fingerprint.digest },
      evidence: { state: evidence.state, reason: evidence.reason, references: evidence.references.slice(0, topLimit), remainingCount: Math.max(0, evidence.references.length - topLimit) },
      exceptions: { totalCount: candidates.length, digest: digestValue(candidates), top: candidates.slice(0, topLimit), remainingCount: Math.max(0, candidates.length - topLimit), detailsSelector: `npm run spec-refresh -- --spec ${specId} --details operations|schemas|evidence` },
    },
    details: { operations, schemas: schemaKeys, evidence: { ...evidence, liveOperations: liveById.get(specId)?.operations ?? [] } },
  };
}

export async function buildLedger() {
  await authoritativeSpecs();
  const liveEntries = JSON.parse(await readFile(path.join(repoRoot, "src", "generated", "operationLiveCaptureLedger.json"), "utf8"));
  const liveById = new Map(liveEntries.map((entry) => [entry.specId, entry]));
  const records = [];
  for (const specId of canonicalSpecIds) records.push(await buildSpecRecord(specId, liveById));
  const specs = records.map(({ index }) => index);
  const index = {
    schemaVersion: 1,
    specIds: canonicalSpecIds,
    totals: {
      specCount: specs.length,
      operationCount: specs.reduce((sum, spec) => sum + spec.authoritative.operationCount, 0),
      schemaCount: specs.reduce((sum, spec) => sum + spec.authoritative.schemaCount, 0),
      evidenceObservedCount: specs.reduce((sum, spec) => sum + spec.evidence.observedCount, 0),
      gapCount: specs.reduce((sum, spec) => sum + spec.gaps.total, 0),
    },
    phaseCounts: Object.fromEntries(["sourceInventory", "derivativeParity", "discoveryEvidence", "refreshReadiness"].map((phase) => [phase, Object.fromEntries([...statusValues].map((status) => [status, specs.filter((spec) => spec.phases[phase].status === status).length]))])),
    specs,
  };
  return { index: { ...index, digest: digestValue(index) }, records };
}

function markdown(index) {
  const lines = [
    "# Specification Refresh Ledger",
    "",
    `Canonical specifications: **${index.totals.specCount}** | Operations: **${index.totals.operationCount}** | Schemas: **${index.totals.schemaCount}** | Explicit gaps: **${index.totals.gapCount}**`,
    "",
    "| ID | Operations | Schemas | Parity | Evidence | Readiness | Gaps |",
    "| --- | ---: | ---: | --- | --- | --- | ---: |",
    ...index.specs.map((spec) => `| ${spec.id} | ${spec.authoritative.operationCount} | ${spec.authoritative.schemaCount} | ${spec.phases.derivativeParity.status} | ${spec.phases.discoveryEvidence.status} | ${spec.phases.refreshReadiness.status} | ${spec.gaps.total} |`),
    "",
    "Detailed operations, schemas, and evidence are emitted on demand with `npm run spec-refresh -- --spec <id> --details operations|schemas|evidence`.",
    "",
  ];
  return lines.join("\n");
}

function baselineFiles(ledger) {
  return new Map([
    ["index.json", stableJson(ledger.index, true)],
    ["SUMMARY.md", markdown(ledger.index)],
    ...ledger.records.map(({ index, packet }) => [`packets/${index.id}.json`, stableJson(packet, true)]),
  ]);
}

async function validateBudgets(files) {
  let total = 0;
  for (const [relativePath, content] of files) {
    const bytes = Buffer.byteLength(content, "utf8");
    total += bytes;
    if (relativePath.startsWith("packets/") && bytes > packetLimit) throw new Error(`${relativePath} is ${bytes} bytes; packet limit is ${packetLimit}.`);
  }
  if (total > totalLimit) throw new Error(`Generated baseline is ${total} bytes; total limit is ${totalLimit}.`);
  return total;
}

export async function writeBaseline(root = outputRoot) {
  const ledger = await buildLedger();
  const files = baselineFiles(ledger);
  await validateBudgets(files);
  await rm(root, { recursive: true, force: true });
  for (const [relativePath, content] of files) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
  return { ledger, files };
}

export async function validateBaseline(root = outputRoot) {
  const ledger = await buildLedger();
  const expected = baselineFiles(ledger);
  await validateBudgets(expected);
  const actualPaths = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else actualPaths.push(slash(path.relative(root, filePath)));
    }
  }
  if (!await exists(root)) throw new Error("Generated baseline directory is missing.");
  await walk(root);
  const expectedPaths = [...expected.keys()].sort();
  actualPaths.sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error(`Generated baseline files differ. Expected ${expectedPaths.join(", ")}; found ${actualPaths.join(", ")}.`);
  for (const [relativePath, content] of expected) {
    const actual = await readFile(path.join(root, relativePath), "utf8");
    if (actual !== content) throw new Error(`${relativePath} is stale or tampered.`);
  }
  return true;
}

export async function detailFor(specId, detail) {
  if (!canonicalSpecIds.includes(specId)) throw new Error(`Unknown specification ID: ${specId}`);
  if (!["operations", "schemas", "evidence"].includes(detail)) throw new Error(`Unknown detail selector: ${detail}`);
  const ledger = await buildLedger();
  const record = ledger.records.find(({ index }) => index.id === specId);
  return { schemaVersion: 1, specId, detail, data: record.details[detail], digest: digestValue(record.details[detail]) };
}

function parseArgs(argv) {
  const result = { command: "generate", spec: null, details: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (["generate", "validate"].includes(value)) result.command = value;
    else if (value === "--spec") result.spec = argv[++index];
    else if (value === "--details") result.details = argv[++index];
    else if (value === "--out") result.out = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.spec || args.details) {
    if (!args.spec || !args.details) throw new Error("--spec and --details must be provided together.");
    const content = stableJson(await detailFor(args.spec, args.details), true);
    if (args.out) {
      const filePath = path.resolve(args.out);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    } else process.stdout.write(content);
  } else if (args.command === "validate") {
    await validateBaseline();
    process.stdout.write("Specification refresh ledger is current.\n");
  } else {
    const { files } = await writeBaseline();
    const sizes = [...files.entries()].map(([file, content]) => ({ file, bytes: Buffer.byteLength(content, "utf8") }));
    process.stdout.write(`${stableJson({ files: sizes.length, totalBytes: sizes.reduce((sum, entry) => sum + entry.bytes, 0), maxPacketBytes: Math.max(...sizes.filter(({ file }) => file.startsWith("packets/")).map(({ bytes }) => bytes)) }, true)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
