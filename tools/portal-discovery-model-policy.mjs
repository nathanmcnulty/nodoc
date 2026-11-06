export const portalDiscoveryModelPolicy = Object.freeze({
  orchestrator: Object.freeze({
    model: "gpt-6.1-sol",
    reasoning: "medium",
  }),
  capture: Object.freeze({
    model: "gpt-6-luna",
    reasoning: "low",
  }),
  offlineReview: Object.freeze({
    allowedReasoning: Object.freeze(["xhigh", "max"]),
    model: "gpt-6-luna",
    reasoning: "xhigh",
  }),
});

export function validateOfflineReviewReasoning(reasoning) {
  if (!portalDiscoveryModelPolicy.offlineReview.allowedReasoning.includes(reasoning)) {
    throw new Error("Offline review reasoning must be xhigh or max.");
  }
  return reasoning;
}

// Retained approvals record what actually ran. Current assignment defaults are
// not an allowlist for historical evidence, nor proof of evidence quality.
export function validateReviewAttribution(approval) {
  for (const field of ["workerModel", "workerReasoning"]) {
    if (typeof approval?.[field] !== "string" || !approval[field].trim()) {
      throw new Error(`Review approval requires recorded ${field}.`);
    }
  }
  return approval;
}
