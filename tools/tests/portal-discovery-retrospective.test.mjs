import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRetrospective,
  retrospectiveDigest,
  validateRetrospective,
} from "../portal-discovery-retrospective.mjs";

const assignment = { assignmentId: "review-a", assignmentDigest: "digest-a" };
const base = {
  schemaVersion: 1,
  runId: "run-1",
  scope: { portals: ["portal-a"], specs: ["spec-a"] },
  sources: {
    plan: { sourceId: "plan-1", digest: "plan-digest", schemaVersion: 1 },
    health: { sourceId: "health-1", digest: "health-digest", schemaVersion: 1 },
  },
  assignments: [assignment],
  candidates: { count: 2, validatedCount: 1, approvedCount: 1 },
  evidence: { count: 2 },
  promotion: { proposedChangeCount: 1 },
  outcomes: { mergedResultCount: 1 },
  reviewResults: { validationFailureCount: 1 },
  escalations: { count: 1 },
  recovery: { retryCount: 1, incidentCount: 1 },
  modelUsage: { records: [] },
  improvementObservations: [],
  nextActions: ["review proposed improvements"],
};

test("compiles stable retrospective with exact source and cardinality metrics", () => {
  const first = compileRetrospective(base);
  const second = compileRetrospective(base);
  assert.deepEqual(first, second);
  assert.equal(first.sources.length, 2);
  assert.equal(first.metrics.candidateCount, 2);
  assert.equal(first.metrics.actualTokens.total, null);
  assert.equal(first.metrics.cost.status, "unavailable");
  validateRetrospective(first);
});

test("distinguishes actual telemetry from estimates and computes explicit pricing", () => {
  const input = structuredClone(base);
  input.modelUsage.records = [
    { telemetryId: "actual-1", kind: "actual", assignmentId: "review-a", assignmentDigest: "digest-a", assignmentType: "review", specId: "spec-a", modelId: "gpt-5.6-luna", provider: "provider", source: "runtime-telemetry", inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
    { telemetryId: "estimate-1", kind: "estimate", assignmentId: "review-a", assignmentDigest: "digest-a", assignmentType: "review", specId: "spec-a", modelId: "gpt-5.6-luna", tokenizer: "synthetic", tokenizerVersion: "1", serializedPromptBytes: 1000, serializedContextBytes: 2000, estimatedInputTokens: 50, estimatedOutputTokens: 10, confidence: "low" },
  ];
  input.pricing = { schemaVersion: 1, version: "fixture-1", currency: "USD", rates: [{ modelId: "gpt-5.6-luna", inputPerMillion: 1, outputPerMillion: 2 }] };
  const result = compileRetrospective(input);
  assert.deepEqual(result.metrics.actualTokens, { input: 100, output: 20, total: 120 });
  assert.deepEqual(result.metrics.estimatedTokens, { input: 50, output: 10, total: 60 });
  assert.equal(result.modelUsage.actualRecordCount, 1);
  assert.equal(result.modelUsage.estimateRecordCount, 1);
  assert.equal(result.metrics.cost.actual, 0.00014);
  assert.equal(result.metrics.cost.estimated, 0.00007);
});

test("uses support threshold and critical invariants for deterministic queue states", () => {
  const input = structuredClone(base);
  input.improvementObservations = [
    { class: "recipe-weakness", reasonCode: "recipe-miss", surface: "portal-a", evidenceRefs: ["ev-1"] },
    { class: "recipe-weakness", reasonCode: "recipe-miss", surface: "portal-a", evidenceRefs: ["ev-2"] },
    { class: "analyzer-blind-spot", reasonCode: "analyzer-one-off", surface: "spec-a", evidenceRefs: ["ev-3"] },
    { class: "operational-incident", reasonCode: "exact-cardinality-mismatch", surface: "control-plane", evidenceRefs: ["ev-4"] },
  ];
  const proposals = compileRetrospective(input).improvementQueue.proposals;
  assert.equal(proposals.find((p) => p.reasonCodes[0] === "recipe-miss").state, "proposed");
  assert.equal(proposals.find((p) => p.reasonCodes[0] === "analyzer-one-off").state, "observe");
  assert.equal(proposals.find((p) => p.reasonCodes[0] === "exact-cardinality-mismatch").state, "proposed");
});

test("fails closed on duplicate, unknown, mismatched, impossible, and unsafe telemetry", () => {
  const make = (records) => { const input = structuredClone(base); input.modelUsage.records = records; return input; };
  const telemetry = { telemetryId: "t", kind: "actual", assignmentId: "review-a", assignmentDigest: "digest-a", modelId: "m", provider: "p", source: "s", inputTokens: 1 };
  assert.throws(() => compileRetrospective(make([telemetry, telemetry])), /Duplicate telemetry/);
  assert.throws(() => compileRetrospective(make([{ ...telemetry, telemetryId: "u", assignmentId: "unknown" }])), /Unknown telemetry/);
  assert.throws(() => compileRetrospective(make([{ ...telemetry, telemetryId: "d", assignmentDigest: "wrong" }])), /digest mismatch/);
  assert.throws(() => compileRetrospective(make([{ ...telemetry, telemetryId: "n", inputTokens: -1 }])), /non-negative/);
  assert.throws(() => compileRetrospective({ ...base, nextActions: ["https://tenant.example/path"] }), /tenant|raw URL/iu);
});

test("keeps proposal IDs and order stable", () => {
  const input = structuredClone(base);
  input.improvementObservations = [
    { class: "ci-workflow-gap", reasonCode: "site-check-missing", surface: "ci", evidenceRefs: ["ev-1"] },
    { class: "model-disagreement", reasonCode: "review-disagreement", surface: "review", evidenceRefs: ["ev-2"] },
  ];
  const result = compileRetrospective(input);
  assert.deepEqual(result.improvementQueue.proposals.map((p) => p.proposalId), [...result.improvementQueue.proposals].sort((a, b) => a.proposalId.localeCompare(b.proposalId)).map((p) => p.proposalId));
  assert.equal(result.measurements.synthetic, true);
  assert.equal(typeof retrospectiveDigest(result), "string");
});
