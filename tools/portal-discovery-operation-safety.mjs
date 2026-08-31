import { createHash } from "node:crypto";

import { activeGetPathPattern, activeGetQueryPattern } from "./discovery-safety.mjs";

export const operationReceiptSchemaVersion = 1;
export const operationExecutionStates = Object.freeze([
  "aborted-before-send",
  "sent-no-confirmed-change",
  "committed-and-restored",
  "unresolved-change",
]);

const activeOperationModes = new Set(["abort-only", "reversible-scalar"]);
const abortableOperationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const reversibleMutationMethods = new Set(["POST", "PUT", "PATCH"]);
const activeClickActionType = "click-automation-id";
const sha256Pattern = /^[a-f0-9]{64}$/u;

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function planWithoutApprovalDigest(plan) {
  const { approvalDigest: _approvalDigest, ...unsigned } = plan ?? {};
  return unsigned;
}

export function computeOperationApprovalDigest(plan) {
  return digest(planWithoutApprovalDigest(plan));
}

function normalizeExactUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} must not contain credentials or a fragment.`);
  }
  return parsed.toString();
}

function normalizeActionType(action) {
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    return (separator < 0 ? action : action.slice(0, separator)).replace(/-(root|iframe)$/u, "");
  }
  return String(action?.type || "").replace(/-(root|iframe)$/u, "");
}

function validateStep(step, label, actions, { allowDelete = false, read = false } = {}) {
  if (!step || typeof step !== "object") {
    throw new Error(`${label} is required.`);
  }
  if (!Number.isInteger(step.actionIndex) || step.actionIndex < 0) {
    throw new Error(`${label}.actionIndex must be a non-negative integer.`);
  }
  const method = String(step.method || "").toUpperCase();
  const allowedMutationMethods = allowDelete ? abortableOperationMethods : reversibleMutationMethods;
  if (read ? method !== "GET" : !allowedMutationMethods.has(method)) {
    throw new Error(`${label}.method must be ${read ? "GET" : allowDelete ? "POST, PUT, PATCH, or DELETE" : "POST, PUT, or PATCH"}.`);
  }
  const url = normalizeExactUrl(step.url, `${label}.url`);
  const targetUrl = read ? null : normalizeExactUrl(step.targetUrl, `${label}.targetUrl`);
  const requestBodyShapeFingerprint = String(step.requestBodyShapeFingerprint || "").trim().toLowerCase();
  if (!read && !sha256Pattern.test(requestBodyShapeFingerprint)) {
    throw new Error(`${label}.requestBodyShapeFingerprint must be a lowercase SHA-256 digest for every active mutation step.`);
  }
  if (read && requestBodyShapeFingerprint) {
    throw new Error(`${label}.requestBodyShapeFingerprint is not valid for a read step.`);
  }
  if (actions) {
    if (step.actionIndex >= actions.length) {
      throw new Error(`${label}.actionIndex is outside the recipe action list.`);
    }
    const actionType = normalizeActionType(actions[step.actionIndex]);
    if (read && actionType !== "probe-get") {
      throw new Error(`${label} must reference a probe-get action.`);
    }
    if (!read && actionType !== activeClickActionType) {
      throw new Error(`${label} must reference an exact click-automation-id action.`);
    }
  }
  return {
    actionIndex: step.actionIndex,
    method,
    url,
    ...(targetUrl ? { targetUrl } : {}),
    ...(requestBodyShapeFingerprint ? { requestBodyShapeFingerprint } : {}),
  };
}

export function validateActiveOperationPlan(input, { actions = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Active operation plans must be objects.");
  }
  const operationId = String(input.operationId || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/u.test(operationId)) {
    throw new Error("operationId must be a stable 3-80 character identifier.");
  }
  const mode = String(input.mode || "").trim();
  if (!activeOperationModes.has(mode)) {
    throw new Error("mode must be abort-only or reversible-scalar.");
  }
  const suppliedApprovalDigest = String(input.approvalDigest || "").trim().toLowerCase();
  if (suppliedApprovalDigest && !sha256Pattern.test(suppliedApprovalDigest)) {
    throw new Error("approvalDigest must be a lowercase SHA-256 digest when present.");
  }

  let normalized;
  if (mode === "abort-only") {
    normalized = {
      operationId,
      mode,
      approvalDigest: suppliedApprovalDigest,
      steps: {
        invoke: validateStep(input.steps?.invoke, "steps.invoke", actions, { allowDelete: true }),
      },
    };
  } else {
    const scalarType = String(input.scalar?.type || "").trim();
    if (!["boolean", "integer"].includes(scalarType)) {
      throw new Error("reversible-scalar plans require scalar.type boolean or integer.");
    }
    const jsonPointer = String(input.scalar?.jsonPointer || "").trim();
    if (!jsonPointer.startsWith("/") || jsonPointer.includes("#")) {
      throw new Error("reversible-scalar plans require an absolute JSON pointer.");
    }
    const testValue = input.scalar?.testValue;
    if (scalarType === "boolean" && typeof testValue !== "boolean") {
      throw new Error("boolean reversible-scalar plans require a boolean testValue.");
    }
    if (scalarType === "integer" && !Number.isSafeInteger(testValue)) {
      throw new Error("integer reversible-scalar plans require a safe integer testValue.");
    }
    let minimum = null;
    let maximum = null;
    if (scalarType === "integer") {
      minimum = input.scalar?.minimum;
      maximum = input.scalar?.maximum;
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum >= maximum) {
        throw new Error("integer reversible-scalar plans require safe integer minimum and maximum bounds.");
      }
      if (testValue < minimum || testValue > maximum) {
        throw new Error("integer reversible-scalar testValue must remain inside its declared bounds.");
      }
    }
    const steps = {
      preState: validateStep(input.steps?.preState, "steps.preState", actions, { read: true }),
      apply: validateStep(input.steps?.apply, "steps.apply", actions),
      postState: validateStep(input.steps?.postState, "steps.postState", actions, { read: true }),
      rollback: validateStep(input.steps?.rollback, "steps.rollback", actions),
      finalState: validateStep(input.steps?.finalState, "steps.finalState", actions, { read: true }),
    };
    const orderedIndices = Object.values(steps).map((step) => step.actionIndex);
    if (orderedIndices.some((value, index) => index > 0 && value <= orderedIndices[index - 1])) {
      throw new Error("reversible-scalar steps must use strictly increasing action indices.");
    }
    if (steps.apply.method !== steps.rollback.method || steps.apply.url !== steps.rollback.url) {
      throw new Error("apply and rollback must target the same exact method and URL.");
    }
    if (new Set([steps.preState.url, steps.postState.url, steps.finalState.url]).size !== 1) {
      throw new Error("pre-state, post-state, and final-state reads must target the same exact URL.");
    }
    if (input.concurrency?.mode !== "etag") {
      throw new Error("reversible-scalar plans require concurrency.mode etag.");
    }
    normalized = {
      operationId,
      mode,
      approvalDigest: suppliedApprovalDigest,
      scalar: {
        jsonPointer,
        testValue,
        type: scalarType,
        ...(scalarType === "integer" ? { maximum, minimum } : {}),
      },
      concurrency: { mode: "etag" },
      steps,
    };
  }

  const expectedDigest = computeOperationApprovalDigest(normalized);
  if (suppliedApprovalDigest && suppliedApprovalDigest !== expectedDigest) {
    throw new Error(`approvalDigest does not match the active operation plan; expected ${expectedDigest}.`);
  }
  normalized.approvalDigest = expectedDigest;
  return normalized;
}

export function validateOperationAuthorization({
  activeOperations = [],
  actions = null,
  approvalDigest = null,
  ceiling = "observe-only",
} = {}) {
  const plans = Array.isArray(activeOperations) ? activeOperations : [];
  if (plans.length === 0) {
    if (ceiling !== "observe-only" || approvalDigest) {
      throw new Error("Active-operation authorization was supplied but the recipe has no active operation plan.");
    }
    return null;
  }
  if (plans.length !== 1) {
    throw new Error("A discovery run may contain exactly one active operation plan.");
  }
  const plan = validateActiveOperationPlan(plans[0], { actions });
  if (ceiling !== plan.mode) {
    throw new Error(`Runtime operation ceiling ${JSON.stringify(ceiling)} does not match recipe mode ${JSON.stringify(plan.mode)}.`);
  }
  if (String(approvalDigest || "").toLowerCase() !== plan.approvalDigest) {
    throw new Error("Runtime operation approval digest does not match the checked-in plan.");
  }
  return plan;
}

export function operationStepAtActionIndex(plan, actionIndex) {
  for (const [name, step] of Object.entries(plan?.steps ?? {})) {
    if (step.actionIndex === actionIndex) return { name, ...step };
  }
  return null;
}

function normalizedSessionId(value) {
  return value == null ? "root" : String(value);
}

export function matchesOperationRequest(
  step,
  request,
  { boundSessionId = null, boundTargetId = null } = {},
) {
  if (!step || !request) return false;
  let exactUrl;
  try {
    exactUrl = new URL(String(request.url || "")).toString();
  } catch {
    return false;
  }
  if (String(request.method || "").toUpperCase() !== step.method || exactUrl !== step.url) {
    return false;
  }
  if (
    Number.isInteger(step.actionIndex)
    && request.attribution?.actionIndex !== step.actionIndex
  ) {
    return false;
  }
  if (step.targetUrl) {
    try {
      if (new URL(String(request.attribution?.targetUrl || "")).toString() !== step.targetUrl) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (
    step.requestBodyShapeFingerprint
    && request.requestShapeFingerprint !== step.requestBodyShapeFingerprint
  ) {
    return false;
  }
  if (
    boundSessionId != null
    && normalizedSessionId(request.sessionId) !== normalizedSessionId(boundSessionId)
  ) {
    return false;
  }
  if (boundTargetId != null && String(request.targetId || "") !== String(boundTargetId)) {
    return false;
  }
  return true;
}

export async function handlePausedOperationRequest({
  approvedRequestCount = 0,
  boundSessionId = null,
  boundTargetId = null,
  containmentOnly = false,
  plan,
  request,
  requestId,
  send,
  stepName = null,
}) {
  if (!plan || !activeOperationModes.has(plan.mode)) {
    throw new Error("Paused-operation handling requires an active operation plan.");
  }
  const step = plan.mode === "abort-only" ? plan.steps.invoke : plan.steps[stepName];
  if (!step || (plan.mode === "reversible-scalar" && !["apply", "rollback"].includes(stepName))) {
    throw new Error("Paused-operation handling requires an active mutation step.");
  }
  const method = String(request?.method || "").toUpperCase();
  let activeGet = false;
  if (method === "GET") {
    try {
      const parsed = new URL(request.url);
      activeGet = activeGetPathPattern.test(parsed.pathname)
        || activeGetPathPattern.test(parsed.hash.replace(/^#/u, "/"))
        || activeGetQueryPattern.test(parsed.search)
        || activeGetQueryPattern.test(parsed.hash);
    } catch {
      activeGet = true;
    }
  }
  if (containmentOnly) {
    if (!["GET", "HEAD", "OPTIONS"].includes(method) || activeGet) {
      await send("Fetch.failRequest", { errorReason: "Aborted", requestId });
      return { action: "failed-containment-active-request", failRequestAcknowledged: true };
    }
    await send("Fetch.continueRequest", { requestId });
    return { action: "continued-read", failRequestAcknowledged: false };
  }
  if (matchesOperationRequest(step, request, { boundSessionId, boundTargetId })) {
    if (plan.mode === "reversible-scalar" && approvedRequestCount === 0) {
      await send("Fetch.continueRequest", { requestId });
      return { action: "continued-approved-operation", failRequestAcknowledged: false };
    }
    await send("Fetch.failRequest", { errorReason: "Aborted", requestId });
    return {
      action: plan.mode === "abort-only"
        ? "failed-approved-operation"
        : "failed-duplicate-approved-operation",
      failRequestAcknowledged: true,
    };
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) || activeGet) {
    await send("Fetch.failRequest", { errorReason: "Aborted", requestId });
    return { action: "failed-unexpected-active-request", failRequestAcknowledged: true };
  }
  await send("Fetch.continueRequest", { requestId });
  return { action: "continued-read", failRequestAcknowledged: false };
}

function sha256Text(value) {
  return value == null ? null : createHash("sha256").update(String(value), "utf8").digest("hex");
}

function compactEvidence(request) {
  if (!request) return null;
  const requestIfMatch = Object.entries(request.headers ?? {})
    .find(([key]) => key.toLowerCase() === "if-match")?.[1] ?? null;
  const responseEtag = Object.entries(request.responseHeaders ?? {})
    .find(([key]) => key.toLowerCase() === "etag")?.[1] ?? null;
  return {
    actionIndex: request.attribution?.actionIndex ?? null,
    evidenceId: request.evidenceId ?? null,
    failureText: request.failureText ?? null,
    headers: requestIfMatch == null ? {} : { "if-match": requestIfMatch },
    method: request.method ?? null,
    requestBody: request.requestBody ?? null,
    requestBodySha256: sha256Text(request.requestBody),
    requestShapeFingerprint: request.requestShapeFingerprint ?? null,
    responseBody: request.responseBody ?? null,
    responseBodySha256: sha256Text(request.responseBody),
    responseHeaders: responseEtag == null ? {} : { etag: responseEtag },
    sessionId: normalizedSessionId(request.sessionId),
    status: request.status ?? null,
    targetId: request.targetId ?? request.attribution?.targetId ?? null,
    targetUrl: request.attribution?.targetUrl ?? null,
    url: request.url ?? null,
  };
}

function exactStepEvidence(plan, stepName, requests) {
  const step = plan.steps[stepName];
  const matches = requests.filter((request) =>
    request.abortedBeforeSend !== true
    && request.attribution?.actionIndex === step.actionIndex
    && matchesOperationRequest(step, request));
  return {
    count: matches.length,
    evidence: matches.length === 1 ? compactEvidence(matches[0]) : null,
  };
}

function decodePointerSegment(value) {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function extractJsonPointer(body, jsonPointer) {
  if (typeof body !== "string") return { available: false, value: null };
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return { available: false, value: null };
  }
  for (const segment of jsonPointer.slice(1).split("/").map(decodePointerSegment)) {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), segment)) {
      return { available: false, value: null };
    }
    value = value[segment];
  }
  return { available: true, value };
}

function successfulResponse(evidence) {
  return Number.isInteger(evidence?.status) && evidence.status >= 200 && evidence.status < 300;
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === target);
  return entry ? String(entry[1]) : null;
}

export function buildReversibleOperationReceipt(
  planInput,
  requests,
  { completedAt = null, interception = {} } = {},
) {
  const plan = validateActiveOperationPlan(planInput);
  if (plan.mode !== "reversible-scalar") {
    throw new Error("A reversible receipt requires a reversible-scalar plan.");
  }
  const stepEvidence = Object.fromEntries(
    Object.keys(plan.steps).map((stepName) => [stepName, exactStepEvidence(plan, stepName, requests)]),
  );
  const evidence = Object.fromEntries(
    Object.entries(stepEvidence).map(([stepName, result]) => [stepName, result.evidence]),
  );
  const duplicateSteps = Object.entries(stepEvidence)
    .filter(([, result]) => result.count > 1)
    .map(([stepName]) => stepName);
  const missingSteps = Object.entries(stepEvidence)
    .filter(([, result]) => result.count === 0)
    .map(([stepName]) => stepName);
  const applySent = stepEvidence.apply.count > 0;
  const rollbackSent = stepEvidence.rollback.count > 0;
  const before = extractJsonPointer(evidence.preState?.responseBody, plan.scalar.jsonPointer);
  const after = extractJsonPointer(evidence.postState?.responseBody, plan.scalar.jsonPointer);
  const restored = extractJsonPointer(evidence.finalState?.responseBody, plan.scalar.jsonPointer);
  const typed = (entry) => entry.available && (
    plan.scalar.type === "boolean"
      ? typeof entry.value === "boolean"
      : Number.isSafeInteger(entry.value)
        && entry.value >= plan.scalar.minimum
        && entry.value <= plan.scalar.maximum
  );
  const preEtag = headerValue(evidence.preState?.responseHeaders, "etag");
  const applyIfMatch = headerValue(evidence.apply?.headers, "if-match");
  const postEtag = headerValue(evidence.postState?.responseHeaders, "etag");
  const rollbackIfMatch = headerValue(evidence.rollback?.headers, "if-match");

  let executionState = "unresolved-change";
  let unresolvedReason = null;
  if (!applySent) {
    unresolvedReason = "mutation-request-not-observed";
  } else if (duplicateSteps.length > 0) {
    unresolvedReason = `duplicate-step-evidence:${duplicateSteps.join(",")}`;
  } else if (!successfulResponse(evidence.preState) || !successfulResponse(evidence.apply)
    || !successfulResponse(evidence.postState)) {
    unresolvedReason = "pre-apply-or-post-response-unsuccessful";
  } else if (!preEtag || applyIfMatch !== preEtag || !postEtag) {
    unresolvedReason = "apply-concurrency-proof-missing";
  } else if (!typed(before) || !typed(after)) {
    unresolvedReason = "pre-or-post-state-unavailable";
  } else if (after.value === before.value) {
    if (stepEvidence.finalState.count === 0) {
      unresolvedReason = "no-change-final-state-pending";
    } else if (!successfulResponse(evidence.finalState) || !typed(restored)) {
      unresolvedReason = "no-change-final-state-unavailable";
    } else if (restored.value !== before.value) {
      unresolvedReason = "no-change-final-state-mismatch";
    } else {
      executionState = "sent-no-confirmed-change";
    }
  } else if (after.value !== plan.scalar.testValue) {
    unresolvedReason = "unexpected-post-state";
  } else if (!rollbackSent) {
    unresolvedReason = "rollback-request-not-observed";
  } else if (!successfulResponse(evidence.rollback)) {
    unresolvedReason = "rollback-response-unsuccessful";
  } else if (rollbackIfMatch !== postEtag) {
    unresolvedReason = "rollback-concurrency-proof-missing";
  } else if (!typed(restored)) {
    unresolvedReason = "final-state-unavailable";
  } else if (!successfulResponse(evidence.finalState)) {
    unresolvedReason = "final-state-response-unsuccessful";
  } else if (restored.value !== before.value) {
    unresolvedReason = "final-state-not-restored";
  } else {
    executionState = "committed-and-restored";
  }

  const receipt = {
    schemaVersion: operationReceiptSchemaVersion,
    operationId: plan.operationId,
    mode: plan.mode,
    approvalDigest: plan.approvalDigest,
    completedAt,
    executionState,
    unresolvedReason,
    accounting: {
      applySent,
      rollbackSent,
      duplicateSteps,
      missingSteps,
    },
    scalar: {
      type: plan.scalar.type,
      jsonPointer: plan.scalar.jsonPointer,
      beforeValue: before.available ? before.value : null,
      testValue: plan.scalar.testValue,
      postValue: after.available ? after.value : null,
      finalValue: restored.available ? restored.value : null,
    },
    evidence,
  };
  receipt.interception = canonicalize(interception ?? {});
  const interceptionEntries = Object.values(receipt.interception);
  const expectedInterceptionSteps = executionState === "committed-and-restored"
    ? ["apply", "rollback"]
    : executionState === "sent-no-confirmed-change"
      ? ["apply"]
      : [];
  const missingInterceptionSteps = expectedInterceptionSteps.filter(
    (stepName) => !Object.prototype.hasOwnProperty.call(receipt.interception, stepName),
  );
  const unexpectedInterceptionSteps = Object.keys(receipt.interception)
    .filter((stepName) => !expectedInterceptionSteps.includes(stepName));
  const unsafeInterception = interceptionEntries.some((entry) => (
    entry?.approvedRequestCount !== 1
    || entry?.matchedRequestCount !== 1
    || typeof entry?.boundSessionId !== "string"
    || typeof entry?.boundTargetId !== "string"
    || entry?.matchedSessionId !== entry?.boundSessionId
    || entry?.matchedTargetId !== entry?.boundTargetId
    || entry?.uniqueControl !== true
    || Number(entry?.duplicateApprovedRequestCount ?? 0) > 0
    || Number(entry?.setupFailureCount ?? 0) > 0
    || Number(entry?.unexpectedActiveRequestCount ?? 0) > 0
  ));
  receipt.accounting.interception = interceptionEntries.reduce(
    (total, entry) => ({
      approvedRequestCount: total.approvedRequestCount + Number(entry?.approvedRequestCount ?? 0),
      duplicateApprovedRequestCount:
        total.duplicateApprovedRequestCount + Number(entry?.duplicateApprovedRequestCount ?? 0),
      expectedStepCount: expectedInterceptionSteps.length,
      missingSteps: missingInterceptionSteps,
      setupFailureCount: total.setupFailureCount + Number(entry?.setupFailureCount ?? 0),
      stepCount: total.stepCount + 1,
      unexpectedSteps: unexpectedInterceptionSteps,
      unexpectedActiveRequestCount:
        total.unexpectedActiveRequestCount + Number(entry?.unexpectedActiveRequestCount ?? 0),
    }),
    {
      approvedRequestCount: 0,
      duplicateApprovedRequestCount: 0,
      expectedStepCount: expectedInterceptionSteps.length,
      missingSteps: missingInterceptionSteps,
      setupFailureCount: 0,
      stepCount: 0,
      unexpectedSteps: unexpectedInterceptionSteps,
      unexpectedActiveRequestCount: 0,
    },
  );
  if (
    ["committed-and-restored", "sent-no-confirmed-change"].includes(executionState)
    && (
      unsafeInterception
      || missingInterceptionSteps.length > 0
      || unexpectedInterceptionSteps.length > 0
    )
  ) {
    receipt.executionState = "unresolved-change";
    receipt.unresolvedReason = "operation-interception-accounting-inconsistent";
  }
  return receipt;
}

export function buildAbortOperationReceipt(planInput, abortEvent, { completedAt = null } = {}) {
  const plan = validateActiveOperationPlan(planInput);
  if (plan.mode !== "abort-only") {
    throw new Error("An abort receipt requires an abort-only plan.");
  }
  const acknowledged = abortEvent?.failRequestAcknowledged === true;
  const exactMatch = matchesOperationRequest(
    plan.steps.invoke,
    abortEvent?.request,
    {
      boundSessionId: abortEvent?.boundSessionId,
      boundTargetId: abortEvent?.boundTargetId,
    },
  );
  const proven = acknowledged
    && exactMatch
    && typeof abortEvent?.boundSessionId === "string"
    && typeof abortEvent?.boundTargetId === "string"
    && abortEvent?.matchedSessionId === abortEvent?.boundSessionId
    && abortEvent?.matchedTargetId === abortEvent?.boundTargetId
    && abortEvent?.matchedRequestCount === 1
    && abortEvent?.uniqueControl === true
    && (abortEvent?.unexpectedActiveRequestCount ?? 0) === 0
    && (abortEvent?.setupFailureCount ?? 0) === 0;
  return {
    schemaVersion: operationReceiptSchemaVersion,
    operationId: plan.operationId,
    mode: plan.mode,
    approvalDigest: plan.approvalDigest,
    completedAt,
    executionState: proven ? "aborted-before-send" : "unresolved-change",
    unresolvedReason: proven ? null : "abort-not-proven",
    accounting: {
      abortAcknowledged: acknowledged,
      boundSessionId: abortEvent?.boundSessionId ?? null,
      boundTargetId: abortEvent?.boundTargetId ?? null,
      matchedRequestCount: abortEvent?.matchedRequestCount ?? 0,
      matchedSessionId: abortEvent?.matchedSessionId ?? null,
      matchedTargetId: abortEvent?.matchedTargetId ?? null,
      setupFailureCount: abortEvent?.setupFailureCount ?? 0,
      uniqueControl: abortEvent?.uniqueControl === true,
      unexpectedActiveRequestCount: abortEvent?.unexpectedActiveRequestCount ?? 0,
    },
    evidence: {
      request: compactEvidence(abortEvent?.request),
      fetchRequestId: abortEvent?.fetchRequestId ?? null,
      networkId: abortEvent?.networkId ?? null,
    },
  };
}

export function summarizeOperationReceipts(receipts = [], { summary = false } = {}) {
  if (!Array.isArray(receipts)) throw new Error("Operation receipts must be an array.");
  const byState = Object.fromEntries(operationExecutionStates.map((state) => [state, 0]));
  for (const receipt of receipts) {
    validateOperationReceipt(receipt, { summary });
    byState[receipt.executionState] += 1;
  }
  const unresolvedOperationIds = receipts
    .filter((receipt) => receipt.executionState === "unresolved-change")
    .map((receipt) => receipt.operationId)
    .sort();
  return {
    schemaVersion: operationReceiptSchemaVersion,
    attemptCount: receipts.length,
    byState,
    unresolvedOperationIds,
    safeToContinue: unresolvedOperationIds.length === 0,
    receipts: receipts.map((receipt) => ({
      schemaVersion: operationReceiptSchemaVersion,
      operationId: receipt.operationId,
      mode: receipt.mode,
      approvalDigest: receipt.approvalDigest,
      executionState: receipt.executionState,
      unresolvedReason: receipt.unresolvedReason,
      accounting: receipt.accounting,
    })),
  };
}

function emptyStringArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

function safeTerminalInterceptionEntry(entry) {
  return entry?.approvedRequestCount === 1
    && entry?.matchedRequestCount === 1
    && typeof entry?.boundSessionId === "string"
    && typeof entry?.boundTargetId === "string"
    && entry.matchedSessionId === entry.boundSessionId
    && entry.matchedTargetId === entry.boundTargetId
    && entry.uniqueControl === true
    && Number(entry?.duplicateApprovedRequestCount ?? 0) === 0
    && Number(entry?.setupFailureCount ?? 0) === 0
    && Number(entry?.unexpectedActiveRequestCount ?? 0) === 0;
}

function assertTerminalReceiptIntegrity(receipt, { summary = false } = {}) {
  if (receipt.executionState === "unresolved-change") return;
  const accounting = receipt.accounting ?? {};
  if (receipt.mode === "abort-only") {
    const bindingSafe = accounting.abortAcknowledged === true
      && accounting.matchedRequestCount === 1
      && typeof accounting.boundSessionId === "string"
      && typeof accounting.boundTargetId === "string"
      && accounting.matchedSessionId === accounting.boundSessionId
      && accounting.matchedTargetId === accounting.boundTargetId
      && accounting.uniqueControl === true
      && Number(accounting.setupFailureCount ?? 0) === 0
      && Number(accounting.unexpectedActiveRequestCount ?? 0) === 0;
    if (!bindingSafe) {
      throw new Error("Terminal abort receipt lacks exact Fetch gate accounting.");
    }
    if (!summary) {
      const request = receipt.evidence?.request;
      if (!request
        || request.sessionId !== accounting.boundSessionId
        || request.targetId !== accounting.boundTargetId
        || typeof receipt.evidence?.fetchRequestId !== "string") {
        throw new Error("Terminal abort receipt lacks bound paused-request evidence.");
      }
    }
    return;
  }

  const expectedSteps = receipt.executionState === "committed-and-restored"
    ? ["apply", "rollback"]
    : ["apply"];
  const expectedCount = expectedSteps.length;
  const interceptionAccounting = accounting.interception ?? {};
  const aggregateSafe = interceptionAccounting.approvedRequestCount === expectedCount
    && interceptionAccounting.duplicateApprovedRequestCount === 0
    && interceptionAccounting.expectedStepCount === expectedCount
    && interceptionAccounting.setupFailureCount === 0
    && interceptionAccounting.stepCount === expectedCount
    && interceptionAccounting.unexpectedActiveRequestCount === 0
    && emptyStringArray(interceptionAccounting.missingSteps)
    && emptyStringArray(interceptionAccounting.unexpectedSteps);
  const operationAccountingSafe = accounting.applySent === true
    && emptyStringArray(accounting.duplicateSteps)
    && (receipt.executionState === "committed-and-restored"
      ? accounting.rollbackSent === true && emptyStringArray(accounting.missingSteps)
      : accounting.rollbackSent === false && exactStringArray(accounting.missingSteps, ["rollback"]));
  if (!aggregateSafe || !operationAccountingSafe) {
    throw new Error("Terminal reversible receipt lacks exact operation and Fetch gate accounting.");
  }
  if (summary) return;

  const interception = receipt.interception;
  if (!interception
    || Object.keys(interception).length !== expectedCount
    || expectedSteps.some((stepName) => !safeTerminalInterceptionEntry(interception[stepName]))) {
    throw new Error("Terminal reversible receipt lacks per-step bound Fetch gate evidence.");
  }
  const scalar = receipt.scalar ?? {};
  const typed = (value) => scalar.type === "boolean"
    ? typeof value === "boolean"
    : scalar.type === "integer" && Number.isSafeInteger(value);
  const evidence = receipt.evidence ?? {};
  const requiredEvidence = receipt.executionState === "committed-and-restored"
    ? ["preState", "apply", "postState", "rollback", "finalState"]
    : ["preState", "apply", "postState", "finalState"];
  if (requiredEvidence.some((stepName) => !successfulResponse(evidence[stepName]))) {
    throw new Error("Terminal reversible receipt lacks successful before, mutation, after, or restoration evidence.");
  }
  const before = extractJsonPointer(evidence.preState?.responseBody, scalar.jsonPointer);
  const after = extractJsonPointer(evidence.postState?.responseBody, scalar.jsonPointer);
  const restored = extractJsonPointer(evidence.finalState?.responseBody, scalar.jsonPointer);
  const scalarSafe = typed(scalar.beforeValue)
    && typed(scalar.testValue)
    && typed(scalar.postValue)
    && typed(scalar.finalValue)
    && before.available && before.value === scalar.beforeValue
    && after.available && after.value === scalar.postValue
    && restored.available && restored.value === scalar.finalValue
    && scalar.finalValue === scalar.beforeValue
    && (receipt.executionState === "committed-and-restored"
      ? scalar.postValue === scalar.testValue
      : scalar.postValue === scalar.beforeValue && evidence.rollback == null);
  const preEtag = headerValue(evidence.preState?.responseHeaders, "etag");
  const postEtag = headerValue(evidence.postState?.responseHeaders, "etag");
  const concurrencySafe = Boolean(preEtag)
    && headerValue(evidence.apply?.headers, "if-match") === preEtag
    && Boolean(postEtag)
    && (receipt.executionState !== "committed-and-restored"
      || headerValue(evidence.rollback?.headers, "if-match") === postEtag);
  if (!scalarSafe || !concurrencySafe) {
    throw new Error("Terminal reversible receipt lacks verified scalar restoration or concurrency evidence.");
  }
}

function assertReceiptMatchesPlan(receipt, plan) {
  const evidence = receipt.mode === "abort-only"
    ? { invoke: receipt.evidence?.request ?? null }
    : receipt.evidence ?? {};
  for (const [stepName, stepEvidence] of Object.entries(evidence)) {
    if (stepEvidence == null) continue;
    const step = plan.steps[stepName];
    if (!step
      || stepEvidence.actionIndex !== step.actionIndex
      || stepEvidence.method !== step.method
      || stepEvidence.url !== step.url
      || (step.requestBodyShapeFingerprint
        && stepEvidence.requestShapeFingerprint !== step.requestBodyShapeFingerprint)
      || (step.targetUrl && stepEvidence.targetUrl !== step.targetUrl)) {
      throw new Error(`Operation receipt evidence for ${stepName} does not match the active operation plan.`);
    }
  }
}

export function validateOperationReceipt(receipt, { summary = false } = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Operation receipt must be an object.");
  }
  if (receipt.schemaVersion !== operationReceiptSchemaVersion && !summary) {
    throw new Error("Operation receipt schema version is unsupported.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/u.test(String(receipt.operationId || ""))) {
    throw new Error("Operation receipt requires a valid operationId.");
  }
  if (!activeOperationModes.has(receipt.mode)) {
    throw new Error("Operation receipt mode is unsupported.");
  }
  if (!sha256Pattern.test(String(receipt.approvalDigest || ""))) {
    throw new Error("Operation receipt requires an approval digest.");
  }
  if (!operationExecutionStates.includes(receipt.executionState)) {
    throw new Error(`Operation receipt execution state ${JSON.stringify(receipt.executionState)} is unsupported.`);
  }
  if (receipt.mode === "abort-only" && !["aborted-before-send", "unresolved-change"].includes(receipt.executionState)) {
    throw new Error("Abort-only receipt has an incompatible execution state.");
  }
  if (receipt.executionState === "unresolved-change") {
    if (typeof receipt.unresolvedReason !== "string" || !receipt.unresolvedReason.trim()) {
      throw new Error("Unresolved operation receipt requires a reason.");
    }
  } else if (receipt.unresolvedReason != null) {
    throw new Error("Terminal safe operation receipt cannot carry an unresolved reason.");
  }
  if (!receipt.accounting || typeof receipt.accounting !== "object" || Array.isArray(receipt.accounting)) {
    throw new Error("Operation receipt requires accounting.");
  }
  assertTerminalReceiptIntegrity(receipt, { summary });
  return receipt;
}

export function validateOperationSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error("Active-operation summary must be an object.");
  }
  if (summary.schemaVersion !== operationReceiptSchemaVersion || !Array.isArray(summary.receipts)) {
    throw new Error("Active-operation summary schema is unsupported.");
  }
  for (const receipt of summary.receipts) validateOperationReceipt(receipt, { summary: true });
  const expected = summarizeOperationReceipts(summary.receipts, { summary: true });
  for (const state of operationExecutionStates) {
    if (summary.byState?.[state] !== expected.byState[state]) {
      throw new Error(`Active-operation summary count mismatch for ${state}.`);
    }
  }
  if (Object.keys(summary.byState ?? {}).some((state) => !operationExecutionStates.includes(state))) {
    throw new Error("Active-operation summary contains an unsupported state counter.");
  }
  if (summary.attemptCount !== expected.attemptCount
    || JSON.stringify(summary.unresolvedOperationIds) !== JSON.stringify(expected.unresolvedOperationIds)
    || summary.safeToContinue !== expected.safeToContinue) {
    throw new Error("Active-operation summary accounting is inconsistent.");
  }
  return summary;
}

export function validateMutationEventsArtifact(
  events,
  { activeOperationPlan = null, captureSummary = null } = {},
) {
  if (!events || events.schemaVersion !== 1 || !Array.isArray(events.receipts)) {
    throw new Error("mutation-events.json schema is unsupported.");
  }
  const derived = summarizeOperationReceipts(events.receipts);
  if (activeOperationPlan) {
    const plan = validateActiveOperationPlan(activeOperationPlan);
    if (events.authorization?.ceiling !== plan.mode
      || events.authorization?.approvalDigest !== plan.approvalDigest) {
      throw new Error("mutation-events.json authorization does not match the active operation plan.");
    }
    if (events.receipts.length !== 1 || events.receipts.some((receipt) => (
      receipt.operationId !== plan.operationId
      || receipt.mode !== plan.mode
      || receipt.approvalDigest !== plan.approvalDigest
    ))) {
      throw new Error("mutation-events.json receipt does not match the active operation plan.");
    }
    for (const receipt of events.receipts) assertReceiptMatchesPlan(receipt, plan);
  }
  validateOperationSummary(events.summary);
  if (JSON.stringify(events.summary) !== JSON.stringify(derived)) {
    throw new Error("mutation-events.json summary does not match its receipts.");
  }
  if (captureSummary != null) {
    validateOperationSummary(captureSummary);
    if (JSON.stringify(captureSummary) !== JSON.stringify(derived)) {
      throw new Error("summary.json active-operation state does not match mutation-events.json.");
    }
  }
  return derived;
}
