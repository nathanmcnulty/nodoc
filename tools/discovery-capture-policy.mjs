// Recipe fields are covered by the full execution digest. Readers accept an
// explicit validated policy, never a larger limit asserted by a descriptor.
export const maximumResponseBodyBytes = 256 * 1024 * 1024;
export function resolveResponseBodyLimits(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)
      || Object.keys(config).some(key => !["perBodyBytes", "totalBytes"].includes(key))) throw new Error("Invalid response-body limits.");
  function setting(name, fallback, maximum) {
    const value = config[name] === undefined ? fallback : config[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} exceeds the bounded response-body budget.`);
    return value;
  }
  const perBodyBytes = setting("perBodyBytes", 16 * 1024 * 1024, maximumResponseBodyBytes);
  const totalBytes = setting("totalBytes", 256 * 1024 * 1024, 1024 * 1024 * 1024);
  if (totalBytes < perBodyBytes) throw new Error("Response-body total budget must cover one complete body.");
  return Object.freeze({ perBodyBytes, totalBytes });
}

export const responseBodyLimits = resolveResponseBodyLimits();
export const responseBodyCaptureLimit = responseBodyLimits.perBodyBytes;

export function responseBodyNetworkOptions(limits = responseBodyLimits) {
  limits = resolveResponseBodyLimits(limits);
  return {
    maxPostDataSize: 128 * 1024,
    maxResourceBufferSize: limits.perBodyBytes,
    maxTotalBufferSize: limits.totalBytes,
  };
}

export function createResponseBodySessionPool(limits = responseBodyLimits) {
  limits = resolveResponseBodyLimits(limits);
  const sessions = new Set();
  return {
    reserve(key) {
      if (!sessions.has(key) && (sessions.size + 1) * limits.perBodyBytes > limits.totalBytes) return null;
      sessions.add(key);
      // CDP totals are per session. One full-body slot per session keeps their
      // sum bounded; the global fetch queue and disk budget are separate.
      return { perBodyBytes: limits.perBodyBytes, totalBytes: limits.perBodyBytes };
    },
    release(key) { sessions.delete(key); },
  };
}

export async function configureResponseBodyNetwork(send, limits = responseBodyLimits) {
  limits = resolveResponseBodyLimits(limits);
  await send("Network.enable", responseBodyNetworkOptions(limits));
  // The dedicated command is safe on paused auto-attached targets; the
  // deprecated Network.enable flag can deadlock before debugger resume.
  try {
    await send("Network.configureDurableMessages", {
      maxResourceBufferSize: limits.perBodyBytes,
      maxTotalBufferSize: limits.totalBytes,
    });
    return { durable: true };
  } catch (error) {
    return { durable: false, diagnostic: [-32601, -32602].includes(error?.code)
      ? "cdp-durable-body-buffer-unsupported" : "cdp-durable-body-buffer-unavailable" };
  }
}

// Fetch immediately while Chrome still owns the response, but serialize
// sanitization and writes. Reserve a full per-body slot until consumed so
// pending payloads cannot grow without a bound.
export function createResponseBodyQueue(limits = responseBodyLimits) {
  limits = resolveResponseBodyLimits(limits);
  let reserved = 0;
  let tail = Promise.resolve();
  return (load, consume) => {
    if (reserved + limits.perBodyBytes > limits.totalBytes) return null;
    reserved += limits.perBodyBytes;
    const fetched = Promise.resolve().then(load).then(value => ({ value }), error => ({ error }));
    const result = tail.then(async () => {
      const outcome = await fetched;
      return consume(() => Object.hasOwn(outcome, "error") ? Promise.reject(outcome.error) : Promise.resolve(outcome.value));
    }).finally(() => { reserved -= limits.perBodyBytes; });
    tail = result.catch(() => {});
    return result;
  };
}

export function classifyResponseBodyRetrievalError(error) {
  // Never serialize the original CDP message: it may contain private data.
  const message = String(error?.message ?? "");
  if (/evicted.*(?:cache|buffer)|(?:cache|buffer).*evicted/iu.test(message)) return "cdp-response-body-evicted";
  if (/no resource with given identifier|no data found for resource/iu.test(message)) return "cdp-response-body-unavailable";
  if (/session.*(?:closed|not found)|target.*closed|websocket.*(?:closed|not open)/iu.test(message)) return "cdp-response-body-session-closed";
  if (/timed?\s*out|timeout/iu.test(message)) return "cdp-response-body-timeout";
  if (error?.code === "RESPONSE_BODY_BUDGET") return "response-body-pending-budget-exceeded";
  return "cdp-response-body-retrieval-failed";
}

export function buildInteractionHealthStatus(capture, interactionHealth) {
  if (interactionHealth) {
    return { available: true, reason: null, source: "summary-and-action-results" };
  }
  return {
    available: false,
    reason: capture?.reason === "summary-missing"
      ? "summary-missing"
      : capture?.reason === "summary-invalid-json" || capture?.reason === "summary-invalid"
        ? "summary-corrupt"
        : "canonical-health-unavailable",
    source: capture?.source ?? "artifact-directory",
  };
}

export function decodeBoundedCdpBody(payload, limit = responseBodyCaptureLimit) {
  const result = decodeBoundedCdpBodyResult(payload, limit);
  return result.state === "complete" ? result.body : null;
}

export function decodeBoundedCdpBodyResult(payload, limit = responseBodyCaptureLimit) {
  const value = payload?.body ?? payload?.content;
  if (typeof value !== "string") {
    return { state: "decode-failed", body: null, byteLength: 0 };
  }
  let bytes;
  try {
    if (payload?.base64Encoded) {
      if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return { state: "decode-failed", body: null, byteLength: 0 };
      const byteLength = value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
      if (byteLength > limit) return { state: "oversize", body: null, byteLength };
      bytes = Buffer.from(value, "base64");
    } else {
      const byteLength = Buffer.byteLength(value, "utf8");
      if (byteLength > limit) return { state: "oversize", body: null, byteLength };
      bytes = Buffer.from(value, "utf8");
    }
    if (bytes.byteLength > limit) return { state: "oversize", body: null, byteLength: bytes.byteLength };
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { state: "complete", body, byteLength: bytes.byteLength };
  } catch {
    return { state: "decode-failed", body: null, byteLength: bytes?.byteLength ?? 0 };
  }
}

export function shouldRequestResponseBody(encodedDataLength, limit = responseBodyCaptureLimit) {
  const length = Number(encodedDataLength);
  return Number.isFinite(length) && length >= 0 && length <= limit;
}

export function responseBodyAdmission(encodedDataLength, networkReady, limit = responseBodyCaptureLimit) {
  if (!networkReady) return { state: "truncated", diagnostic: "cdp-response-body-network-unavailable" };
  if (!shouldRequestResponseBody(encodedDataLength, limit)) return { state: "oversize", diagnostic: null };
  return null;
}

export function actionResultSucceeded(actionResult) {
  const { result = {}, type: rawType } = actionResult ?? {};
  const type = String(rawType || "");
  if (type === "navigate") {
    try {
      const actual = new URL(result.url);
      const expected = new URL(result.resolvedUrl ?? actionResult.value);
      return actual.origin === expected.origin
        && (actionResult.allowCanonicalRedirect || (
          actual.pathname === expected.pathname
          && actual.search === expected.search
          && actual.hash === expected.hash
        ));
    } catch {
      return false;
    }
  }
  if (type === "reload") {
    try {
      return result.didLoad === true
        && new URL(result.url).href === new URL(result.resolvedUrl).href;
    } catch {
      return false;
    }
  }
  if (type.startsWith("click")) {
    const transitionEvidence = result.transitionEvidence ?? {};
    return result.clicked === true && (
      result.beforeUrl !== result.afterUrl
      || result.stateTransition === true
      || result.targetTransition === true
      || transitionEvidence.urlChanged === true
      || transitionEvidence.stateChanged === true
      || transitionEvidence.targetChanged === true
    );
  }
  if (type === "probe-get") {
    return ["auth-blocked", "confirmed", "http-error", "not-found"].includes(result.outcome)
      && Number.isInteger(result.status);
  }
  if (type === "replay-seeded-links" || type === "replay-seeded-routes") {
    return Number(result.replayedCount) > 0;
  }
  return true;
}

export function summarizeActionResults(actionResults, { includeInteractionHealth = false } = {}) {
  const requiredFailures = actionResults
    .filter((actionResult) => actionResult.required && !actionResultSucceeded(actionResult))
    .map(({ page, type, value }) => ({ page, type, value }));
  return {
    ...(includeInteractionHealth
      ? { interactionHealth: aggregateInteractionHealth(actionResults) }
      : {}),
    requiredActionCount: actionResults.filter((actionResult) => actionResult.required).length,
    requiredActionFailureCount: requiredFailures.length,
    requiredActionFailures: requiredFailures,
    countedActionCount: actionResults.length,
  };
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function isClickAction(action) {
  return String(action?.type || "").startsWith("click");
}

function scopeMatchesSnapshot(scope, snapshot) {
  if (scope === "root") {
    return snapshot?.sessionId === "root";
  }
  if (scope === "iframe") {
    return snapshot?.targetType === "iframe";
  }
  return true;
}

export function controlMatchesAction(control, action, snapshot) {
  const value = normalizeText(action?.value);
  const lowerValue = value.toLowerCase();
  const textValues = [
    control?.text,
    control?.ariaLabel,
    control?.automationId,
  ].map((item) => normalizeText(item).toLowerCase()).filter(Boolean);

  if (action?.type === "click-automation-id") {
    return normalizeText(control?.automationId) === value;
  }

  if (action?.type === "click-href") {
    if (normalizeText(control?.href) === value) {
      return true;
    }
    try {
      return new URL(control?.href, snapshot?.targetUrl || undefined).toString() === value;
    } catch {
      return false;
    }
  }

  if (action?.type === "click-contains") {
    return textValues.some((item) => item.includes(lowerValue));
  }

  return textValues.some((item) => item === lowerValue);
}

function safeControlHintText(value) {
  const text = normalizeText(value);
  if (!text || text.length > 160) return null;
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu.test(text)) return null;
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(text)) return null;
  return text;
}

function safeControlHintHref(value, targetUrl) {
  if (!value) return null;
  try {
    const parsed = new URL(value, targetUrl || undefined);
    if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password) return null;
    const sensitiveSegment = parsed.pathname.split("/").some((segment) => (
      segment.includes("@")
      || segment.length > 48
      || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(segment)
    ));
    return sensitiveSegment ? null : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export function deriveControlSelectorHints(action, snapshots, limit = 8) {
  if (!isClickAction(action) || !Array.isArray(snapshots)) return [];
  const hints = [];
  for (const snapshot of snapshots) {
    if (snapshot?.error || !scopeMatchesSnapshot(action.scope, snapshot)) continue;
    for (const control of Array.isArray(snapshot.controls) ? snapshot.controls : []) {
      if (!controlMatchesAction(control, action, snapshot)) continue;
      const hint = {
        ariaLabel: safeControlHintText(control?.ariaLabel),
        automationId: safeControlHintText(control?.automationId),
        href: safeControlHintHref(control?.href, snapshot?.targetUrl ?? snapshot?.url),
        role: safeControlHintText(control?.role),
        tag: safeControlHintText(control?.tag),
        text: safeControlHintText(control?.text),
      };
      const compact = Object.fromEntries(Object.entries(hint).filter(([, value]) => value));
      if (Object.keys(compact).some((key) => ["ariaLabel", "automationId", "href", "text"].includes(key))) {
        hints.push(compact);
      }
      if (hints.length >= limit) return hints;
    }
  }
  return hints;
}

export function deriveActionEligibility(action, snapshots) {
  if (!isClickAction(action)) {
    return null;
  }
  if (!Array.isArray(snapshots)) {
    return {
      candidateCount: null,
      status: "unknown",
      reason: "pre-action-inventory-unavailable",
      targetFrameInventory: [],
    };
  }

  const targetFrameInventory = [];
  let candidateCount = 0;
  for (const snapshot of snapshots) {
    if (snapshot?.error || !scopeMatchesSnapshot(action.scope, snapshot)) {
      continue;
    }
    const controls = Array.isArray(snapshot.controls) ? snapshot.controls : [];
    const matchingControls = controls.filter((control) => (
      controlMatchesAction(control, action, snapshot)
    ));
    candidateCount += matchingControls.length;
    targetFrameInventory.push({
      candidateCount: matchingControls.length,
      controlCount: controls.length,
      sessionId: snapshot.sessionId ?? null,
      targetId: snapshot.targetId ?? null,
      targetType: snapshot.targetType ?? "page",
      targetUrl: snapshot.targetUrl ?? snapshot.url ?? null,
    });
  }

  return {
    candidateCount,
    reason: candidateCount > 0
      ? "selector-candidate-present"
      : "control-absent-or-not-applicable",
    status: candidateCount > 0 ? "eligible" : "absent-not-applicable",
    targetFrameInventory,
  };
}

function normalizeEligibility(value) {
  const status = String(value?.status || "").trim();
  if (["eligible", "absent-not-applicable", "unknown"].includes(status)) {
    return status;
  }
  return "unknown";
}

function normalizeTransitionEvidence(value) {
  const transition = value && typeof value === "object" ? value : {};
  const newRequestFamilies = Array.isArray(transition.newRequestFamilies)
    ? Array.from(new Set(transition.newRequestFamilies.map((item) => String(item)).filter(Boolean))).sort()
    : [];
  const stateChanged = transition.stateChanged === true
    ? true
    : transition.stateChanged === false
      ? false
      : null;
  const urlChanged = transition.urlChanged === true
    ? true
    : transition.urlChanged === false
      ? false
      : null;
  const targetChanged = transition.targetChanged === true
    ? true
    : transition.targetChanged === false
      ? false
      : null;
  return {
    afterStateFingerprint: transition.afterStateFingerprint ?? null,
    afterUrl: transition.afterUrl ?? null,
    afterTargets: Array.isArray(transition.afterTargets) ? transition.afterTargets : [],
    beforeStateFingerprint: transition.beforeStateFingerprint ?? null,
    beforeUrl: transition.beforeUrl ?? null,
    beforeTargets: Array.isArray(transition.beforeTargets) ? transition.beforeTargets : [],
    newRequestFamilies,
    noNewRequestFamily: newRequestFamilies.length === 0,
    noTransition:
      transition.noTransition === true
      || (stateChanged === false && urlChanged === false && targetChanged === false),
    repeatedUnchangedState: transition.repeatedUnchangedState === true
      || (stateChanged === false && transition.beforeStateFingerprint === transition.afterStateFingerprint),
    stateChanged,
    targetChanged,
    urlChanged,
  };
}

function compareAccounting(actual, reported) {
  if (!reported || typeof reported !== "object") {
    return null;
  }

  const fields = [
    "attempted",
    "eligibleAttempts",
    "succeeded",
    "missed",
    "absentNotApplicable",
  ];
  const mismatches = [];
  for (const field of fields) {
    const expected = Number(reported[field] ?? reported.eligible?.[field]);
    if (!Number.isFinite(expected)) {
      continue;
    }
    if (expected !== actual.counts[field]) {
      mismatches.push({
        actual: actual.counts[field],
        expected,
        field,
      });
    }
  }
  return mismatches.length > 0
    ? {
        code: "interaction-health-accounting-mismatch",
        mismatches,
      }
    : null;
}

export function aggregateInteractionHealth(actionResults, { reported } = {}) {
  const interactions = (Array.isArray(actionResults) ? actionResults : [])
    .filter(isClickAction);
  const records = interactions.map((actionResult) => {
    const result = actionResult?.result ?? {};
    const eligibility = normalizeEligibility(
      actionResult?.eligibility ?? result.eligibility,
    );
    const succeeded = actionResultSucceeded(actionResult);
    const transitionEvidence = normalizeTransitionEvidence(
      actionResult?.transitionEvidence ?? result.transitionEvidence,
    );
    return {
      eligibility,
      highValue: actionResult?.highValue === true || result.highValue === true,
      succeeded,
      transitionEvidence,
    };
  });

  const eligibleRecords = records.filter((record) => record.eligibility === "eligible");
  const eligibleMisses = eligibleRecords.filter((record) => !record.succeeded);
  const highValueMisses = eligibleMisses.filter((record) => record.highValue);
  const unchangedStateMisses = eligibleMisses.filter(
    (record) => record.transitionEvidence.repeatedUnchangedState,
  );
  const noTransitionMisses = eligibleMisses.filter(
    (record) => record.transitionEvidence.noTransition,
  );
  const noNewRequestFamilyMisses = eligibleMisses.filter(
    (record) => record.transitionEvidence.noNewRequestFamily,
  );
  let unchangedStateStreak = 0;
  let maxUnchangedStateStreak = 0;
  for (const record of records) {
    if (record.eligibility === "eligible" && !record.succeeded && record.transitionEvidence.repeatedUnchangedState) {
      unchangedStateStreak += 1;
      maxUnchangedStateStreak = Math.max(maxUnchangedStateStreak, unchangedStateStreak);
    } else {
      unchangedStateStreak = 0;
    }
  }

  const counts = {
    absentNotApplicable: records.filter((record) => record.eligibility === "absent-not-applicable").length,
    attempted: records.length,
    eligibleAttempts: eligibleRecords.length,
    eligibleMisses: eligibleMisses.length,
    eligibleSucceeded: eligibleRecords.filter((record) => record.succeeded).length,
    highValueAttempts: records.filter((record) => record.highValue).length,
    highValueMisses: highValueMisses.length,
    missed: eligibleMisses.length,
    noNewRequestFamilyMisses: noNewRequestFamilyMisses.length,
    noTransitionMisses: noTransitionMisses.length,
    succeeded: records.filter((record) => record.succeeded).length,
    unchangedStateMisses: unchangedStateMisses.length,
    unknownEligibility: records.filter((record) => record.eligibility === "unknown").length,
  };
  const missRate = counts.eligibleAttempts > 0
    ? counts.eligibleMisses / counts.eligibleAttempts
    : null;
  const corroborated =
    counts.eligibleMisses >= 2
    && maxUnchangedStateStreak >= 2
    && counts.noTransitionMisses >= 2
    && counts.noNewRequestFamilyMisses >= 2;
  const baselineTriggered = counts.eligibleAttempts >= 4 && missRate >= 0.5;
  const highValueTriggered =
    counts.eligibleAttempts >= 2
    && missRate === 1
    && counts.highValueMisses > 0;
  const escalationRecommended = corroborated && (baselineTriggered || highValueTriggered);
  const inconsistency = compareAccounting({ counts }, reported);

  return {
    accounting: {
      consistent: !inconsistency,
      inconsistency,
    },
    corroboration: {
      maxUnchangedStateStreak,
      noNewRequestFamilyMisses: counts.noNewRequestFamilyMisses,
      noTransitionMisses: counts.noTransitionMisses,
      repeatedUnchangedState: corroborated,
    },
    counts,
    missRate,
    recommendation: {
      baselineTriggered,
      corroborated,
      highValueTriggered,
      recommended: escalationRecommended,
      code: escalationRecommended
        ? "escalate-interaction-health"
        : "no-interaction-health-escalation",
    },
    schemaVersion: 1,
  };
}

export function buildTransitionEvidence({
  afterPageState,
  afterSnapshots = [],
  afterUrl,
  beforePageState,
  beforeSnapshots = [],
  beforeUrl,
  newRequestFamilies = [],
}) {
  const beforeTargets = beforeSnapshots.map((snapshot) => ({
    sessionId: snapshot.sessionId ?? null,
    targetType: snapshot.targetType ?? "page",
    targetUrl: snapshot.targetUrl ?? snapshot.url ?? null,
  }));
  const afterTargets = afterSnapshots.map((snapshot) => ({
    sessionId: snapshot.sessionId ?? null,
    targetType: snapshot.targetType ?? "page",
    targetUrl: snapshot.targetUrl ?? snapshot.url ?? null,
  }));
  const stateChanged = Boolean(beforePageState?.stateFingerprint)
    && Boolean(afterPageState?.stateFingerprint)
    ? beforePageState.stateFingerprint !== afterPageState.stateFingerprint
    : null;
  const urlChanged = Boolean(beforeUrl) && Boolean(afterUrl)
    ? beforeUrl !== afterUrl
    : null;
  const targetChanged = JSON.stringify(beforeTargets) !== JSON.stringify(afterTargets);
  return normalizeTransitionEvidence({
    afterStateFingerprint: afterPageState?.stateFingerprint ?? null,
    beforeStateFingerprint: beforePageState?.stateFingerprint ?? null,
    newRequestFamilies,
    stateChanged,
    targetChanged,
    urlChanged,
  });
}

export function sanitizeInteractionHealth(signal) {
  if (!signal || typeof signal !== "object") {
    return null;
  }
  const counts = signal.counts && typeof signal.counts === "object" ? signal.counts : {};
  const countNames = [
    "absentNotApplicable",
    "attempted",
    "eligibleAttempts",
    "eligibleMisses",
    "eligibleSucceeded",
    "highValueAttempts",
    "highValueMisses",
    "missed",
    "noNewRequestFamilyMisses",
    "noTransitionMisses",
    "succeeded",
    "unchangedStateMisses",
    "unknownEligibility",
  ];
  const sanitizedCounts = Object.fromEntries(
    countNames.map((name) => [name, Number.isFinite(Number(counts[name])) ? Number(counts[name]) : 0]),
  );
  return {
    accounting: {
      consistent: signal.accounting?.consistent !== false,
      inconsistency: signal.accounting?.inconsistency
        ? {
            code: String(signal.accounting.inconsistency.code || "interaction-health-accounting-mismatch"),
            mismatches: Array.isArray(signal.accounting.inconsistency.mismatches)
              ? signal.accounting.inconsistency.mismatches.map((mismatch) => ({
                  actual: Number(mismatch.actual),
                  expected: Number(mismatch.expected),
                  field: String(mismatch.field),
                }))
              : [],
          }
        : null,
    },
    counts: sanitizedCounts,
    missRate: signal.missRate === null ? null : Number(signal.missRate),
    recommendation: {
      baselineTriggered: signal.recommendation?.baselineTriggered === true,
      corroborated: signal.recommendation?.corroborated === true,
      highValueTriggered: signal.recommendation?.highValueTriggered === true,
      recommended: signal.recommendation?.recommended === true,
      code: String(signal.recommendation?.code || "no-interaction-health-escalation"),
    },
    schemaVersion: Number(signal.schemaVersion) || 1,
  };
}
