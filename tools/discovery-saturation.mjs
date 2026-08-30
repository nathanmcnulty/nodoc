const saturationSchemaVersion = 1;

const defaultThresholds = Object.freeze({
  consecutiveWindows: 2,
  lowGainThreshold: 0,
  minimumEvidenceWindows: 2,
  windowSize: 4,
});

function integer(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;
}

function sortedUnique(values) {
  return Array.from(new Set((values ?? []).map((value) => String(value ?? "")).filter(Boolean))).sort();
}

function normalizeThresholds(input = {}) {
  return {
    consecutiveWindows: Math.max(1, integer(input.consecutiveWindows, defaultThresholds.consecutiveWindows)),
    lowGainThreshold: integer(input.lowGainThreshold, defaultThresholds.lowGainThreshold),
    minimumEvidenceWindows: Math.max(1, integer(input.minimumEvidenceWindows, defaultThresholds.minimumEvidenceWindows)),
    windowSize: Math.max(1, integer(input.windowSize, defaultThresholds.windowSize)),
  };
}

function clickSucceeded(action) {
  const result = action?.result ?? {};
  const transition = action?.transitionEvidence ?? result.transitionEvidence ?? {};
  return action?.eligibility?.status === "eligible"
    && (result.clicked === true || action?.succeeded === true)
    && (
      result.beforeUrl !== result.afterUrl
      || result.stateTransition === true
      || result.targetTransition === true
      || transition.urlChanged === true
      || transition.stateChanged === true
      || transition.targetChanged === true
    );
}

function actionEligibility(action) {
  return String(action?.eligibility?.status ?? action?.result?.eligibility?.status ?? "unknown");
}

function actionGain(action) {
  const result = action?.result ?? {};
  const transition = action?.transitionEvidence ?? result.transitionEvidence ?? {};
  return {
    newCandidateFamilies: sortedUnique(
      action?.newCandidateFamilies ?? result.newCandidateFamilies ?? transition.newCandidateFamilies,
    ),
    newRequestFamilies: sortedUnique(
      action?.newRequestFamilies ?? result.newRequestFamilies ?? transition.newRequestFamilies,
    ),
    successfulTransitions: clickSucceeded(action) ? 1 : 0,
  };
}

function buildWindows(actionResults, windowSize) {
  const actions = (Array.isArray(actionResults) ? actionResults : [])
    .filter((action) => String(action?.type ?? "").startsWith("click"));
  const windows = [];
  for (let index = 0; index < actions.length; index += windowSize) {
    const records = actions.slice(index, index + windowSize);
    const gains = records.reduce((total, action) => {
      const gain = actionGain(action);
      total.newCandidateFamilies.push(...gain.newCandidateFamilies);
      total.newRequestFamilies.push(...gain.newRequestFamilies);
      total.successfulTransitions += gain.successfulTransitions;
      return total;
    }, { newCandidateFamilies: [], newRequestFamilies: [], successfulTransitions: 0 });
    gains.newCandidateFamilies = sortedUnique(gains.newCandidateFamilies);
    gains.newRequestFamilies = sortedUnique(gains.newRequestFamilies);
    windows.push({
      actionCount: records.length,
      eligibleActionCount: records.filter((action) => actionEligibility(action) === "eligible").length,
      gain: {
        candidateFamilies: gains.newCandidateFamilies.length,
        newCandidateFamilies: gains.newCandidateFamilies,
        newRequestFamilies: gains.newRequestFamilies,
        requestFamilies: gains.newRequestFamilies.length,
        successfulTransitions: gains.successfulTransitions,
        total: gains.newCandidateFamilies.length + gains.newRequestFamilies.length + gains.successfulTransitions,
      },
      index: windows.length,
    });
  }
  return windows;
}

function candidateFamilies(candidateQueue) {
  return sortedUnique([
    ...(candidateQueue?.candidates ?? []).map((candidate) => candidate.featureFamily),
    ...(candidateQueue?.scopeReviewCandidates ?? []).map((candidate) => candidate.featureFamily),
  ]);
}

export function evaluateDiscoverySaturation({
  actionResults = [],
  candidateQueue = null,
  capture = null,
  interactionHealth = null,
  interactionHealthStatus = null,
  activeOperations = null,
  recipe = null,
  requiredActionFailures = [],
  enabled = false,
  applyStop = false,
  thresholds: thresholdInput = {},
} = {}) {
  const thresholds = normalizeThresholds(thresholdInput);
  const windows = buildWindows(actionResults, thresholds.windowSize);
  const candidateFamilyList = candidateFamilies(candidateQueue);
  const captureComplete = capture?.captureComplete === true || capture?.captureStatus === "complete";
  const summaryAvailable = interactionHealthStatus?.available === true && interactionHealth !== null;
  const healthConsistent = interactionHealth?.accounting?.consistent === true;
  const unknownEligibility = (Array.isArray(actionResults) ? actionResults : [])
    .filter((action) => String(action?.type ?? "").startsWith("click"))
    .filter((action) => actionEligibility(action) === "unknown").length;
  const recipeActionCount = integer(recipe?.actions?.length, 0);
  const completedActionCount = integer(actionResults.length, 0);
  const recipeComplete = recipeActionCount > 0 && completedActionCount >= recipeActionCount;
  const highValuePending = (Array.isArray(actionResults) ? actionResults : [])
    .some((action) => action?.highValue === true && actionEligibility(action) === "eligible" && !clickSucceeded(action));
  const scopeAmbiguity = integer(candidateQueue?.summary?.scopeReviewCandidateCount)
    + (candidateQueue?.scopeReviewCandidates?.length ?? 0);
  const unresolvedRequiredFailures = (requiredActionFailures?.length ?? 0)
    + (interactionHealth?.counts?.highValueMisses ?? 0);
  const interactionFailure = interactionHealth?.recommendation?.recommended === true;
  const unresolvedActiveOperations = activeOperations?.safeToContinue === false
    ? activeOperations.unresolvedOperationIds?.length ?? 1
    : 0;
  const lowGainWindows = windows.filter((window) => window.gain.total <= thresholds.lowGainThreshold);
  let consecutiveLowGainWindows = 0;
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if (windows[index].gain.total <= thresholds.lowGainThreshold) consecutiveLowGainWindows += 1;
    else break;
  }
  const blockers = [];
  if (!captureComplete) blockers.push("capture-incomplete");
  if (!summaryAvailable) blockers.push("summary-missing");
  if (!healthConsistent) blockers.push(interactionHealth ? "health-accounting-mismatch" : "canonical-health-unavailable");
  if (unknownEligibility > 0) blockers.push("unknown-eligibility");
  if (highValuePending) blockers.push("high-value-pending-action");
  if (unresolvedRequiredFailures > 0) blockers.push("unresolved-required-failure");
  if (scopeAmbiguity > 0) blockers.push("scope-ambiguity");
  if (interactionFailure) blockers.push("interaction-failure");
  if (unresolvedActiveOperations > 0) blockers.push("unresolved-active-operation");
  const evidenceReady = windows.length >= thresholds.minimumEvidenceWindows;
  const repeatedLowGain = consecutiveLowGainWindows >= thresholds.consecutiveWindows;
  const healthySaturation = evidenceReady && repeatedLowGain && blockers.length === 0;
  const reason = !captureComplete
    ? "interrupted-capture"
    : !summaryAvailable
      ? "summary-missing"
      : !healthConsistent
        ? interactionHealth ? "health-mismatch" : "unknown-health"
        : blockers.includes("interaction-failure")
          ? "interaction-failure"
          : healthySaturation
            ? "healthy-saturation"
            : recipeComplete
              ? "recipe-exhausted"
              : evidenceReady && repeatedLowGain
                ? "low-yield-incomplete"
                : "insufficient-evidence-window";
  return {
    schemaVersion: saturationSchemaVersion,
    available: captureComplete && summaryAvailable && healthConsistent,
    enabled: enabled === true,
    applied: enabled === true && applyStop === true && healthySaturation,
    reason,
    thresholds,
    recipeComplete,
    windowsEvaluated: windows.length,
    consecutiveLowGainWindows,
    lowGainWindowCount: lowGainWindows.length,
    gains: {
      candidateFamilies: candidateFamilyList.length,
      requestFamilies: sortedUnique(windows.flatMap((window) => window.gain.newRequestFamilies)).length,
      successfulTransitions: windows.reduce((sum, window) => sum + window.gain.successfulTransitions, 0),
    },
    remainingEligibleWork: {
      eligibleActions: (Array.isArray(actionResults) ? actionResults : [])
        .filter((action) => actionEligibility(action) === "eligible").length,
      highValuePending: highValuePending ? 1 : 0,
      scopeAmbiguity,
      unknownEligibility,
      unresolvedActiveOperations,
    },
    blockers: sortedUnique(blockers),
    windows,
  };
}

export function sanitizeDiscoverySaturation(signal) {
  if (!signal || typeof signal !== "object") return null;
  return {
    schemaVersion: saturationSchemaVersion,
    available: signal.available === true,
    enabled: signal.enabled === true,
    applied: signal.applied === true,
    reason: String(signal.reason ?? "unknown"),
    thresholds: normalizeThresholds(signal.thresholds),
    recipeComplete: signal.recipeComplete === true,
    windowsEvaluated: integer(signal.windowsEvaluated),
    consecutiveLowGainWindows: integer(signal.consecutiveLowGainWindows),
    lowGainWindowCount: integer(signal.lowGainWindowCount),
    gains: {
      candidateFamilies: integer(signal.gains?.candidateFamilies),
      requestFamilies: integer(signal.gains?.requestFamilies),
      successfulTransitions: integer(signal.gains?.successfulTransitions),
    },
    remainingEligibleWork: {
      eligibleActions: integer(signal.remainingEligibleWork?.eligibleActions),
      highValuePending: integer(signal.remainingEligibleWork?.highValuePending),
      scopeAmbiguity: integer(signal.remainingEligibleWork?.scopeAmbiguity),
      unknownEligibility: integer(signal.remainingEligibleWork?.unknownEligibility),
      unresolvedActiveOperations: integer(signal.remainingEligibleWork?.unresolvedActiveOperations),
    },
    blockers: sortedUnique(signal.blockers),
    windows: (Array.isArray(signal.windows) ? signal.windows : []).map((window, index) => ({
      actionCount: integer(window?.actionCount),
      eligibleActionCount: integer(window?.eligibleActionCount),
      gain: {
        candidateFamilies: integer(window?.gain?.candidateFamilies),
        requestFamilies: integer(window?.gain?.requestFamilies),
        successfulTransitions: integer(window?.gain?.successfulTransitions),
        total: integer(window?.gain?.total),
      },
      index,
    })),
  };
}

export { defaultThresholds, saturationSchemaVersion };
