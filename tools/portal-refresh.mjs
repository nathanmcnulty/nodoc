// Offline consumers of the existing capture pipeline. No browser, ledger or merge writes.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCrawlCandidates, normalizeRoutePath } from "./generate-crawl-candidates.mjs";
import { buildCandidateHandoff, buildPartitionedCandidateHandoff } from "./discovery-candidate-handoff.mjs";
import { buildSpecRouteInventory, loadBundledSpecification, repoRoot } from "./spec-quality-lib.mjs";
import { hydrateResponseBodySidecars } from "./response-body-sidecars.mjs";
import { primitiveTypeCompatible } from "./response-evidence.mjs";
import { routePattern } from "./portal-discovery-novelty.mjs";
import { inspectCaptureCompleteness } from "./run-portal-discovery.mjs";
import { actionResultSucceeded, aggregateInteractionHealth } from "./discovery-capture-policy.mjs";
import { validateMutationEventsArtifact, validateOperationSummary } from "./portal-discovery-operation-safety.mjs";
import { privateRefreshDirectory, assertNoRefreshLinks } from "./portal-refresh-paths.mjs";
import { requestEvidence, responseErrorSignature } from "./cdp-deep-capture.mjs";

export const refreshAnalysisVersion = 1;
const methods = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "TRACE"]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const json = value => `${JSON.stringify(canonical(value), null, 2)}\n`;
const hash = value => createHash("sha256").update(value).digest("hex");
const digest = value => hash(json(value));
export const refreshAnalysisDigest = digest;
const readJson = async file => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/u, ""));
async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

// Origin, port, server base and canonical path must all match. Never use matchesCurrentSpec.
export function matchRefreshOperation(record, inventory) {
  let url;
  try { url = new URL(record.url); } catch { return []; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
  const matches = [];
  for (const spec of inventory) for (const operation of spec.operations) {
    if (operation.method !== String(record.method).toUpperCase()) continue;
    for (const server of operation.serverUrls ?? spec.serverUrls ?? []) {
      const sentinel = "nodoc-server-variable";
      let parsed;
      try { parsed = new URL(server.replace(/\{[^{}]+\}/gu, sentinel)); } catch { continue; }
      const hostname = new RegExp(`^${parsed.hostname.split(sentinel).map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("[^.]+")}$`, "u");
      if (parsed.protocol !== url.protocol || parsed.port !== url.port || !hostname.test(url.hostname)) continue;
      const wirePath = `${parsed.pathname.replace(/\/$/u, "")}${operation.path}`;
      if (!routePattern(wirePath).test(url.pathname)) continue;
      matches.push({ specId: spec.specId, method: operation.method, path: operation.path, operationId: operation.operationId });
      break;
    }
  }
  return matches;
}

export function responseHealth(record) {
  if (record.abortedBeforeSend) return "not-executed";
  const status = Number(record.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) return "unknown";
  if (status >= 400) return "http-error-observed"; // Including 404: never removal evidence.
  if (status < 200 || status >= 300) return "transport-unverified";
  if (status === 204) return "no-content-observed";
  if (typeof record.responseBodyForAnalysis !== "string" || record.bodyCapture?.state !== "complete") return "body-unverified";
  let body;
  try { body = JSON.parse(record.responseBodyForAnalysis); } catch { return "body-unverified"; }
  if (body === null) return "body-unverified";
  if (responseErrorSignature(record)) return "semantic-error-observed";
  if (record.graphQlOperationName && (!body || typeof body !== "object" || !("data" in body))) return "body-unverified";
  return "successful-body-observed";
}

// Only observed token types; no required, enums, ranges, formats or real scalar examples.
// Property names still need independent privacy review. This result stays PRIVATE.
export function inferRefreshSchema(value, depth = 0) {
  if (depth > 20) throw new Error("Response shape exceeds refresh depth limit.");
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) {
    const variants = [...new Map(value.map(item => {
      const schema = inferRefreshSchema(item, depth + 1); return [json(schema), schema];
    })).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, schema]) => schema);
    return { type: "array", items: variants.length === 1 ? variants[0] : variants.length ? { anyOf: variants } : {} };
  }
  if (typeof value === "object") return { type: "object", properties: Object.fromEntries(Object.keys(value).sort().map(key => [key, inferRefreshSchema(value[key], depth + 1)])) };
  return { type: typeof value === "number" ? Number.isInteger(value) ? "integer" : "number" : typeof value };
}

export function syntheticRefreshExample(value, depth = 0) {
  if (depth > 20) throw new Error("Response example exceeds refresh depth limit.");
  if (value === null) return null;
  if (Array.isArray(value)) return value.length ? [syntheticRefreshExample(value[0], depth + 1)] : [];
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, syntheticRefreshExample(value[key], depth + 1)]));
  if (typeof value === "string") return "example";
  if (typeof value === "boolean") return false;
  return Number.isInteger(value) ? 0 : 0.5;
}

export function compareRefreshResponse(value, schema) {
  const supported = new Set(["type", "nullable", "properties", "items", "additionalProperties", "required", "description", "title", "example", "examples", "deprecated", "readOnly", "writeOnly"]);
  if (Object.keys(schema).some(key => !supported.has(key) && !key.startsWith("x-"))) return "contract-unverified";
  const compatibility = primitiveTypeCompatible(value, schema);
  if (compatibility === false) return "contract-conflict";
  if (compatibility === null || schema.enum || schema.const !== undefined || schema.format || schema.pattern || schema.minimum !== undefined || schema.maximum !== undefined) return "contract-unverified";
  if (Array.isArray(value)) {
    const results = value.map(item => compareRefreshResponse(item, schema.items ?? {}));
    return results.includes("contract-conflict") ? "contract-conflict" : !value.length || results.includes("contract-unverified") ? "contract-unverified" : "compatible-observed-types";
  }
  if (value && typeof value === "object") {
    if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) return "contract-conflict";
    const results = Object.entries(value).map(([key, entry]) => schema.properties?.[key]
      ? compareRefreshResponse(entry, schema.properties[key]) : schema.additionalProperties === false ? "contract-conflict" : "contract-unverified");
    return results.includes("contract-conflict") ? "contract-conflict" : results.includes("contract-unverified") ? "contract-unverified" : "compatible-observed-types";
  }
  return "compatible-observed-types";
}

export function groupRefreshEnrichments(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = digest({ specId: entry.specId, method: entry.method, path: entry.path, status: entry.status, mimeType: entry.mimeType,
      comparison: entry.comparison, schema: entry.schema, exampleMissing: entry.exampleMissing, requestVariantDigest: entry.requestVariantDigest });
    const group = groups.get(key) ?? { ...entry, supportingObservations: [] };
    group.supportingObservations.push({ evidenceId: entry.evidenceId, actionIndex: entry.actionIndex, observedAt: entry.observedAt, captureId: entry.captureId });
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group);
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Refresh inputs must not contain symbolic links.");
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files.sort();
}

async function captureBinding(artifacts) {
  // Bind all retained inputs, including physical sidecars and failed-run orphans.
  const files = await filesUnder(artifacts);
  const bindings = [];
  for (const file of files) bindings.push({ path: path.relative(artifacts, file).replaceAll("\\", "/"), sha256: await hashFile(file) });
  return digest(bindings);
}

async function analysisBinding(inventory) {
  const sources = new Set();
  async function dependencies(file) {
    if (sources.has(file)) return;
    sources.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+\.mjs)["']/gu)) await dependencies(path.resolve(path.dirname(file), match[1]));
  }
  await dependencies(path.join(repoRoot, "tools", "portal-refresh.mjs"));
  for (const file of [...await filesUnder(path.join(repoRoot, "specifications")), ...["package-lock.json", "AGENT_DISCOVERY_RUNBOOK.md", "AGENT_DISCOVERY_PLAYBOOK.md", "PORTAL_DISCOVERY_AGENT_PROMPT.md"].map(file => path.join(repoRoot, file))]) sources.add(file);
  const bindings = [];
  for (const file of [...sources].sort()) bindings.push([path.relative(repoRoot, file), await hashFile(file)]);
  return digest({ version: refreshAnalysisVersion, runtime: process.versions.node, inventory, sources: bindings });
}

export async function analyzeRefreshCapture({ artifacts, specId, cacheDir, inventory = null }) {
  artifacts = await privateRefreshDirectory(artifacts);
  cacheDir = await privateRefreshDirectory(cacheDir, { create: true, readOnlyRoots: [artifacts] });
  inventory ??= await buildSpecRouteInventory();
  const spec = inventory.find(entry => entry.specId === specId);
  if (!spec) throw new Error("Unknown refresh spec ID.");
  const inputDigest = await captureBinding(artifacts);
  const analyzerDigest = await analysisBinding(inventory);
  const cacheKey = digest({ inputDigest, analyzerDigest, specId });
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
  await assertNoRefreshLinks(cacheFile);
  try {
    const cached = await readJson(cacheFile);
    if (cached.cacheKey !== cacheKey || digest(cached.analysis) !== cached.analysisDigest) throw new Error("Refresh cache integrity mismatch.");
    if (await captureBinding(artifacts) !== inputDigest) throw new Error("Capture changed during refresh reuse.");
    return { analysis: cached.analysis, reused: true, cacheKey };
  } catch (error) { if (error.code !== "ENOENT") throw error; }

  const [summary, actions, apiRecords] = await Promise.all(["summary.json", "action-results.json", "api-records.json"].map(file => readJson(path.join(artifacts, file))));
  let records = apiRecords, recordSource = "api-records.json";
  try {
    records = await readJson(path.join(artifacts, "raw-requests.json"));
    recordSource = "raw-requests.json"; // Preserve origin/status/body variants lost by historical aggregation.
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!Array.isArray(records) || !Array.isArray(actions)) throw new Error("Invalid refresh capture records or actions.");
  await hydrateResponseBodySidecars(records, artifacts, summary.responseBodyLimits);
  // Use canonical capture health without treating one successful recipe as portfolio health.
  const health = aggregateInteractionHealth(actions, { reported: summary.interactionHealth ?? summary.actionValidation?.interactionHealth });
  const completeness = await inspectCaptureCompleteness(artifacts);
  let mutationSafe = true;
  if (summary.mutationSummary) {
    validateOperationSummary(summary.mutationSummary);
    mutationSafe = summary.mutationSummary.safeToContinue === true;
    if (summary.mutationSummary.attemptCount > 0) {
      const events = await readJson(path.join(artifacts, "mutation-events.json"));
      validateMutationEventsArtifact(events, { captureSummary: summary.mutationSummary });
    }
  }
  const captureComplete = Boolean(completeness.captureComplete && health && health.accounting?.consistent === true
    && health.recommendation?.recommended !== true && mutationSafe
    && !actions.some(action => action.required && !actionResultSucceeded(action))
    && (summary.actionValidation?.requiredActionFailures ?? []).length === 0);
  const captureId = `capture-${inputDigest.slice(0, 24)}`;
  const observations = [], enrichments = [], unmapped = [], ambiguous = [];
  const bundled = new Map(await Promise.all(inventory.map(async entry => [entry.specId, await loadBundledSpecification(path.join(repoRoot, entry.specPath))])));
  for (const record of records) {
    if (!methods.has(String(record.method).toUpperCase())) continue;
    const matches = matchRefreshOperation(record, inventory);
    if (matches.length > 1) {
      ambiguous.push({ evidenceId: record.evidenceId ?? null, reason: "multiple-operation-owners", matchingOperationCount: matches.length });
      continue;
    }
    const actionIndex = record.attribution?.actionIndex;
    const attributed = Number.isInteger(actionIndex) && actionIndex >= 0 && actions.some(action => (action.index ?? action.actionIndex) === actionIndex && actionResultSucceeded(action));
    const recordHealth = responseHealth(record);
    const bodyVerified = record.bodyCapture?.state === "complete" && typeof record.responseBodyForAnalysis === "string";
    if (!matches.length) { unmapped.push({ evidenceId: record.evidenceId ?? null, reason: "unmapped-origin-or-route", health: recordHealth }); continue; }
    for (const match of matches) {
      const observation = { ...match, captureId, evidenceId: record.evidenceId ?? null, observedAt: record.observedAt ?? null,
        actionIndex: Number.isInteger(actionIndex) ? actionIndex : null, attributed, captureComplete, bodyVerified,
        status: Number(record.status) || null, health: recordHealth, removalRecommended: false };
      observations.push(observation);
      if (!bodyVerified || recordHealth !== "successful-body-observed" || !attributed || !captureComplete || !observation.evidenceId) continue;
      const operation = bundled.get(match.specId).paths?.[match.path]?.[match.method.toLowerCase()];
      const mimeType = String(record.mimeType ?? "").split(";")[0].toLowerCase().trim();
      if (!/^application\/(?:[\w.+-]+\+)?json$/u.test(mimeType)) continue;
      const body = JSON.parse(record.responseBodyForAnalysis);
      const response = operation?.responses?.[String(record.status)] ?? operation?.responses?.[`${String(record.status)[0]}XX`] ?? operation?.responses?.default;
      const media = response?.content?.[mimeType];
      const comparison = !media?.schema || Object.keys(media.schema).length === 0 ? "schema-missing" : compareRefreshResponse(body, media.schema);
      const exampleMissing = media && media.example === undefined && !Object.keys(media.examples ?? {}).length && media.schema?.example === undefined && !media.schema?.examples?.length;
      if (comparison === "compatible-observed-types" && !exampleMissing) continue;
      enrichments.push({ ...match, captureId, evidenceId: record.evidenceId, actionIndex, observedAt: record.observedAt ?? null,
        requestVariantDigest: digest({ fingerprint: requestEvidence(record).requestFingerprint, query: new URL(record.url).search }),
        status: String(record.status), mimeType, comparison, schema: inferRefreshSchema(body), syntheticExample: syntheticRefreshExample(body),
        exampleMissing: Boolean(exampleMissing), reviewRequired: true,
        limitations: ["Observed token types only; requiredness, enums and minimum roles unproved.", "Property names require privacy review; examples contain synthetic scalar values."] });
    }
  }
  const candidateQueue = await buildCrawlCandidates({ artifacts, spec: specId, apiRecords: records, includeDocumented: true, includeAdjacent: true, bundleDir: null }, inventory);
  const discoveryDrafts = [];
  for (const candidate of candidateQueue.candidates) {
    if (candidate.documentationStatus === "documented" || candidate.evidence !== "confirmed" || candidate.method !== "GET" || candidate.baseUrls?.length !== 1) continue;
    for (const record of records) {
      let url;
      try { url = new URL(record.url); } catch { continue; }
      if (record.method !== "GET" || candidate.baseUrls[0] !== url.origin || normalizeRoutePath(url.pathname) !== candidate.normalizedPath
        || matchRefreshOperation(record, inventory).length || responseHealth(record) !== "successful-body-observed" || !captureComplete
        || record.bodyCapture?.state !== "complete" || !record.evidenceId || !Number.isInteger(record.attribution?.actionIndex) || record.attribution.actionIndex < 0
        || !actions.some(action => action.actionIndex === record.attribution.actionIndex && actionResultSucceeded(action))) continue;
      const mimeType = String(record.mimeType ?? "").split(";")[0].toLowerCase().trim();
      if (!/^application\/(?:[\w.+-]+\+)?json$/u.test(mimeType)) continue;
      const servers = (spec.scopeServerUrls ?? spec.serverUrls).flatMap(serverUrl => {
        let server;
        try { server = new URL(serverUrl.replace(/\{[^{}]+\}/gu, "nodoc-server-variable")); } catch { return []; }
        const base = server.pathname.replace(/\/$/u, "");
        if (base && !candidate.normalizedPath.startsWith(`${base}/`)) return [];
        const canonicalPath = candidate.normalizedPath.slice(base.length) || "/";
        const hypothetical = [{ specId, operations: [{ method: "GET", path: canonicalPath, serverUrls: [serverUrl] }] }];
        return matchRefreshOperation(record, hypothetical).length === 1 ? [{ serverUrl, canonicalPath }] : [];
      });
      const bindings = [...new Map(servers.map(server => [JSON.stringify(server), server])).values()];
      if (bindings.length !== 1) continue; // Uncertain server-base/owner stays in discovery review.
      const body = JSON.parse(record.responseBodyForAnalysis);
      discoveryDrafts.push({ specId, method: "GET", path: bindings[0].canonicalPath, serverUrl: bindings[0].serverUrl,
        captureId, evidenceId: record.evidenceId, actionIndex: record.attribution.actionIndex, observedAt: record.observedAt ?? null,
        status: String(record.status), mimeType, schema: inferRefreshSchema(body), syntheticExample: syntheticRefreshExample(body), reviewRequired: true });
    }
  }
  const handoff = buildCandidateHandoff({ candidateQueue, specId, specTitle: spec.title, interactionHealth: health,
    interactionHealthStatus: { available: Boolean(health), accounting: health?.accounting ?? { consistent: false } },
    recovery: { captureComplete, captureStatus: captureComplete ? "complete" : "incomplete" },
    mutationSummary: summary.mutationSummary ?? null, saturation: null });
  const analysis = { schemaVersion: refreshAnalysisVersion, visibility: "private-evidence-only", artifactDirectory: artifacts, specId, captureId, inputDigest, analyzerDigest,
    captureComplete, recordSource, observations, enrichments: groupRefreshEnrichments(enrichments), enrichmentObservationCount: enrichments.length, discoveryDrafts, unmapped, ambiguous, candidateQueue, handoff, groupedHandoff: buildPartitionedCandidateHandoff(handoff),
    limitations: ["Transport health is scoped to observed requests; semantic-error checks cover known envelopes only.", "No non-observation or HTTP status recommends removal.", "Private analysis is not an accepted source-review receipt."] };
  if (await captureBinding(artifacts) !== inputDigest) throw new Error("Capture changed during refresh analysis.");
  await writeFile(cacheFile, json({ schemaVersion: 1, cacheKey, analysisDigest: digest(analysis), analysis }), { flag: "wx" });
  return { analysis, reused: false, cacheKey };
}

export async function loadVerifiedRefreshAnalysis(analysisPath) {
  await privateRefreshDirectory(path.dirname(path.resolve(analysisPath)));
  await assertNoRefreshLinks(analysisPath);
  const stored = await readJson(analysisPath);
  if (!stored.analysis || stored.analysisDigest !== digest(stored.analysis) || !/^[a-f0-9]{64}$/u.test(stored.cacheKey ?? "")
    || path.basename(analysisPath) !== `${stored.cacheKey}.json`) throw new Error("Refresh analysis cache binding is invalid.");
  const current = await analyzeRefreshCapture({ artifacts: stored.analysis.artifactDirectory, specId: stored.analysis.specId, cacheDir: path.dirname(path.resolve(analysisPath)) });
  if (current.cacheKey !== stored.cacheKey || digest(current.analysis) !== stored.analysisDigest) throw new Error("Refresh analysis is stale; recompute and review current selections.");
  return current.analysis;
}

// Existing controller entry point. Capture itself remains the existing discovery CLI.
// The stable report excludes private routes, bodies, property names and fingerprints.
export async function runPortfolioRefresh({ captures = [], cacheDir, asOf, freshnessDays = 30, outputDir = null } = {}) {
  if (!asOf) throw new Error("An explicit asOf date is required for repeatable refresh reports.");
  if (!Array.isArray(captures)) throw new Error("captures must be an array.");
  const inventory = await buildSpecRouteInventory();
  const results = [], blockers = [];
  const seen = new Set();
  for (const capture of captures) {
    let capturePath;
    try { capturePath = await realpath(capture.artifacts); }
    catch {
      blockers.push({ specId: inventory.some(spec => spec.specId === capture.specId) ? capture.specId : "unknown", code: "capture-directory-unavailable", freshCaptureRequired: false, nextStep: "Locate the retained private artifact directory before collecting again." });
      continue;
    }
    const identity = `${capture.specId}:${capturePath}`;
    if (seen.has(identity)) throw new Error("Duplicate refresh capture input.");
    seen.add(identity);
    try {
      results.push(await analyzeRefreshCapture({ ...capture, cacheDir, inventory }));
    } catch (error) {
      blockers.push({ specId: inventory.some(spec => spec.specId === capture.specId) ? capture.specId : "unknown",
        code: /sidecar|hash or length|integrity/iu.test(error.message) ? "evidence-integrity-unproved" : "refresh-input-invalid",
        freshCaptureRequired: false, nextStep: "Inspect the retained private inputs; preserve failed artifacts and do not promote their claims." });
    }
  }
  const { buildRefreshInventory } = await import("./portal-refresh-inventory.mjs");
  const portfolio = await buildRefreshInventory({ asOf, freshnessDays, observations: results.flatMap(result => result.analysis.observations) });
  const report = { schemaVersion: 1, mode: "report-only", asOf, actualAutomaticMergingEnabled: false,
    portfolio: { summary: portfolio.summary, specs: portfolio.specs.map(({ operations, ...spec }) => spec) },
    captures: results.map(({ analysis }) => ({ specId: analysis.specId, captureId: analysis.captureId, captureComplete: analysis.captureComplete,
      exactOperationCount: new Set(analysis.observations.map(entry => `${entry.specId}:${entry.method}:${entry.path}`)).size,
      attributedObservationCount: analysis.observations.filter(entry => entry.attributed).length,
      enrichmentReviewCount: analysis.enrichments.length, enrichmentObservationCount: analysis.enrichmentObservationCount, unmappedRecordCount: analysis.unmapped.length, ambiguousRecordCount: analysis.ambiguous.length,
      discoveryCandidateCount: analysis.candidateQueue.candidates.filter(entry => entry.documentationStatus !== "documented").length,
      discoveryDraftCount: analysis.discoveryDrafts.length,
      adjacentReviewCount: analysis.candidateQueue.scopeReviewCandidates.length,
      missingSignalMeansRemoval: false })),
    blockers, limitations: portfolio.limitations };
  if (outputDir) {
    outputDir = await privateRefreshDirectory(outputDir, { create: true, readOnlyRoots: captures.map(capture => path.resolve(capture.artifacts)) });
    for (const [filename, value] of [["inventory.json", portfolio], ["refresh-report.json", report]]) {
      const destination = path.join(outputDir, filename), bytes = json(value);
      await assertNoRefreshLinks(destination);
      try {
        if (await readFile(destination, "utf8") !== bytes) throw new Error("Refresh output exists with different inputs; select a new output directory.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await writeFile(destination, bytes, { flag: "wx" });
      }
    }
  }
  return { report, execution: { captureCount: captures.length, blockedCaptureCount: blockers.length, analysesReused: results.filter(result => result.reused).length,
    analysesComputed: results.filter(result => !result.reused).length, freshCapturesClaimed: false } };
}
