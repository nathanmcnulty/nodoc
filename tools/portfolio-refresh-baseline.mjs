import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectionDefinitions } from "./postman-collection-definitions.mjs";
import {
  analyzePostmanServerRouting,
  buildSpecRouteInventory,
  loadBundledSpecification,
  reconcileOpenApiPostman,
  repoRoot,
} from "./spec-quality-lib.mjs";
import {
  captureRecipesByTitle,
  coverageOverlayByTitle,
  crawlMetadataByTitle,
  getCoverageOverlay,
} from "./portal-discovery-metadata.mjs";

export const baselineSchemaVersion = 1;
export const workerPacketSchemaVersion = 1;
export const canonicalSpecCount = 20;
export const maximumWorkerPacketBytes = 131_072;

const defaultOutputDir = path.join(repoRoot, "reports", "portfolio-refresh-baseline");
const generatedLedgerPaths = {
  context: "src/generated/operationContextLedger.json",
  coverage: "src/generated/portalCoverageLedger.json",
  live: "src/generated/operationLiveCaptureLedger.json",
};
const statusValues = ["complete", "incomplete", "blocked", "unavailable", "unknown"];
const statusValueSet = new Set(statusValues);

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function fileFingerprint(relativePath) {
  const content = await readFile(path.join(repoRoot, relativePath));
  return {
    path: toPosix(relativePath),
    bytes: content.byteLength,
    sha256: sha256(content),
  };
}

async function listFiles(relativeDir, predicate = () => true) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => toPosix(path.join(relativeDir, entry.name)))
    .sort();
}

async function listOptionalFiles(relativeDir, predicate) {
  try {
    return await listFiles(relativeDir, predicate);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function listRelativeFilesRecursive(absoluteDir, prefix = "") {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listRelativeFilesRecursive(path.join(absoluteDir, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function ledgerEntryBySpecId(ledger) {
  return new Map(ledger.map((entry) => [entry.specId, entry]));
}

function phase(status, explanation, evidence = []) {
  if (!statusValueSet.has(status)) throw new Error(`Invalid phase status: ${status}`);
  return { status, explanation, evidence: [...evidence].sort() };
}

function explicitCount(source, property, sourcePath) {
  if (!source || !Object.hasOwn(source, property) || !Array.isArray(source[property])) {
    return {
      status: "unknown",
      value: null,
      explanation: `${property} is not explicitly recorded; absence is not treated as zero.`,
      source: sourcePath,
    };
  }
  return {
    status: "complete",
    value: source[property].length,
    explanation: `${property} is explicitly recorded in the authoritative coverage overlay.`,
    source: sourcePath,
  };
}

function getSchemaNames(specification) {
  return Object.keys(specification.components?.schemas ?? {}).sort();
}

function getVersions(specification) {
  return {
    openapi: specification.openapi ?? null,
    api: specification.info?.version ?? null,
  };
}

function compactOperations(operations) {
  return operations.map((operation) => [
    operation.method,
    operation.path,
    operation.operationId,
  ]);
}

function buildSummary(manifest) {
  const phaseNames = Object.keys(manifest.specifications[0].phases);
  const lines = [
    "# Portfolio refresh baseline",
    "",
    `Deterministic baseline for ${manifest.specifications.length} canonical specifications. Generated from the same data as \`campaign-baseline.json\`.`,
    "",
    "| Specification | Ops | Schemas | Postman drift | Recipes | Explicit gaps | Canonical | Derivative | Static | Bundles | Portal/API/spec | Live | Reconcile/publish |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const spec of manifest.specifications) {
    const gapCount = spec.candidateInputs.openGapCount.value;
    lines.push(`| ${spec.title} | ${spec.canonical.operationCount} | ${spec.canonical.schemaCount} | ${spec.derivatives.parity.counts.unresolved + spec.derivatives.parity.counts.orphaned} | ${spec.discovery.recipePaths.length} | ${gapCount === null ? "unknown" : gapCount} | ${spec.phases.canonicalInventory.status} | ${spec.phases.derivativeParity.status} | ${spec.phases.staticSourceDiscovery.status} | ${spec.phases.javascriptBundleDiscovery.status} | ${spec.phases.portalApiSpecDiscovery.status} | ${spec.phases.liveReadOnlyEvidence.status} | ${spec.phases.reconciliationPublication.status} |`);
  }
  lines.push("", "## Phase counts", "", "| Phase | Complete | Incomplete | Blocked | Unavailable | Unknown |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const phaseName of phaseNames) {
    const counts = Object.fromEntries([...statusValues].map((status) => [status, 0]));
    for (const spec of manifest.specifications) counts[spec.phases[phaseName].status] += 1;
    lines.push(`| ${phaseName} | ${counts.complete} | ${counts.incomplete} | ${counts.blocked} | ${counts.unavailable} | ${counts.unknown} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function buildSpecRecord(routeRecord, ledgers, collectionBySpecPath) {
  const specDirectory = path.posix.dirname(routeRecord.specPath);
  const specificationFiles = await listFiles(specDirectory, (name) => name.endsWith(".yml"));
  const specification = await loadBundledSpecification(path.join(repoRoot, routeRecord.specPath));
  const definition = collectionBySpecPath.get(routeRecord.specPath);
  if (!definition) throw new Error(`No generated derivative definition for ${routeRecord.specPath}.`);
  const collection = await readJson(definition.output);
  const parity = reconcileOpenApiPostman(routeRecord.operations, collection);
  const routing = analyzePostmanServerRouting(routeRecord.operations, collection);
  const overlay = getCoverageOverlay(routeRecord.title);
  const rawOverlay = coverageOverlayByTitle[routeRecord.title];
  const recipePaths = [...(captureRecipesByTitle[routeRecord.title] ?? [])].sort();
  const discoveryFiles = await listOptionalFiles(path.posix.join(specDirectory, "discovery"), () => true);
  const javascriptFiles = await listOptionalFiles(path.posix.join(specDirectory, "discovery"), (name) => /\.(?:js|mjs|cjs)$/u.test(name));
  const contextEntry = ledgers.context.get(routeRecord.specId);
  const coverageEntry = ledgers.coverage.get(routeRecord.specId);
  const liveEntry = ledgers.live.get(routeRecord.specId);
  const evidenceReferences = [
    ...specificationFiles,
    definition.output,
    ...recipePaths,
    ...discoveryFiles,
    ...(contextEntry ? [generatedLedgerPaths.context] : []),
    ...(coverageEntry ? [generatedLedgerPaths.coverage] : []),
    ...(liveEntry ? [generatedLedgerPaths.live] : []),
  ].sort();
  const fingerprints = await Promise.all(evidenceReferences.map(fileFingerprint));
  const operationIds = routeRecord.operations.map((entry) => entry.operationId);
  const missingOperationIds = operationIds.filter((value) => !value);
  const derivativeDrift = parity.counts.unresolved + parity.counts.orphaned;
  const openGapCount = explicitCount(rawOverlay, "openGaps", "tools/portal-discovery-metadata.mjs");
  const openGapClassCount = explicitCount(rawOverlay, "openGapClasses", "tools/portal-discovery-metadata.mjs");
  const liveOperationCount = Array.isArray(liveEntry?.operations) ? liveEntry.operations.length : null;

  return {
    specId: routeRecord.specId,
    title: routeRecord.title,
    canonical: {
      specPath: routeRecord.specPath,
      sourceFiles: specificationFiles,
      versions: getVersions(specification),
      hosts: [...routeRecord.scopeServerUrls].sort(),
      pathPrefixes: [...routeRecord.pathPrefixes].sort(),
      pathCount: Object.keys(specification.paths ?? {}).length,
      operationCount: routeRecord.operations.length,
      schemaCount: getSchemaNames(specification).length,
      schemaNames: getSchemaNames(specification),
      operations: compactOperations(routeRecord.operations),
      operationIds,
    },
    derivatives: {
      artifacts: [{ kind: "postman", path: definition.output }],
      parity,
      routing,
      generation: {
        deterministic: true,
        command: "npm run generate:postman",
        implementation: "tools/generate-postman-collections.mjs",
        pinnedTools: ["@redocly/cli@2.46.0", "openapi-to-postmanv2@6.0.0"],
      },
    },
    discovery: {
      metadataSource: "tools/portal-discovery-metadata.mjs",
      crawlMetadata: crawlMetadataByTitle[routeRecord.title],
      coverage: overlay,
      recipePaths,
    },
    evidence: {
      references: evidenceReferences,
      repositoryDiscoveryFiles: discoveryFiles,
      generatedLedgers: {
        coverage: coverageEntry ? generatedLedgerPaths.coverage : null,
        operationContext: contextEntry ? generatedLedgerPaths.context : null,
        operationLiveCapture: liveEntry ? generatedLedgerPaths.live : null,
      },
      staticJavascriptBundles: javascriptFiles,
      provenanceOperationCount: Array.isArray(contextEntry?.operations) ? contextEntry.operations.length : null,
      liveOperationCount,
    },
    candidateInputs: {
      parityUnresolvedCount: { status: "complete", value: parity.counts.unresolved, source: definition.output },
      parityOrphanedCount: { status: "complete", value: parity.counts.orphaned, source: definition.output },
      routingMismatchCount: { status: "complete", value: routing.mismatches.length, source: definition.output },
      openGapCount,
      openGapClassCount,
      promotedDiscoveryCount: Object.hasOwn(rawOverlay ?? {}, "promotedDiscoveries")
        ? { status: "complete", value: rawOverlay.promotedDiscoveries.length, source: "tools/portal-discovery-metadata.mjs" }
        : { status: "unknown", value: null, source: "tools/portal-discovery-metadata.mjs", explanation: "promotedDiscoveries is not explicitly recorded; absence is not treated as zero." },
    },
    phases: {
      canonicalInventory: missingOperationIds.length === 0
        ? phase("complete", "Canonical specification parsed with explicit operation IDs and stable inventory.", specificationFiles)
        : phase("incomplete", `${missingOperationIds.length} operations lack operation IDs.`, specificationFiles),
      derivativeParity: derivativeDrift === 0 && routing.mismatches.length === 0
        ? phase("complete", "Applicable checked-in Postman derivative has normalized operation parity and valid routing.", [definition.output])
        : phase("incomplete", `${derivativeDrift} normalized Postman parity differences and ${routing.mismatches.length} routing mismatches remain.`, [definition.output]),
      staticSourceDiscovery: phase("incomplete", "Checked-in metadata and recipes exist, but no explicit comprehensive static-source completion attestation is available.", ["tools/portal-discovery-metadata.mjs", ...recipePaths]),
      javascriptBundleDiscovery: javascriptFiles.length > 0
        ? phase("incomplete", "Checked-in JavaScript evidence exists, but no comprehensive bundle completion attestation is available.", javascriptFiles)
        : phase("unavailable", "No per-spec checked-in JavaScript or bundle artifact is deterministically discoverable in the specification discovery directory."),
      portalApiSpecDiscovery: phase("incomplete", "Coverage metadata records prior discovery, but it does not attest a full portfolio refresh phase as complete.", coverageEntry ? [generatedLedgerPaths.coverage] : []),
      liveReadOnlyEvidence: liveEntry
        ? phase("incomplete", `Live evidence exists for ${liveOperationCount} operations, without an all-operations refresh completion attestation.`, [generatedLedgerPaths.live])
        : phase("unavailable", "No generated live-capture ledger entry exists for this specification."),
      reconciliationPublication: phase("unknown", "No machine-readable campaign refresh reconciliation/publication attestation exists; derivative parity alone is insufficient."),
    },
    fingerprints: {
      inputs: fingerprints,
      aggregateSha256: sha256(stableJson(fingerprints)),
    },
  };
}

export async function buildPortfolioRefreshBaseline() {
  const [routeInventory, contextLedger, coverageLedger, liveLedger] = await Promise.all([
    buildSpecRouteInventory(),
    readJson(generatedLedgerPaths.context),
    readJson(generatedLedgerPaths.coverage),
    readJson(generatedLedgerPaths.live),
  ]);
  if (routeInventory.length !== canonicalSpecCount) {
    throw new Error(`Expected exactly ${canonicalSpecCount} canonical specifications, found ${routeInventory.length}.`);
  }
  const collectionBySpecPath = new Map(collectionDefinitions.map((entry) => [entry.spec, entry]));
  const ledgers = {
    context: ledgerEntryBySpecId(contextLedger),
    coverage: ledgerEntryBySpecId(coverageLedger),
    live: ledgerEntryBySpecId(liveLedger),
  };
  const specifications = [];
  for (const routeRecord of routeInventory) {
    specifications.push(await buildSpecRecord(routeRecord, ledgers, collectionBySpecPath));
  }
  const manifestCore = {
    schemaVersion: baselineSchemaVersion,
    campaignId: "portfolio-refresh-baseline",
    codingOwner: {
      provider: "OpenAI",
      model: "GPT-5.6 Sol",
      reasoningEffort: "medium",
    },
    canonicalSpecCount,
    specifications,
  };
  return { ...manifestCore, digest: sha256(stableJson(manifestCore)) };
}

export function buildWorkerPacket(specRecord, manifestDigest) {
  return {
    schemaVersion: workerPacketSchemaVersion,
    campaignDigest: manifestDigest,
    specId: specRecord.specId,
    title: specRecord.title,
    inventory: specRecord.canonical,
    evidenceReferences: specRecord.evidence,
    phaseGaps: Object.fromEntries(Object.entries(specRecord.phases).filter(([, value]) => value.status !== "complete")),
    candidateInputs: specRecord.candidateInputs,
    fingerprints: specRecord.fingerprints,
  };
}

export async function renderPortfolioRefreshArtifacts() {
  const manifest = await buildPortfolioRefreshBaseline();
  const files = new Map([
    ["campaign-baseline.json", stableJson(manifest)],
    ["README.md", buildSummary(manifest)],
  ]);
  for (const spec of manifest.specifications) {
    const relativePath = `workers/${spec.specId}.json`;
    const content = stableJson(buildWorkerPacket(spec, manifest.digest));
    if (Buffer.byteLength(content) > maximumWorkerPacketBytes) {
      throw new Error(`${relativePath} exceeds ${maximumWorkerPacketBytes} bytes.`);
    }
    files.set(relativePath, content);
  }
  return files;
}

export async function writePortfolioRefreshArtifacts(outputDir = defaultOutputDir) {
  const files = await renderPortfolioRefreshArtifacts();
  for (const [relativePath, content] of files) {
    const outputPath = path.join(outputDir, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");
  }
  return files;
}

export async function validatePortfolioRefreshArtifacts(outputDir = defaultOutputDir) {
  const expected = await renderPortfolioRefreshArtifacts();
  const errors = [];
  for (const [relativePath, content] of expected) {
    try {
      const actual = await readFile(path.join(outputDir, relativePath), "utf8");
      if (actual !== content) errors.push(`${relativePath} is stale.`);
    } catch (error) {
      errors.push(`${relativePath} is missing or unreadable (${error.message}).`);
    }
    let actualPaths = [];
    try {
      actualPaths = await listRelativeFilesRecursive(outputDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const relativePath of actualPaths) {
      if (!expected.has(relativePath)) errors.push(`${relativePath} is unexpected or stale.`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return expected;
}

async function main() {
  const check = process.argv.includes("--check");
  const outputFlag = process.argv.indexOf("--output");
  const outputDir = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1]) : defaultOutputDir;
  if (check) {
    await validatePortfolioRefreshArtifacts(outputDir);
    console.log(`Portfolio refresh baseline is current (${canonicalSpecCount} specifications).`);
  } else {
    const files = await writePortfolioRefreshArtifacts(outputDir);
    const totalBytes = [...files.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0);
    console.log(`Wrote ${files.size} portfolio refresh artifacts (${totalBytes} bytes).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
