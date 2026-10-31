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
