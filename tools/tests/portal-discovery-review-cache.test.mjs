import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReviewPacket } from "../portal-discovery-evidence-contract.mjs";
import { loadReviewCache, writeReviewCache } from "../portal-discovery-review-cache.mjs";
import { cacheValidatedReviewResult, digest, validateCachedReviewReuse, workerResultSubjectDigest } from "../portal-discovery-control-plane.mjs";

function reviewPlan(assignmentId) {
  const assignment = { type: "review", specId: "alpha", portal: "Alpha", route: "luna", model: "gpt-6-luna", reasoning: "xhigh", qualityGate: { model: "gpt-6.1-sol", reasoning: "medium" }, scope: { candidateIds: [], evidenceIds: [] }, assignmentId };
  assignment.assignmentDigest = digest(Object.fromEntries(Object.entries(assignment).filter(([key]) => !["assignmentId", "assignmentDigest"].includes(key))));
  return { schemaVersion: 1, assignments: [assignment] };
}

test("review cache preserves original identity and requires a current Sol applicability gate", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-review-cache-"));
  const packet = buildReviewPacket({ evidence: ["e1"], diff: ["d1"], scope: "sharepoint", policy: ["p1"], model: "gpt-6-luna", reasoning: "xhigh" });
  await writeReviewCache({ cacheDir, packet, workerResult: { assignmentId: "old-assignment", assignmentDigest: "a".repeat(64), model: "gpt-6-luna", reasoning: "xhigh", decision: "accept", blockers: [], metrics: { artifactDigest: "b".repeat(64) } } });
  const reused = await loadReviewCache({ cacheDir, packet, currentAssignment: { assignmentId: "new-assignment", assignmentDigest: "c".repeat(64) } });
  assert.equal(reused.reusable, true);
  assert.equal(reused.originalReview.assignmentId, "old-assignment");
  assert.equal(reused.applicability.assignmentId, "new-assignment");
  assert.equal(reused.reuseRequiresCurrentSolGate, true);
});

test("changed bindings miss the cache and critical defects prevent reuse", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-review-cache-"));
  const packet = buildReviewPacket({ evidence: ["e1"], diff: ["d1"], scope: "viva", policy: ["p1"], model: "gpt-6-luna", reasoning: "xhigh" });
  await writeReviewCache({ cacheDir, packet, workerResult: { assignmentId: "old", assignmentDigest: "a".repeat(64), model: "gpt-6-luna", reasoning: "xhigh", decision: "accept", blockers: ["privacy-defect"], metrics: {} } });
  const result = await loadReviewCache({ cacheDir, packet, currentAssignment: { assignmentId: "new", assignmentDigest: "b".repeat(64) } });
  assert.equal(result.reusable, false);
  const changed = buildReviewPacket({ evidence: ["e1"], diff: ["changed"], scope: "viva", policy: ["p1"], model: "gpt-6-luna", reasoning: "xhigh" });
  await assert.rejects(loadReviewCache({ cacheDir, packet: changed, currentAssignment: { assignmentId: "new", assignmentDigest: "b".repeat(64) } }), /ENOENT/);
});

test("control plane caches a validated review and reuses it only with a current Sol gate", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-review-cache-"));
  const packet = buildReviewPacket({ evidence: ["evidence-hash"], diff: ["diff-hash"], scope: { candidateIds: [], evidenceIds: [] }, policy: ["policy-hash"], model: "gpt-6-luna", reasoning: "xhigh" });
  const originalPlan = reviewPlan("review-original");
  const originalAssignment = originalPlan.assignments[0];
  const subject = { schemaVersion: 1, assignmentId: originalAssignment.assignmentId, assignmentDigest: originalAssignment.assignmentDigest, assignmentType: "review", status: "completed", model: "gpt-6-luna", reasoning: "xhigh", decision: "accept", reasonCodes: ["routine-read-only"], blockers: [], metrics: { complete: true }, recommendedNextAction: "none", lessons: [], processImprovementDisposition: "not-required", lifecycleAccounting: { terminalOwnerShutdown: true, artifactLedgerAccounting: true }, candidateAccounting: { accepted: [], rejected: [], escalated: [], blocked: [] }, evidenceAccounting: { accepted: [], rejected: [], escalated: [], blocked: [] } };
  const result = { ...subject, qualityGate: { schemaVersion: 1, model: "gpt-6.1-sol", reasoning: "medium", decision: "accept", assignmentId: originalAssignment.assignmentId, assignmentDigest: originalAssignment.assignmentDigest, workerResultDigest: workerResultSubjectDigest(subject), reviewedAt: "2026-10-03T12:00:00Z" } };
  const receipt = await cacheValidatedReviewResult({ cacheDir, packet, result, plan: originalPlan });
  assert.equal(receipt.originalAssignmentId, "review-original");

  const currentPlan = reviewPlan("review-current");
  const current = currentPlan.assignments[0];
  const gate = { schemaVersion: 1, model: "gpt-6.1-sol", reasoning: "medium", decision: "accept-cache-reuse", assignmentId: current.assignmentId, assignmentDigest: current.assignmentDigest, cacheKey: packet.cacheKey, packetDigest: packet.packetDigest, originalReviewDigest: receipt.originalReviewDigest, reviewedAt: "2026-10-03T13:00:00Z" };
  const reused = await validateCachedReviewReuse({ cacheDir, packet, plan: currentPlan, assignmentId: current.assignmentId, qualityGate: gate });
  assert.equal(reused.originalWorkerResult.assignmentId, "review-original");
  assert.equal(reused.applicability.assignmentId, "review-current");
  assert.equal(reused.freshWorkerExecutionClaimed, false);
  assert.equal(reused.freshCaptureClaimed, false);
  await assert.rejects(validateCachedReviewReuse({ cacheDir, packet, plan: currentPlan, assignmentId: current.assignmentId, qualityGate: { ...gate, originalReviewDigest: "0".repeat(64) } }), /binding mismatch/);
  const changed = structuredClone(packet);
  changed.bindings.diff = ["changed-diff-hash"];
  await assert.rejects(validateCachedReviewReuse({ cacheDir, packet: changed, plan: currentPlan, assignmentId: current.assignmentId, qualityGate: gate }), /packet digest binding mismatch/);
  const legitimatelyChanged = buildReviewPacket({ evidence: ["evidence-hash"], diff: ["changed-diff-hash"], scope: { candidateIds: [], evidenceIds: [] }, policy: ["policy-hash"], model: "gpt-6-luna", reasoning: "xhigh" });
  await assert.rejects(validateCachedReviewReuse({ cacheDir, packet: legitimatelyChanged, plan: currentPlan, assignmentId: current.assignmentId, qualityGate: { ...gate, cacheKey: legitimatelyChanged.cacheKey, packetDigest: legitimatelyChanged.packetDigest } }), /ENOENT/);
});
