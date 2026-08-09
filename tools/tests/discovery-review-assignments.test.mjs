import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildReviewAssignmentPlan, measureReviewAssignmentPlan, validateReviewAssignmentPlan } from "../discovery-review-assignments.mjs";

function grouped(overrides = {}) {
  const partitions = [
    { schemaVersion: 1, sharedMetadataId: "shared", destination: { specId: "alpha", hostFamily: "alpha.example" }, reviewClass: "confirmed-read", candidates: [{ candidateId: "read-1", evidenceFamilyId: "e-1" }] },
    { schemaVersion: 1, sharedMetadataId: "shared", destination: { specId: "beta", hostFamily: "other.example" }, reviewClass: "adjacent-confirmed-read", candidates: [{ candidateId: "adj-1", evidenceFamilyId: "e-2" }] },
  ];
  const stable = (value) => `${JSON.stringify(value)}\n`;
  const digest = (value) => createHash("sha256").update(stable(value)).digest("hex");
  const entries = partitions.map((partition) => {
    const partitionId = `partition-${digest({ destination: partition.destination, reviewClass: partition.reviewClass }).slice(0, 24)}`;
    const serialized = stable(partition);
    return { partitionId, destinationSpec: partition.destination.specId, hostFamily: partition.destination.hostFamily, reviewClass: partition.reviewClass, candidateCount: 1, evidenceFamilyCount: 1, serializedByteCount: Buffer.byteLength(serialized), stableDigest: digest(partition), blockers: partition.reviewClass.includes("adjacent") ? ["explicit-spec-and-host-assignment-required"] : [] };
  });
  return { manifest: { schemaVersion: 1, sharedMetadataId: "shared", sharedMetadata: { interactionHealthStatus: { available: true }, recovery: { captureComplete: true } }, partitions: entries, totals: { candidateCount: 2, evidenceFamilyCount: 2 } }, partitions, ...overrides };
}

test("routes routine reads cheaply and isolates adjacent work", async () => {
  const plan = buildReviewAssignmentPlan(grouped());
  assert.equal(plan.routingCounts.cheap, 1);
  assert.equal(plan.routingCounts.manual, 1);
  assert.equal(plan.assignments[0].candidateCount, 1);
  assert.equal(plan.totals.assignmentCount, 2);
  assert.equal(measureReviewAssignmentPlan(plan).maxWorkerPartitionByteCount > 0, true);
  assert.deepEqual(plan, buildReviewAssignmentPlan(grouped()));
});

test("health blockers escalate and invalid plan routes cannot be cheap", () => {
  const plan = buildReviewAssignmentPlan(grouped({
    manifest: { ...grouped().manifest, sharedMetadata: { interactionHealthStatus: { available: false }, recovery: { captureComplete: false } } },
  }));
  assert.equal(plan.routingCounts.luna, 1);
  assert.throws(() => validateReviewAssignmentPlan({ ...plan, assignments: plan.assignments.map((a) => ({ ...a, route: "cheap", blockers: ["health-unavailable"] })) }), /cheap route/);
});
