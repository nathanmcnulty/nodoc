import assert from "node:assert/strict";
import test from "node:test";

import {
  compilePromotionPlan,
  promotionDigest,
  validatePromotionPlan,
  validatePromotionResult,
} from "../portal-discovery-promotion-planner.mjs";

const inventory = [
  { specId: "alpha", specPath: "specifications/nodoc-alpha/specification/openapi.yml", operations: [
    { method: "GET", path: "/v1/exact" },
    { method: "POST", path: "/v1/extend" },
  ] },
  { specId: "beta", specPath: "specifications/nodoc-beta/specification/openapi.yml", operations: [] },
];

function handoff(overrides = {}) {
  const candidates = overrides.candidates ?? [
    { candidateId: "exact", evidenceFamilyId: "ev-exact", evidence: "confirmed", documentationStatus: "documented", method: "GET", normalizedPath: "/v1/exact" },
    { candidateId: "extend", evidenceFamilyId: "ev-extend", evidence: "confirmed", documentationStatus: "undocumented", method: "PUT", normalizedPath: "/v1/extend" },
    { candidateId: "new", evidenceFamilyId: "ev-new", evidence: "successfully-probed", documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/new" },
  ];
  return {
    manifest: { totals: { candidateCount: candidates.length, evidenceFamilyCount: new Set(candidates.map((entry) => entry.evidenceFamilyId)).size }, sharedMetadata: {
      recovery: { captureComplete: true }, interactionHealthStatus: { available: true, accounting: { consistent: true } }, saturation: { eligibility: "known" },
    } },
    partitions: [{ destination: { specId: overrides.destinationSpec ?? "alpha", hostFamily: "alpha.example" }, reviewClass: overrides.reviewClass ?? "confirmed-read", candidates }],
  };
}

function approved(plan, candidateIds = ["extend", "new"]) {
  const assignment = plan.assignments[0];
  return [{ assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, assignmentType: "promotion-preparation", status: "completed", decision: "accept", reasonCodes: ["approved"], candidateAccounting: { accepted: candidateIds, rejected: [], escalated: [], blocked: [] } }];
}

test("maps exact, extension, and new candidates with stable focused grouping", () => {
  const first = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: [] });
  const plan = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: approved(first) });
  assert.deepEqual(plan, compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: approved(first) }));
  assert.equal(plan.mappings.find((entry) => entry.candidateId === "exact").outcome, "already-documented");
  assert.equal(plan.mappings.find((entry) => entry.candidateId === "extend").mapping, "extension");
  assert.equal(plan.mappings.find((entry) => entry.candidateId === "new").mapping, "novel");
  assert.equal(plan.measurements.expectedPrCount, 1);
  validatePromotionPlan(plan);
});

test("rejects adjacent, suppressed, bundle-only, and incomplete health", () => {
  for (const [reviewClass, evidence, expected] of [["adjacent-confirmed-read", "confirmed", "adjacent-scope"], ["suppressed", "confirmed", "suppressed-candidate"], ["bundle-only", "bundle-discovered", "bundle-only-candidate"]]) {
    const plan = compilePromotionPlan({ groupedHandoff: handoff({ reviewClass, candidates: [{ candidateId: "x", evidenceFamilyId: "ev-x", evidence, documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/x" }] }), specInventory: inventory });
    assert.ok(plan.mappings[0].reasonCodes.includes(expected));
  }
  const incomplete = handoff();
  incomplete.manifest.sharedMetadata.recovery.captureComplete = false;
  assert.equal(compilePromotionPlan({ groupedHandoff: incomplete, specInventory: inventory }).mappings[0].reasonCodes[0], "incomplete-health");
});

test("preserves multi-evidence traceability and routes ambiguous destinations", () => {
  const grouped = handoff({ destinationSpec: "unassigned", candidates: [{ candidateId: "multi", evidenceIds: ["ev-a", "ev-b"], evidenceFamilyId: "ev-a", evidence: "confirmed", documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/multi" }] });
  const plan = compilePromotionPlan({ groupedHandoff: grouped, specInventory: inventory });
  assert.deepEqual(plan.mappings[0].evidenceIds, ["ev-a", "ev-b"]);
  assert.ok(plan.mappings[0].reasonCodes.includes("ambiguous-destination"));
  assert.equal(plan.measurements.exactTraceabilityCount, 1);
  assert.doesNotMatch(JSON.stringify(plan), /tenant|bearer|cookie|https?:\/\//i);
});

test("validates promotion result capability and exact cardinality", () => {
  const initial = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory });
  const plan = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: approved(initial) });
  const assignment = plan.assignments[0];
  const result = { assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, assignmentType: "promotion-preparation", status: "completed", decision: "accept", candidateAccounting: { accepted: assignment.candidateIds, rejected: [], escalated: [], blocked: [] } };
  assert.equal(validatePromotionResult({ schemaVersion: 1, ...result }, plan).sanitized, true);
  assert.throws(() => validatePromotionResult({ schemaVersion: 1, ...result, candidateAccounting: { accepted: ["extend"], rejected: [], escalated: [], blocked: [] } }, plan), /exact/);
  assert.equal(typeof promotionDigest(plan), "string");
});

test("fails closed on incompatible schemas and promotion budgets", () => {
  const input = fixture();
  input.budgets = { maxChanges: 1, maxPrs: 1, maxFiles: 1 };
  input.groupedHandoff.partitions.push({
    ...input.groupedHandoff.partitions[0],
    destination: { specId: "missing-spec", hostFamily: "service" },
    candidates: [{ candidateId: "conflict", evidenceFamilyId: "ev-conflict", evidence: "confirmed", documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/conflict", responseShapeFingerprint: "changed" }],
  });
  input.groupedHandoff.manifest.totals.candidateCount += 1;
  input.groupedHandoff.manifest.totals.evidenceFamilyCount += 1;
  assert.throws(() => compilePromotionPlan(input), /candidate cardinality|evidence cardinality|digest/i);
});
