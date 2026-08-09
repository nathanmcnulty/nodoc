import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateInteractionHealth,
  actionResultSucceeded,
  deriveActionEligibility,
  decodeBoundedCdpBody,
  shouldRequestResponseBody,
  summarizeActionResults,
} from "../discovery-capture-policy.mjs";
import { evaluateDiscoverySaturation } from "../discovery-saturation.mjs";

function click(index, gain = {}) {
  return {
    type: "click-label",
    eligibility: { status: "eligible" },
    result: {
      clicked: true,
      beforeUrl: `/before-${index}`,
      afterUrl: `/after-${index}`,
      ...gain,
    },
  };
}

function unchangedClick() {
  return {
    type: "click-label",
    eligibility: { status: "eligible" },
    result: { clicked: false },
  };
}

test("productive novelty prevents saturation", () => {
  const signal = evaluateDiscoverySaturation({
    actionResults: [click(1), click(2, { newRequestFamilies: ["family-b"] }), click(3), click(4)],
    capture: { captureComplete: true },
    interactionHealth: { accounting: { consistent: true } },
    interactionHealthStatus: { available: true },
    enabled: true,
    thresholds: { windowSize: 2, minimumEvidenceWindows: 2, consecutiveWindows: 2 },
  });
  assert.equal(signal.reason, "insufficient-evidence-window");
  assert.equal(signal.applied, false);
});

test("healthy repeated zero-gain windows are stoppable only when enabled", () => {
  const signal = evaluateDiscoverySaturation({
    actionResults: [unchangedClick(), unchangedClick(), unchangedClick(), unchangedClick()],
    capture: { captureComplete: true },
    interactionHealth: { accounting: { consistent: true } },
    interactionHealthStatus: { available: true },
    enabled: true,
    applyStop: true,
    thresholds: { windowSize: 2, minimumEvidenceWindows: 2, consecutiveWindows: 2 },
  });
  assert.equal(signal.reason, "healthy-saturation");
  assert.equal(signal.applied, true);
});

test("missing summary makes saturation unavailable", () => {
  const signal = evaluateDiscoverySaturation({
    actionResults: [click(1), click(2)],
    capture: { captureComplete: true },
    interactionHealthStatus: { available: false },
    enabled: true,
  });
  assert.equal(signal.available, false);
  assert.equal(signal.reason, "summary-missing");
});

test("high-value pending work blocks a healthy stop", () => {
  const signal = evaluateDiscoverySaturation({
    actionResults: [
      { ...unchangedClick(), highValue: true },
      unchangedClick(),
      unchangedClick(),
      unchangedClick(),
    ],
    capture: { captureComplete: true },
    interactionHealth: { accounting: { consistent: true } },
    interactionHealthStatus: { available: true },
    enabled: true,
    applyStop: true,
    thresholds: { windowSize: 2, minimumEvidenceWindows: 2, consecutiveWindows: 2 },
  });
  assert.equal(signal.reason, "low-yield-incomplete");
  assert.equal(signal.applied, false);
  assert.deepEqual(signal.blockers, ["high-value-pending-action"]);
});

test("unknown eligibility and interaction escalation block stopping", () => {
  const unknown = evaluateDiscoverySaturation({
    actionResults: [
      { ...unchangedClick(), eligibility: { status: "unknown" } },
      unchangedClick(),
      unchangedClick(),
      unchangedClick(),
    ],
    capture: { captureComplete: true },
    interactionHealth: { accounting: { consistent: true } },
    interactionHealthStatus: { available: true },
    enabled: true,
    thresholds: { windowSize: 2, minimumEvidenceWindows: 2, consecutiveWindows: 2 },
  });
  assert.equal(unknown.available, true);
  assert.equal(unknown.applied, false);
  assert.deepEqual(unknown.blockers, ["unknown-eligibility"]);

  const failed = evaluateDiscoverySaturation({
    actionResults: [unchangedClick(), unchangedClick(), unchangedClick(), unchangedClick()],
    capture: { captureComplete: true },
    interactionHealth: {
      accounting: { consistent: true },
      recommendation: { recommended: true },
    },
    interactionHealthStatus: { available: true },
    enabled: true,
    thresholds: { windowSize: 2, minimumEvidenceWindows: 2, consecutiveWindows: 2 },
  });
  assert.equal(failed.reason, "interaction-failure");
  assert.deepEqual(failed.blockers, ["interaction-failure"]);
});

test("saturation output is deterministically ordered and integer-valued", () => {
  const signal = evaluateDiscoverySaturation({
    actionResults: [
      click(1, { newRequestFamilies: ["z-family", "a-family"] }),
      click(2, { newCandidateFamilies: ["z-candidate", "a-candidate"] }),
    ],
    candidateQueue: {
      candidates: [{ featureFamily: "z" }, { featureFamily: "a" }],
      scopeReviewCandidates: [],
    },
    capture: { captureComplete: true },
    interactionHealth: { accounting: { consistent: true } },
    interactionHealthStatus: { available: true },
    enabled: true,
    thresholds: { windowSize: 2, minimumEvidenceWindows: 1, consecutiveWindows: 1 },
  });
  assert.deepEqual(signal.windows[0].gain.newRequestFamilies, ["a-family", "z-family"]);
  assert.deepEqual(signal.windows[0].gain.newCandidateFamilies, ["a-candidate", "z-candidate"]);
  assert.equal(Number.isInteger(signal.windows[0].gain.total), true);
});

test("response bodies require a known bounded transfer size", () => {
  assert.equal(shouldRequestResponseBody(undefined), false);
  assert.equal(shouldRequestResponseBody(Number.NaN), false);
  assert.equal(shouldRequestResponseBody(512 * 1024), true);
  assert.equal(shouldRequestResponseBody(512 * 1024 + 1), false);
});

test("decoded response bodies are rejected above the byte limit", () => {
  assert.equal(decodeBoundedCdpBody({ body: "hello" }, 5), "hello");
  assert.equal(decodeBoundedCdpBody({ body: "hello!" }, 5), null);
  assert.equal(
    decodeBoundedCdpBody({
      base64Encoded: true,
      body: Buffer.from("hello").toString("base64"),
    }, 5),
    "hello",
  );
});

test("required action failures are surfaced deterministically", () => {
  const results = [
    {
      page: "seed",
      required: true,
      result: {
        resolvedUrl: "https://security.microsoft.com/incidents",
        url: "https://security.microsoft.com/incidents",
      },
      type: "navigate",
      value: "https://security.microsoft.com/incidents",
    },
    {
      page: "click",
      required: true,
      result: { clicked: false },
      type: "click-label",
      value: "Incidents",
    },
  ];
  assert.equal(actionResultSucceeded(results[0]), true);
  assert.deepEqual(summarizeActionResults(results), {
    requiredActionCount: 2,
    requiredActionFailureCount: 1,
    requiredActionFailures: [{
      page: "click",
      type: "click-label",
      value: "Incidents",
    }],
  });
});

test("confirmed required probes count as successful actions", () => {
  assert.equal(actionResultSucceeded({
    result: { outcome: "confirmed" },
    type: "probe-get",
  }), true);
});

test("initial navigation accepts a same-origin canonical landing route", () => {
  assert.equal(actionResultSucceeded({
    allowCanonicalRedirect: true,
    result: {
      resolvedUrl: "https://security.microsoft.com",
      url: "https://security.microsoft.com/homepage",
    },
    type: "navigate",
  }), true);
});

test("required clicks need a URL, target, or state transition", () => {
  assert.equal(actionResultSucceeded({
    result: {
      afterUrl: "https://entra.microsoft.com/#same",
      beforeUrl: "https://entra.microsoft.com/#same",
      clicked: true,
    },
    type: "click-href",
  }), false);
  assert.equal(actionResultSucceeded({
    result: {
      afterUrl: "https://entra.microsoft.com/#next",
      beforeUrl: "https://entra.microsoft.com/#same",
      clicked: true,
    },
    type: "click-href",
  }), true);
  assert.equal(actionResultSucceeded({
    result: {
      afterUrl: "https://entra.microsoft.com/#same",
      beforeUrl: "https://entra.microsoft.com/#same",
      clicked: true,
      stateTransition: true,
    },
    type: "click-href",
  }), true);
  assert.equal(actionResultSucceeded({
    result: {
      afterUrl: "https://entra.microsoft.com/#same",
      beforeUrl: "https://entra.microsoft.com/#same",
      clicked: true,
      targetTransition: true,
    },
    type: "click-href",
  }), true);
});

function clickResult({
  clicked = false,
  eligibility = "eligible",
  highValue = false,
  transitionEvidence = {},
} = {}) {
  return {
    highValue,
    result: {
      clicked,
      eligibility: {
        candidateCount: eligibility === "eligible" ? 1 : 0,
        status: eligibility,
      },
      transitionEvidence,
    },
    type: "click-label",
  };
}

test("pre-action inventories distinguish eligible controls from absent controls", () => {
  const action = { scope: "root", type: "click-label", value: "Role settings" };
  assert.deepEqual(
    deriveActionEligibility(action, [{
      controls: [{ text: "Role settings" }],
      sessionId: "root",
      targetType: "page",
      targetUrl: "https://entra.microsoft.com/",
    }]),
    {
      candidateCount: 1,
      reason: "selector-candidate-present",
      status: "eligible",
      targetFrameInventory: [{
        candidateCount: 1,
        controlCount: 1,
        sessionId: "root",
        targetType: "page",
        targetUrl: "https://entra.microsoft.com/",
      }],
    },
  );
  assert.equal(
    deriveActionEligibility(action, [{
      controls: [{ text: "Groups" }],
      sessionId: "root",
      targetType: "page",
      targetUrl: "https://entra.microsoft.com/",
    }]).status,
    "absent-not-applicable",
  );
});

test("healthy eligible misses do not escalate without transition corroboration", () => {
  const results = [
    clickResult({ clicked: true, transitionEvidence: { stateChanged: true, urlChanged: true, targetChanged: false, newRequestFamilies: ["GET /one"] } }),
    clickResult({ transitionEvidence: { stateChanged: true, urlChanged: false, targetChanged: false, newRequestFamilies: ["GET /two"] } }),
    clickResult({ clicked: true, transitionEvidence: { stateChanged: true, urlChanged: false, targetChanged: false, newRequestFamilies: ["GET /three"] } }),
    clickResult({ transitionEvidence: { stateChanged: true, urlChanged: false, targetChanged: false, newRequestFamilies: ["GET /four"] } }),
  ];
  const health = aggregateInteractionHealth(results);
  assert.equal(health.counts.eligibleAttempts, 4);
  assert.equal(health.counts.missed, 2);
  assert.equal(health.recommendation.recommended, false);
});

test("one absent control is not an eligible miss or escalation", () => {
  const health = aggregateInteractionHealth([
    clickResult({ eligibility: "absent-not-applicable" }),
  ]);
  assert.deepEqual(health.counts, {
    absentNotApplicable: 1,
    attempted: 1,
    eligibleAttempts: 0,
    eligibleMisses: 0,
    eligibleSucceeded: 0,
    highValueAttempts: 0,
    highValueMisses: 0,
    missed: 0,
    noNewRequestFamilyMisses: 0,
    noTransitionMisses: 0,
    succeeded: 0,
    unchangedStateMisses: 0,
    unknownEligibility: 0,
  });
  assert.equal(health.recommendation.recommended, false);
});

test("repeated eligible failures escalate when state and request evidence saturate", () => {
  const transitionEvidence = {
    afterStateFingerprint: "same",
    beforeStateFingerprint: "same",
    newRequestFamilies: [],
    stateChanged: false,
    targetChanged: false,
    urlChanged: false,
  };
  const health = aggregateInteractionHealth([
    clickResult({ transitionEvidence }),
    clickResult({ transitionEvidence }),
    clickResult({ transitionEvidence }),
    clickResult({ transitionEvidence }),
  ]);
  assert.equal(health.missRate, 1);
  assert.equal(health.corroboration.repeatedUnchangedState, true);
  assert.equal(health.recommendation.recommended, true);
  assert.equal(health.recommendation.code, "escalate-interaction-health");
});

test("two high-value eligible misses escalate only with corroborated saturation", () => {
  const transitionEvidence = {
    afterStateFingerprint: "same",
    beforeStateFingerprint: "same",
    newRequestFamilies: [],
    stateChanged: false,
    targetChanged: false,
    urlChanged: false,
  };
  const health = aggregateInteractionHealth([
    clickResult({ highValue: true, transitionEvidence }),
    clickResult({ highValue: true, transitionEvidence }),
  ]);
  assert.equal(health.recommendation.highValueTriggered, true);
  assert.equal(health.recommendation.recommended, true);
});

test("mismatched reported counters produce a machine-readable accounting failure", () => {
  const health = aggregateInteractionHealth(
    [clickResult({ clicked: true, transitionEvidence: { urlChanged: true } })],
    { reported: { attempted: 1, succeeded: 0, missed: 1 } },
  );
  assert.equal(health.accounting.consistent, false);
  assert.equal(health.accounting.inconsistency.code, "interaction-health-accounting-mismatch");
  assert.deepEqual(
    health.accounting.inconsistency.mismatches.map(({ field }) => field),
    ["succeeded", "missed"],
  );
});
