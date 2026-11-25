import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toApiRecord } from "../cdp-deep-capture.mjs";
import { buildObservation, buildSpecContext, aggregateCandidates } from "../generate-crawl-candidates.mjs";
import { buildPartitionedCandidateHandoff } from "../discovery-candidate-handoff.mjs";
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
    contractObservations: [{
      status: 200,
      mediaType: "application/json",
      responseShape: { count: "number" },
      responseShapeComplete: true,
      responseBodyState: "captured",
      requestBodyState: "empty",
      observationIds: ["obs-a"],
    }],
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
    familyId: family.familyId,
    outcome: "approved",
    ...family.reviewContext,
    safetyClass: family.key.safetyClass,
    ...reviewMetadata,
  })));
}

function realIndex({ origin = "https://alpha.api.example", body = '{"count":42}', evidenceId = "run-one", requestState = "empty", groupedOutput = false } = {}) {
  const context = buildSpecContext({
    specId: "widgets",
    title: "widgets",
    serverUrls: ["https://{organization}.api.example"],
    pathPrefixes: ["/api/"],
    operations: [],
  });
  const raw = {
    evidenceId,
    url: `${origin}/api/items`,
    method: "GET",
    status: 200,
    mimeType: "application/json",
    requestBody: "",
    requestBodyCapture: { state: requestState },
    responseBody: body,
    responseBodyCapture: { state: "captured" },
  };
  const candidates = aggregateCandidates([
    buildObservation(toApiRecord(raw, "synthetic"), "api-records.json", "confirmed"),
  ], context, false);
  const groupedInput = buildPartitionedCandidateHandoff({
    schemaVersion: 1,
    spec: { id: "widgets" },
    confirmedReadCandidates: candidates,
    confirmedSafetyReviewCandidates: [],
    successfullyProbedCandidates: [],
    bundleOnlyCandidates: [],
    suppressedCandidates: [],
    adjacentConfirmedReadCandidates: [],
    adjacentConfirmedSafetyReviewCandidates: [],
    adjacentSuccessfullyProbedCandidates: [],
    adjacentBundleOnlyCandidates: [],
  });
  return groupedOutput ? groupedInput : buildDerivativeFamilyIndex(groupedInput);
}

test("capture-to-handoff reuse binds exact origins and contracts but excludes run-local observation IDs", () => {
  const first = realIndex();
  const previous = approve(first);
  const repeated = realIndex({ evidenceId: "another-run" });
  assert.equal(first.families[0].familyId, repeated.families[0].familyId);
  assert.deepEqual(recommendDerivativeReuse(repeated, previous, reviewMetadata)[0].reasonCodes, ["reusable"]);
  for (const changed of [
    realIndex({ origin: "https://beta.api.example" }),
    realIndex({ body: '{"count":"changed-type"}' }),
  ]) {
    assert.equal(changed.families[0].key.hostFamily, first.families[0].key.hostFamily);
    assert.notEqual(changed.families[0].familyId, first.families[0].familyId);
    assert.equal(recommendDerivativeReuse(changed, previous, reviewMetadata)[0].decision, "review");
  }
  assert.doesNotMatch(JSON.stringify(first), /alpha\.api\.example|https:/u);
});

test("legacy, incomplete, null and unknown contracts cannot inherit derivative approval", () => {
  const complete = realIndex();
  const previous = approve(complete);
  const legacyGrouped = grouped();
  delete legacyGrouped.partitions[0].candidates[0].contractObservations;
  delete legacyGrouped.partitions[0].candidates[0].originBindingId;
  const legacy = buildDerivativeFamilyIndex(legacyGrouped);
  const partial = realIndex({ body: JSON.stringify([...Array(20).fill(42), "unseen-type"]) });
  const unknownRequest = realIndex({ requestState: "unknown" });
  const unknownResponse = realIndex({ body: "null" });
  for (const changed of [legacy, partial, unknownRequest, unknownResponse]) {
    assert.deepEqual(recommendDerivativeReuse(changed, previous, reviewMetadata)[0].reasonCodes, ["incomplete-contract-evidence"]);
  }
  assert.deepEqual(
    recommendDerivativeReuse(complete, { ...previous, schemaVersion: 1 }, reviewMetadata)[0].reasonCodes,
    ["version-mismatch"],
  );
});
