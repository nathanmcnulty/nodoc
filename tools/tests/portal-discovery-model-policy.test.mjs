import assert from "node:assert/strict";
import test from "node:test";
import { portalDiscoveryModelPolicy, validateOfflineReviewReasoning, validateReviewAttribution } from "../portal-discovery-model-policy.mjs";

test("retained approval attribution is independent of current assignment defaults", () => {
  for (const workerModel of ["gpt-5.6-luna", "future-review-model"]) {
    const approval = { workerModel, workerReasoning: "adaptive" };
    assert.equal(validateReviewAttribution(approval), approval);
  }
  for (const field of ["workerModel", "workerReasoning"]) {
    for (const value of [undefined, null, "", "  ", 1, {}]) {
      assert.throws(() => validateReviewAttribution({ workerModel: "recorded-model", workerReasoning: "recorded-effort", [field]: value }), new RegExp(field));
    }
  }
});

test("new offline assignments still follow the central reasoning policy", () => {
  for (const effort of portalDiscoveryModelPolicy.offlineReview.allowedReasoning) {
    assert.equal(validateOfflineReviewReasoning(effort), effort);
  }
  assert.throws(() => validateOfflineReviewReasoning("unknown-effort"));
});
