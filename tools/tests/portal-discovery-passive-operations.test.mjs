import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPassiveOperationReceipts,
  validatePassiveOperationReceiptArtifact,
} from "../portal-discovery-passive-operations.mjs";

function request(overrides = {}) {
  return {
    attribution: { actionIndex: 1, checkpoint: "sentinel-graph", sessionId: "root", targetId: "target-1" },
    evidenceId: "evidence-default",
    method: "GET",
    startedAt: 10,
    status: 200,
    url: "https://security.microsoft.com/apiproxy/example/status?tenant=secret-tenant",
    ...overrides,
  };
}

test("passive receipts flag a successful provisioning operation without leaking query values", () => {
  const artifact = buildPassiveOperationReceipts({
    actionResults: [null, { type: "navigate" }],
    requests: [
      request({ evidenceId: "before", startedAt: 10 }),
      request({
        evidenceId: "create",
        method: "POST",
        requestShapeFingerprint: "request-shape",
        responseShapeFingerprint: "response-shape",
        startedAt: 20,
        url: "https://security.microsoft.com/apiproxy/securityplatform/sentinelgraph/provisioning/create?api-version=2026-01-01&tenant=secret-tenant",
      }),
    ],
  });

  assert.equal(artifact.summary.potentialSideEffectCount, 1);
  assert.equal(artifact.summary.successfulUnverifiedCount, 1);
  assert.equal(artifact.operations[0].safety.requiresSafetyReview, true);
  assert.equal(artifact.operations[0].contextReads.coverage, "before-only");
  assert.deepEqual(artifact.operations[0].queryParameterNames, ["api-version", "tenant"]);
  assert.equal(JSON.stringify(artifact).includes("secret-tenant"), false);
});

test("passive receipts separate likely read-like POSTs from unknown operations", () => {
  const artifact = buildPassiveOperationReceipts({
    requests: [
      request({ evidenceId: "query", method: "POST", startedAt: 20, url: "https://example.test/attacksurface/query" }),
      request({ evidenceId: "command", method: "POST", startedAt: 30, url: "https://example.test/actions/execute" }),
    ],
  });

  assert.equal(artifact.summary.likelyReadLikeCount, 1);
  assert.equal(artifact.summary.unknownCount, 1);
  assert.equal(artifact.summary.safetyReviewCount, 1);
});

test("planned aborted operations retain their verified active-operation state", () => {
  const artifact = buildPassiveOperationReceipts({
    operationReceipts: [{
      executionState: "aborted-before-send",
      evidence: { invoke: { evidenceId: "delete" } },
    }],
    requests: [request({
      abortedBeforeSend: true,
      evidenceId: "delete",
      method: "DELETE",
      status: null,
      url: "https://example.test/items/12345",
    })],
  });

  assert.equal(artifact.operations[0].source, "planned-active-operation");
  assert.equal(artifact.operations[0].safety.sent, false);
  assert.equal(artifact.operations[0].safety.verification, "aborted-before-send");
  assert.equal(artifact.operations[0].safety.requiresSafetyReview, false);
});

test("passive receipt validation rejects missing evidence and summary drift", () => {
  const artifact = buildPassiveOperationReceipts({
    requests: [request({ evidenceId: "query", method: "POST", url: "https://example.test/items/query" })],
  });
  assert.deepEqual(validatePassiveOperationReceiptArtifact(artifact, artifact.summary), artifact.summary);
  assert.throws(
    () => validatePassiveOperationReceiptArtifact({ ...artifact, summary: { ...artifact.summary, count: 2 } }),
    /summary does not match/,
  );
  assert.throws(
    () => validatePassiveOperationReceiptArtifact({ ...artifact, operations: [{ method: "POST", path: "/items/query", safety: {} }] }),
    /incomplete operation/,
  );
});
