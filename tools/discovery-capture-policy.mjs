export const responseBodyCaptureLimit = 512 * 1024;

export function decodeBoundedCdpBody(payload, limit = responseBodyCaptureLimit) {
  const value = payload?.body ?? payload?.content;
  if (typeof value !== "string") {
    return null;
  }

  const encoding = payload?.base64Encoded ? "base64" : "utf8";
  if (Buffer.byteLength(value, encoding) > limit) {
    return null;
  }

  return payload?.base64Encoded
    ? Buffer.from(value, "base64").toString("utf8")
    : value;
}

export function shouldRequestResponseBody(encodedDataLength, limit = responseBodyCaptureLimit) {
  const length = Number(encodedDataLength);
  return Number.isFinite(length) && length >= 0 && length <= limit;
}

export function actionResultSucceeded(actionResult) {
  const { result = {}, type: rawType } = actionResult ?? {};
  const type = String(rawType || "");
  if (type === "navigate") {
    try {
      const actual = new URL(result.url);
      const expected = new URL(result.resolvedUrl ?? actionResult.value);
      return actual.origin === expected.origin
        && (actionResult.allowCanonicalRedirect || actual.pathname === expected.pathname);
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
    return result.outcome === "confirmed";
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

function controlMatchesAction(control, action, snapshot) {
  const value = normalizeText(action?.value);
  const lowerValue = value.toLowerCase();
  const textValues = [
    control?.text,
    control?.ariaLabel,
    control?.automationId,
  ].map((item) => normalizeText(item).toLowerCase()).filter(Boolean);

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
  let applicableSnapshotCount = 0;
  let incomplete = false;
  for (const snapshot of snapshots) {
    if (!scopeMatchesSnapshot(action.scope, snapshot)) {
      continue;
    }
    applicableSnapshotCount += 1;
    if (
      snapshot?.error
      || !(typeof snapshot?.url === "string" || typeof snapshot?.targetUrl === "string")
    ) {
      incomplete = true;
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
      targetType: snapshot.targetType ?? "page",
      targetUrl: snapshot.targetUrl ?? snapshot.url ?? null,
    });
  }

  if (incomplete || applicableSnapshotCount === 0) {
    return {
      candidateCount: null,
      reason: "pre-action-inventory-incomplete",
      status: "unknown",
      targetFrameInventory,
    };
  }

  return {
    candidateCount,
    reason: candidateCount > 1
      ? "ambiguous-selector-candidates"
      : candidateCount > 0
      ? "selector-candidate-present"
      : "control-absent-or-not-applicable",
    status: candidateCount > 1
      ? "ambiguous"
      : candidateCount > 0 ? "eligible" : "absent-not-applicable",
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
