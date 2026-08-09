import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
