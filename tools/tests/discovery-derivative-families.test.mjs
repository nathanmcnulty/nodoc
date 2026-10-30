import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toApiRecord } from "../cdp-deep-capture.mjs";
import { buildObservation, buildSpecContext, aggregateCandidates } from "../generate-crawl-candidates.mjs";
import { buildPartitionedCandidateHandoff } from "../discovery-candidate-handoff.mjs";
import { compileIntegratedController } from "../portal-discovery-controller.mjs";
import { buildPortfolioManifest } from "../portal-discovery-control-plane.mjs";
import { loadBenchmarkCorpus } from "../portal-discovery-benchmark.mjs";
import {
  attachDerivativeReviews,
  buildDerivativeFamilyIndex,
  measureDerivativeCompaction,
  readDerivativeFamilyIndex,
  recommendDerivativeReuse,
  writeDerivativeFamilyIndex,
} from "../discovery-derivative-families.mjs";

function grouped(overrides = {}) {
  const candidate = {
    candidateId: "run-local-1",
    evidenceFamilyId: "run-local-evidence-1",
    method: "GET",
    normalizedPath: "/v1/widgets/{id}",
    routeTemplate: "/v1/widgets/{id}",
    queryKeyShape: ["include"],
    responseShapeFingerprint: "shape-a",
    originBindingId: "a".repeat(64),
    contractObservations: [{ status: 200, mediaType: "application/json", responseShape: { count: "number" }, responseShapeComplete: true, responseBodyState: "captured", requestBodyState: "empty", observationIds: ["obs-a"] }],
    provenance: ["sanitized-source"],
  };
  const partition = {
    destination: { specId: "widgets", hostFamily: "api.example" },
    reviewClass: "confirmed-read",
    candidates: [candidate],
  };
  return { manifest: { schemaVersion: 1, totals: { candidateCount: 1, evidenceFamilyCount: 1 } }, partitions: [partition], ...overrides };
}

test("identical normalized families reuse while run-local identities and evidence references remain exact", () => {
  const first = buildDerivativeFamilyIndex(grouped());
  const second = buildDerivativeFamilyIndex(grouped({ partitions: [{ ...grouped().partitions[0], candidates: [{ ...grouped().partitions[0].candidates[0], candidateId: "another-run-id", evidenceFamilyId: "another-evidence-id" }] }] }));
  assert.equal(first.families[0].familyId, second.families[0].familyId);
  assert.equal(first.totals.candidateCount, 1);
  assert.equal(second.candidateFamilyRefs[0].candidateId, "another-run-id");
  assert.equal(second.evidenceFamilyRefs[0].evidenceFamilyId, "another-evidence-id");
});

test("shape, safety, scope, adjacent, health, and version changes do not inherit approval", () => {
  const current = buildDerivativeFamilyIndex(grouped());
  const previous = attachDerivativeReviews(current, [{ familyId: current.families[0].familyId, outcome: "approved", destinationSpec: "widgets", hostFamily: "api.example", safetyClass: "read-only", captureHealthFingerprint: "healthy", analyzerVersion: "a", schemaVersion: 1, provenanceFingerprint: "p" }]);
  assert.deepEqual(recommendDerivativeReuse(current, previous, { captureHealthFingerprint: "healthy", analyzerVersion: "a", schemaVersion: 1, provenanceFingerprint: "p" })[0].reasonCodes, ["reusable"]);
  for (const mutation of [
    { responseShapeFingerprint: "shape-b" },
    { safetyClass: "safety-review" },
    { scopeFlags: ["adjacent"] },
  ]) {
    const changed = buildDerivativeFamilyIndex(grouped({ partitions: [{ ...grouped().partitions[0], candidates: [{ ...grouped().partitions[0].candidates[0], ...mutation }] }] }));
    assert.notEqual(changed.families[0].familyId, current.families[0].familyId);
    assert.equal(recommendDerivativeReuse(changed, previous, { captureHealthFingerprint: "healthy", analyzerVersion: "a", schemaVersion: 1, provenanceFingerprint: "p" })[0].decision, "review");
  }
  assert.deepEqual(recommendDerivativeReuse(current, previous, { captureHealthFingerprint: "incomplete", analyzerVersion: "a", schemaVersion: 1, provenanceFingerprint: "p" })[0].reasonCodes, ["incomplete-health"]);
  assert.deepEqual(recommendDerivativeReuse(current, previous, { captureHealthFingerprint: "healthy", analyzerVersion: "b", schemaVersion: 1, provenanceFingerprint: "p" })[0].reasonCodes, ["version-mismatch"]);
});

test("stable metrics and atomic idempotent persistence reject corruption", async () => {
  const groupedInput = grouped();
  const index = buildDerivativeFamilyIndex(groupedInput);
  const metrics = measureDerivativeCompaction(groupedInput, index);
  assert.equal(metrics.candidatesPreserved, 1);
  assert.equal(metrics.evidenceReferencesPreserved, 1);
  assert.equal(buildDerivativeFamilyIndex(groupedInput).digest, index.digest);
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-family-"));
  const filePath = path.join(directory, "index.json");
  await writeDerivativeFamilyIndex(index, filePath);
  await writeDerivativeFamilyIndex(index, filePath);
  assert.equal((await readDerivativeFamilyIndex(filePath)).status, "ok");
  const persisted = await readFile(filePath, "utf8");
  assert.equal(/tenant|bearer|cookie|https?:\/\//i.test(persisted), false);
  assert.equal(persisted.includes("C:\\"), false);
  await rm(filePath);
  await (await import("node:fs/promises")).writeFile(filePath, "{}", "utf8");
  assert.equal((await readDerivativeFamilyIndex(filePath)).status, "miss");
  await rm(directory, { recursive: true, force: true });
});

const reviewMetadata = { captureHealthFingerprint: "healthy", analyzerVersion: "a", schemaVersion: 1, provenanceFingerprint: "p" };
function approve(index) {
  return attachDerivativeReviews(index, index.families.map((family) => ({
    familyId: family.familyId, outcome: "approved", ...family.reviewContext,
    safetyClass: family.key.safetyClass, ...reviewMetadata,
  })));
}
function realIndex({ origin = "https://alpha.api.example", body = '{"count":42}', evidenceId = "run-one", requestState = "empty", groupedOutput = false } = {}) {
  const context = buildSpecContext({ specId: "widgets", title: "widgets", serverUrls: ["https://{organization}.api.example"], pathPrefixes: ["/api/"], operations: [] });
  const raw = { evidenceId, url: `${origin}/api/items`, method: "GET", status: 200, mimeType: "application/json", requestBody: "", requestBodyCapture: { state: requestState }, responseBody: body, responseBodyCapture: { state: "captured" } };
  const candidates = aggregateCandidates([buildObservation(toApiRecord(raw, "synthetic"), "api-records.json", "confirmed")], context, false);
  const groupedInput = buildPartitionedCandidateHandoff({
    schemaVersion: 1, spec: { id: "widgets" }, confirmedReadCandidates: candidates,
    confirmedSafetyReviewCandidates: [], successfullyProbedCandidates: [], bundleOnlyCandidates: [], suppressedCandidates: [],
    adjacentConfirmedReadCandidates: [], adjacentConfirmedSafetyReviewCandidates: [], adjacentSuccessfullyProbedCandidates: [], adjacentBundleOnlyCandidates: [],
  });
  return groupedOutput ? groupedInput : buildDerivativeFamilyIndex(groupedInput);
}

test("real capture-to-handoff reuse binds exact origins and contracts while excluding run-local references", () => {
  const first = realIndex();
  const previous = approve(first);
  const repeated = realIndex({ evidenceId: "another-run" });
  assert.equal(first.families[0].familyId, repeated.families[0].familyId);
  assert.deepEqual(recommendDerivativeReuse(repeated, previous, reviewMetadata)[0].reasonCodes, ["reusable"]);
  assert.notDeepEqual(first.evidenceFamilyRefs, []);
  for (const changed of [realIndex({ origin: "https://beta.api.example" }), realIndex({ body: '{"count":"changed-type"}' })]) {
    assert.equal(changed.families[0].key.hostFamily, first.families[0].key.hostFamily);
    assert.notEqual(changed.families[0].familyId, first.families[0].familyId);
    assert.equal(recommendDerivativeReuse(changed, previous, reviewMetadata)[0].decision, "review");
  }
  assert.doesNotMatch(JSON.stringify(first), /alpha\.api\.example|https:/u);
});

test("unknown, partial, overflow and legacy contracts cannot reuse an approval", () => {
  const partial = realIndex({ body: JSON.stringify([...Array(20).fill(42), "unseen-type"]) });
  const unknownRequest = realIndex({ requestState: "unknown" });
  const legacyInput = grouped();
  delete legacyInput.partitions[0].candidates[0].contractObservations;
  delete legacyInput.partitions[0].candidates[0].originBindingId;
  const legacy = buildDerivativeFamilyIndex(legacyInput);
  const unknownResponse = realIndex({ body: "null" });
  const overflowInput = grouped();
  overflowInput.partitions[0].candidates[0].contractObservations = Array.from({ length: 140 }, (_, index) => ({
    status: 404, mediaType: "application/json", responseShape: { code: "string" }, responseShapeComplete: true,
    responseBodyState: "captured", requestBodyState: "empty", errorSignatures: [index.toString(16).padStart(64, "0")],
  }));
  const overflow = buildDerivativeFamilyIndex(overflowInput);
  for (const index of [partial, unknownRequest, legacy, unknownResponse, overflow]) {
    assert.deepEqual(recommendDerivativeReuse(index, approve(index), reviewMetadata)[0].reasonCodes, ["incomplete-contract-evidence"]);
  }
  const complete = realIndex();
  const oldVersion = { ...approve(complete), schemaVersion: 1 };
  assert.deepEqual(recommendDerivativeReuse(complete, oldVersion, reviewMetadata)[0].reasonCodes, ["version-mismatch"]);
});

test("missing health, analyzer or provenance fingerprints never inherit approval by equality of undefined", () => {
  const index = realIndex();
  for (const [field, reason] of [["captureHealthFingerprint", "incomplete-health"], ["analyzerVersion", "version-mismatch"], ["provenanceFingerprint", "missing-provenance"]]) {
    const priorMetadata = { ...reviewMetadata }; delete priorMetadata[field];
    const approved = attachDerivativeReviews(index, [{ familyId: index.families[0].familyId, outcome: "approved", ...index.families[0].reviewContext, safetyClass: "read-only", ...priorMetadata }]);
    assert.deepEqual(recommendDerivativeReuse(index, approved, priorMetadata)[0].reasonCodes, [reason]);
  }
});

test("route, query parameter and logical operation case remain distinct while method and host normalize", () => {
  const input = grouped();
  const base = input.partitions[0].candidates[0];
  base.operation = { operationType: "query", name: "GetWidgets", persistedQueryHash: "a".repeat(64) };
  const index = buildDerivativeFamilyIndex(input);
  const previous = approve(index);
  const withCandidate = (mutation) => buildDerivativeFamilyIndex(grouped({ partitions: [{ ...input.partitions[0], candidates: [{ ...base, ...mutation }] }] }));
  for (const mutation of [
    { routeTemplate: "/v1/Widgets/{id}" },
    { queryKeyShape: ["Include"] },
    { operation: { ...base.operation, name: "getWidgets" } },
  ]) {
    const changed = withCandidate(mutation);
    assert.notEqual(changed.families[0].familyId, index.families[0].familyId);
    assert.equal(recommendDerivativeReuse(changed, previous, reviewMetadata)[0].decision, "review");
  }
  assert.equal(withCandidate({ method: "get", hostFamily: "API.EXAMPLE", candidateId: "new-run", evidenceFamilyId: "new-evidence" }).families[0].familyId, index.families[0].familyId);
});

test("real derivative index passes integrated controller privacy validation without run-local refs or raw values", async () => {
  const manifest = await buildPortfolioManifest();
  const benchmarkCorpus = await loadBenchmarkCorpus();
  // API field names may contain security vocabulary; actual values cannot.
  const groupedHandoff = realIndex({ body: '{"tenantId":"private-value","authorization":"private-value","secret":"private-value"}', groupedOutput: true });
  const derivativeFamilyIndex = buildDerivativeFamilyIndex(groupedHandoff);
  const input = { manifest, benchmarkCorpus, groupedHandoff, stageInputs: { derivatives: { derivativeFamilyIndex, previousDerivativeFamilyIndex: approve(derivativeFamilyIndex), derivativeReviewMetadata: reviewMetadata } }, discovery: { saturation: "unknown" } };
  const controller = compileIntegratedController(input);
  assert.equal(controller.mode, "report-only");
  assert.equal(controller.reviewPlan.assignments[0].derivativeReuseRecommendations[0].decision, "reusable");
  assert.ok(derivativeFamilyIndex.families[0].key.contractObservations.every((observation) => observation.observationIds.length === 0));
  assert.doesNotMatch(JSON.stringify(derivativeFamilyIndex), /private-value/u);
  const invalid = structuredClone(derivativeFamilyIndex);
  invalid.families[0].key.contractObservations[0].responseShape.secret = "raw-captured-value";
  assert.throws(() => compileIntegratedController({ ...input, stageInputs: { derivatives: { derivativeFamilyIndex: invalid } } }), /prohibited sensitive data/u);
});
