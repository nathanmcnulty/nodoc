import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAutomationEvidence, normalizeBehavior, evidenceDimensions } from "../operation-behavior.mjs";
import { getNormalizedOperationContextRecords } from "../spec-quality-lib.mjs";
import { buildAutomationEvidenceLedger } from "../generate-automation-evidence-ledger.mjs";

const outcome = {
  conditions: ["License feature absent in compared context; resource existence not independently established"],
  httpStatus: 404, serviceCode: "LicenseUnavailable", interpretation: "Licensing is a hypothesis supported by comparison, not by the HTTP status alone.",
  confidence: "low", observationIds: ["obs-a", "obs-b"], counterexampleIds: ["obs-c"], observedAt: "2026-10-30T00:00:00Z",
};
test("behavior retains conditional error evidence and logical operation identity", () => {
  const behavior = { methodKnowledge: "observed", logicalOperation: { kind: "graphql", name: "ListItems" }, outcomes: [outcome], retry: { notes: ["Retry-After observed; replay safety not established"], observationIds: ["obs-a"] } };
  const operation = { "x-nodoc-operation-context": { behavior } };
  const records = getNormalizedOperationContextRecords({ paths: { "/query": { post: operation } } }, "fixture");
  assert.deepEqual(records.operations[0].operationContext.behavior, behavior);
  assert.throws(() => normalizeBehavior({ outcomes: [{ ...outcome, observationIds: [] }] }), /nonempty array/);
  assert.throws(() => normalizeBehavior({ outcomes: [{ ...outcome, httpStatus: 999 }] }), /httpStatus/);
  assert.throws(() => normalizeBehavior({ outcomes: [{ ...outcome, confidence: "certain" }] }), /confidence/);
  assert.throws(() => normalizeBehavior({ methodKnowledge: "all" }), /methodKnowledge/);
  assert.throws(() => normalizeBehavior({ outcomes: [{ ...outcome, observedAt: "today" }] }), /timestamp/);
  assert.throws(() => normalizeBehavior({ outcomes: [{ ...outcome, observedAt: "2026-02-31T00:00:00Z" }] }), /timestamp/);
  assert.throws(() => normalizeBehavior({ methodKnowledge: "validated-set" }), /supportedMethods/);
  assert.throws(() => normalizeBehavior({ methodKnowledge: "observed", supportedMethods: ["GET"] }), /validated-set/);
  assert.deepEqual(normalizeBehavior({ methodKnowledge: "validated-set", supportedMethods: ["GET", "HEAD"], methodObservationIds: ["obs-a"] }).supportedMethods, ["GET", "HEAD"]);
});
test("readiness requires evidence and dates without implying undocumented behavior is unsupported", () => {
  const evidence = normalizeAutomationEvidence({ existence: { state: "verified", observationIds: ["obs-a"], verifiedAt: "2026-10-30T00:00:00Z" } });
  assert.equal(evidence.existence.state, "verified");
  for (const dimension of evidenceDimensions.filter((key) => key !== "existence")) assert.deepEqual(evidence[dimension], { state: "unknown" });
  assert.throws(() => normalizeAutomationEvidence({ auth: { state: "verified" } }), /observationIds/);
  assert.throws(() => normalizeAutomationEvidence({ auth: { state: "verified", observationIds: ["obs-a"] } }), /verifiedAt/);
  assert.throws(() => normalizeAutomationEvidence({ auth: { state: "unsupported" } }), /invalid state/);
  assert.throws(() => normalizeAutomationEvidence({ authentication: {} }), /unknown field/);
  assert.throws(() => normalizeAutomationEvidence({ auth: { state: "inferred", observationIds: ["C:\\private\\capture.json"] } }), /opaque/);
  const ledger = buildAutomationEvidenceLedger([{ specId: "test", operations: [{ method: "GET", path: "/items", serverUrls: ["https://example.invalid"] }] }]);
  assert.equal(ledger.specifications[0].operations[0].defaultState, "unknown");
  assert.deepEqual(ledger.specifications[0].operations[0].evidence, {});
});
test("behavior rejects secret material through the actual spec normalizer", () => {
  const secretOutcome = { ...outcome, interpretation: `Bearer ${"x".repeat(30)}` };
  assert.throws(() => getNormalizedOperationContextRecords({ paths: { "/query": { get: { "x-nodoc-operation-context": { behavior: { outcomes: [secretOutcome] } } } } } }, "fixture"), /secret material/);
});
