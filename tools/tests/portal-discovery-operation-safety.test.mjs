import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidateHandoff } from "../discovery-candidate-handoff.mjs";
import {
  buildAbortOperationReceipt,
  buildReversibleOperationReceipt,
  computeOperationApprovalDigest,
  handlePausedOperationRequest,
  summarizeOperationReceipts,
  validateOperationAuthorization,
  validateMutationEventsArtifact,
  validateOperationSummary,
} from "../portal-discovery-operation-safety.mjs";

const targetUrl = "https://portal.example.test/settings";
const mutationUrl = "https://api.example.test/settings/one";
const stateUrl = "https://api.example.test/settings/one/state";
const requestBodyShapeFingerprint = "b".repeat(64);

function signed(plan) {
  return { ...plan, approvalDigest: computeOperationApprovalDigest(plan) };
}

function abortPlan() {
  return signed({
    operationId: "abort-setting-update",
    mode: "abort-only",
    steps: {
      invoke: { actionIndex: 0, method: "PATCH", requestBodyShapeFingerprint, targetUrl, url: mutationUrl },
    },
  });
}

function reversiblePlan() {
  return signed({
    operationId: "toggle-setting-and-restore",
    mode: "reversible-scalar",
    concurrency: { mode: "etag" },
    scalar: { jsonPointer: "/enabled", testValue: true, type: "boolean" },
    steps: {
      preState: { actionIndex: 0, method: "GET", url: stateUrl },
      apply: { actionIndex: 1, method: "PATCH", requestBodyShapeFingerprint, targetUrl, url: mutationUrl },
      postState: { actionIndex: 2, method: "GET", url: stateUrl },
      rollback: { actionIndex: 3, method: "PATCH", requestBodyShapeFingerprint, targetUrl, url: mutationUrl },
      finalState: { actionIndex: 4, method: "GET", url: stateUrl },
    },
  });
}

function request(actionIndex, method, url, overrides = {}) {
  return {
    attribution: { actionIndex, targetUrl },
    evidenceId: `evidence-${actionIndex}`,
    headers: {},
    method,
    requestBody: null,
    requestShapeFingerprint: requestBodyShapeFingerprint,
    responseBody: null,
    responseHeaders: {},
    status: 200,
    sessionId: "root",
    targetId: "target-1",
    url,
    ...overrides,
  };
}

function successfulReversibleEvidence() {
  return [
    request(0, "GET", stateUrl, {
      responseBody: JSON.stringify({ enabled: false }),
      responseHeaders: { ETag: '"before"' },
    }),
    request(1, "PATCH", mutationUrl, {
      headers: { "If-Match": '"before"' },
      requestBody: JSON.stringify({ enabled: true }),
    }),
    request(2, "GET", stateUrl, {
      responseBody: JSON.stringify({ enabled: true }),
      responseHeaders: { etag: '"after"' },
    }),
    request(3, "PATCH", mutationUrl, {
      headers: { "if-match": '"after"' },
      requestBody: JSON.stringify({ enabled: false }),
    }),
    request(4, "GET", stateUrl, {
      responseBody: JSON.stringify({ enabled: false }),
      responseHeaders: { etag: '"restored"' },
    }),
  ];
}

function safeInterception({ rollback = true } = {}) {
  const gate = {
    approvedRequestCount: 1,
    boundSessionId: "root",
    boundTargetId: "target-1",
    duplicateApprovedRequestCount: 0,
    matchedRequestCount: 1,
    matchedSessionId: "root",
    matchedTargetId: "target-1",
    setupFailureCount: 0,
    unexpectedActiveRequestCount: 0,
    uniqueControl: true,
  };
  return { apply: gate, ...(rollback ? { rollback: gate } : {}) };
}

test("active operation authorization is exact and observe-only remains the default", () => {
  assert.equal(validateOperationAuthorization(), null);
  const plan = abortPlan();
  const actions = [{ type: "click-automation-id", value: "SaveSetting" }];
  assert.equal(validateOperationAuthorization({
    activeOperations: [plan],
    actions,
    ceiling: "abort-only",
    approvalDigest: plan.approvalDigest,
  }).operationId, plan.operationId);
  assert.throws(() => validateOperationAuthorization({
    activeOperations: [plan],
    actions,
    ceiling: "reversible-scalar",
    approvalDigest: plan.approvalDigest,
  }), /does not match recipe mode/u);
  assert.throws(() => validateOperationAuthorization({
    activeOperations: [plan],
    actions,
    ceiling: "abort-only",
    approvalDigest: "0".repeat(64),
  }), /does not match the checked-in plan/u);
  const missingShape = abortPlan();
  delete missingShape.steps.invoke.requestBodyShapeFingerprint;
  delete missingShape.approvalDigest;
  assert.throws(
    () => validateOperationAuthorization({
      activeOperations: [missingShape],
      actions,
      ceiling: "abort-only",
      approvalDigest: "0".repeat(64),
    }),
    /every active mutation step/u,
  );
});

test("Fetch policy fails the exact approved request, fails other mutations closed, and continues reads", async () => {
  const plan = abortPlan();
  const commands = [];
  const send = async (method, params) => commands.push({ method, params });
  const exact = request(0, "PATCH", mutationUrl);

  assert.equal((await handlePausedOperationRequest({ plan, request: exact, requestId: "one", send })).action, "failed-approved-operation");
  assert.equal((await handlePausedOperationRequest({
    plan,
    request: request(0, "POST", "https://api.example.test/unexpected"),
    requestId: "two",
    send,
  })).action, "failed-unexpected-active-request");
  assert.equal((await handlePausedOperationRequest({
    plan,
    request: request(0, "GET", stateUrl),
    requestId: "three",
    send,
  })).action, "continued-read");
  assert.equal((await handlePausedOperationRequest({
    plan,
    request: request(0, "GET", "https://api.example.test/settings/one/delete"),
    requestId: "four",
    send,
  })).action, "failed-unexpected-active-request");
  assert.equal((await handlePausedOperationRequest({
    plan,
    request: request(0, "PATCH", mutationUrl, { requestShapeFingerprint: "c".repeat(64) }),
    requestId: "five",
    send,
  })).action, "failed-unexpected-active-request");
  assert.deepEqual(commands.map((entry) => entry.method), [
    "Fetch.failRequest",
    "Fetch.failRequest",
    "Fetch.continueRequest",
    "Fetch.failRequest",
    "Fetch.failRequest",
  ]);
});

test("Fetch policy enforces the bound target and makes retained interception containment-only", async () => {
  const plan = reversiblePlan();
  const commands = [];
  const send = async (method, params) => commands.push({ method, params });
  const exact = request(1, "PATCH", mutationUrl);

  assert.equal((await handlePausedOperationRequest({
    approvedRequestCount: 0,
    boundSessionId: "child-session",
    boundTargetId: "target-1",
    plan,
    request: exact,
    requestId: "wrong-session",
    send,
    stepName: "apply",
  })).action, "failed-unexpected-active-request");
  assert.equal((await handlePausedOperationRequest({
    approvedRequestCount: 0,
    boundSessionId: "root",
    boundTargetId: "other-target",
    plan,
    request: exact,
    requestId: "wrong-target",
    send,
    stepName: "apply",
  })).action, "failed-unexpected-active-request");
  assert.equal((await handlePausedOperationRequest({
    approvedRequestCount: 0,
    boundSessionId: "root",
    boundTargetId: "target-1",
    containmentOnly: true,
    plan,
    request: exact,
    requestId: "late-exact",
    send,
    stepName: "apply",
  })).action, "failed-containment-active-request");
  assert.deepEqual(commands.map((entry) => entry.method), [
    "Fetch.failRequest",
    "Fetch.failRequest",
    "Fetch.failRequest",
  ]);
});

test("abort receipt requires one exact request, unique control, and complete Fetch setup", () => {
  const plan = abortPlan();
  const exact = request(0, "PATCH", mutationUrl);
  const successful = buildAbortOperationReceipt(plan, {
    boundSessionId: "root",
    boundTargetId: "target-1",
    failRequestAcknowledged: true,
    fetchRequestId: "fetch-1",
    matchedRequestCount: 1,
    matchedSessionId: "root",
    matchedTargetId: "target-1",
    request: exact,
    setupFailureCount: 0,
    unexpectedActiveRequestCount: 0,
    uniqueControl: true,
  });
  assert.equal(successful.executionState, "aborted-before-send");
  assert.equal(buildAbortOperationReceipt(plan, {
    boundSessionId: "root",
    boundTargetId: "target-1",
    failRequestAcknowledged: true,
    fetchRequestId: "fetch-summary",
    matchedRequestCount: 1,
    matchedSessionId: "other-session",
    matchedTargetId: "target-1",
    request: exact,
    setupFailureCount: 0,
    unexpectedActiveRequestCount: 0,
    uniqueControl: true,
  }).executionState, "unresolved-change");
  assert.equal(buildAbortOperationReceipt(plan, {
    boundSessionId: "root",
    boundTargetId: "target-1",
    failRequestAcknowledged: true,
    matchedRequestCount: 1,
    request: exact,
    setupFailureCount: 1,
    unexpectedActiveRequestCount: 0,
    uniqueControl: true,
  }).executionState, "unresolved-change");
});

test("reversible Fetch gate allows one exact mutation and aborts a duplicate", async () => {
  const plan = reversiblePlan();
  const commands = [];
  const exact = request(1, "PATCH", mutationUrl);
  const send = async (method, params) => commands.push({ method, params });
  assert.equal((await handlePausedOperationRequest({
    approvedRequestCount: 0,
    plan,
    request: exact,
    requestId: "apply-one",
    send,
    stepName: "apply",
  })).action, "continued-approved-operation");
  assert.equal((await handlePausedOperationRequest({
    approvedRequestCount: 1,
    plan,
    request: exact,
    requestId: "apply-two",
    send,
    stepName: "apply",
  })).action, "failed-duplicate-approved-operation");
  assert.deepEqual(commands.map((entry) => entry.method), [
    "Fetch.continueRequest",
    "Fetch.failRequest",
  ]);
});

test("reversible receipt requires successful ETag-bound apply and verified restoration", () => {
  const receipt = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
    { interception: safeInterception() },
  );
  assert.equal(receipt.executionState, "committed-and-restored");
  assert.equal(receipt.scalar.beforeValue, false);
  assert.equal(receipt.scalar.finalValue, false);
  assert.equal(summarizeOperationReceipts([receipt]).safeToContinue, true);
});

test("reversible receipt cannot be terminal without complete Fetch gate accounting", () => {
  const missing = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
  );
  assert.equal(missing.executionState, "unresolved-change");
  assert.equal(missing.unresolvedReason, "operation-interception-accounting-inconsistent");
  assert.deepEqual(missing.accounting.interception.missingSteps, ["apply", "rollback"]);

  const incomplete = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
    {
      interception: {
        ...safeInterception(),
        rollback: {
          ...safeInterception().rollback,
          unexpectedActiveRequestCount: 1,
        },
      },
    },
  );
  assert.equal(incomplete.executionState, "unresolved-change");
  assert.equal(incomplete.unresolvedReason, "operation-interception-accounting-inconsistent");
  const mismatchedAttribution = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
    {
      interception: {
        ...safeInterception(),
        apply: {
          ...safeInterception().apply,
          matchedTargetId: "other-target",
        },
      },
    },
  );
  assert.equal(mismatchedAttribution.executionState, "unresolved-change");
  assert.equal(mismatchedAttribution.unresolvedReason, "operation-interception-accounting-inconsistent");

  const ambiguousControl = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
    {
      interception: {
        ...safeInterception(),
        apply: { ...safeInterception().apply, uniqueControl: false },
      },
    },
  );
  assert.equal(ambiguousControl.executionState, "unresolved-change");

  const duplicate = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
    {
      interception: {
        ...safeInterception(),
        apply: { ...safeInterception().apply, duplicateApprovedRequestCount: 1 },
      },
    },
  );
  assert.equal(duplicate.executionState, "unresolved-change");
});

test("reversible receipt fails closed on non-2xx, duplicate, concurrency, and final-state gaps", () => {
  const cases = [
    (items) => { items[0].status = 500; },
    (items) => { items.push({ ...items[1], evidenceId: "duplicate-apply" }); },
    (items) => { items[1].headers = {}; },
    (items) => { items[4].responseBody = JSON.stringify({ enabled: true }); },
  ];
  for (const mutate of cases) {
    const evidence = successfulReversibleEvidence();
    mutate(evidence);
    assert.equal(
      buildReversibleOperationReceipt(
        reversiblePlan(),
        evidence,
        { interception: safeInterception() },
      ).executionState,
      "unresolved-change",
    );
  }
});

test("sent-no-confirmed-change requires a successful final read and does not send rollback", () => {
  const evidence = successfulReversibleEvidence();
  evidence[2].responseBody = JSON.stringify({ enabled: false });
  evidence.splice(3, 1);
  const receipt = buildReversibleOperationReceipt(
    reversiblePlan(),
    evidence,
    { interception: safeInterception({ rollback: false }) },
  );
  assert.equal(receipt.executionState, "sent-no-confirmed-change");
  assert.equal(receipt.accounting.rollbackSent, false);
  evidence[3].status = 500;
  assert.equal(
    buildReversibleOperationReceipt(
      reversiblePlan(),
      evidence,
      { interception: safeInterception({ rollback: false }) },
    ).executionState,
    "unresolved-change",
  );
});

test("candidate handoff carries only the sanitized active-operation summary", () => {
  const receipt = buildReversibleOperationReceipt(
    reversiblePlan(),
    successfulReversibleEvidence(),
    { interception: safeInterception() },
  );
  const handoff = buildCandidateHandoff({
    candidateQueue: { candidates: [], scopeReviewCandidates: [], suppressedCandidates: [] },
    metadataNextPass: "unknown",
    mutationSummary: summarizeOperationReceipts([receipt]),
    recovery: { captureStatus: "complete" },
    specId: "example",
    specTitle: "nodoc-example",
  });
  assert.equal(handoff.activeOperations.safeToContinue, true);
  assert.equal(validateOperationSummary(handoff.activeOperations).safeToContinue, true);
  assert.equal(JSON.stringify(handoff).includes("beforeValue"), false);
  assert.equal(JSON.stringify(handoff).includes("requestBody"), false);
});

test("operation summaries reject unknown states and inconsistent accounting", () => {
  const receipt = buildAbortOperationReceipt(abortPlan(), {
    boundSessionId: "root",
    boundTargetId: "target-1",
    failRequestAcknowledged: true,
    fetchRequestId: "fetch-summary",
    matchedRequestCount: 1,
    matchedSessionId: "root",
    matchedTargetId: "target-1",
    request: request(0, "PATCH", mutationUrl),
    setupFailureCount: 0,
    unexpectedActiveRequestCount: 0,
    uniqueControl: true,
  });
  const summary = summarizeOperationReceipts([receipt]);
  assert.equal(summary.safeToContinue, true);
  assert.throws(
    () => summarizeOperationReceipts([{ ...receipt, executionState: "bogus" }]),
    /unsupported/u,
  );
  assert.throws(
    () => validateOperationSummary({ ...summary, safeToContinue: false }),
    /inconsistent/u,
  );
  const events = {
    schemaVersion: 1,
    authorization: {
      ceiling: abortPlan().mode,
      approvalDigest: abortPlan().approvalDigest,
    },
    receipts: [receipt],
    summary,
  };
  assert.deepEqual(
    validateMutationEventsArtifact(events, { activeOperationPlan: abortPlan() }),
    summary,
  );
  assert.throws(
    () => validateMutationEventsArtifact({
      schemaVersion: 1,
      receipts: [receipt],
      summary: { ...summary, attemptCount: 0 },
    }),
    /inconsistent|does not match/u,
  );
  assert.throws(
    () => validateMutationEventsArtifact(
      { ...events, authorization: { ...events.authorization, approvalDigest: "0".repeat(64) } },
      { activeOperationPlan: abortPlan() },
    ),
    /does not match/u,
  );
});

test("mutation artifact validation rejects a forged terminal receipt without gate evidence", () => {
  const plan = reversiblePlan();
  const valid = buildReversibleOperationReceipt(
    plan,
    successfulReversibleEvidence(),
    { interception: safeInterception() },
  );
  const forged = { ...valid, accounting: {}, interception: {} };
  const receiptSummary = {
    schemaVersion: valid.schemaVersion,
    operationId: valid.operationId,
    mode: valid.mode,
    approvalDigest: valid.approvalDigest,
    executionState: valid.executionState,
    unresolvedReason: null,
    accounting: {},
  };
  const summary = {
    schemaVersion: valid.schemaVersion,
    attemptCount: 1,
    byState: {
      "aborted-before-send": 0,
      "sent-no-confirmed-change": 0,
      "committed-and-restored": 1,
      "unresolved-change": 0,
    },
    unresolvedOperationIds: [],
    safeToContinue: true,
    receipts: [receiptSummary],
  };
  assert.throws(
    () => validateMutationEventsArtifact({
      schemaVersion: 1,
      authorization: { ceiling: plan.mode, approvalDigest: plan.approvalDigest },
      receipts: [forged],
      summary,
    }, { activeOperationPlan: plan, captureSummary: summary }),
    /lacks exact operation and Fetch gate accounting/u,
  );
});
