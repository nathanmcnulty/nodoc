import assert from "node:assert/strict";
import test from "node:test";

import { baselineApprovalDigest, baselineSourceArtifactDigest, compileBaselineSync, validateBaselineSync } from "../portal-discovery-baseline-sync.mjs";

const sourceArtifact = { schemaVersion: 1, evidenceIndex: ["evidence-1"] };
const sourceArtifactDigest = baselineSourceArtifactDigest(sourceArtifact);
const recipe = {
  noveltyFrontier: {
    baselineSignals: { queryMetadata: [], requestShapes: [], responseMetadata: [], responseShapes: ["existing"], routes: [] },
  },
};

function approval(overrides = {}) {
  const core = {
    schemaVersion: 1,
    specId: "alpha",
    canonicalSignal: "api.example GET /items shape-a",
    signalClass: "response-shape",
    evidenceIds: ["evidence-1"],
    workerModel: "gpt-5.6-luna",
    workerReasoning: "xhigh",
    decision: "accept",
    sourceArtifactDigest,
    health: { complete: true, available: true, accountingConsistent: true },
    approvedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
  return { ...core, approvalDigest: baselineApprovalDigest(core) };
}

test("Luna-approved signals append idempotently with immutable provenance", () => {
  const first = compileBaselineSync({ specId: "alpha", recipe, approvals: [approval()], sourceArtifact });
  const second = compileBaselineSync({ specId: "alpha", recipe: first.updatedRecipe, approvals: [approval()], sourceArtifact });
  validateBaselineSync(first);
  assert.deepEqual(first.updatedRecipe.noveltyFrontier.baselineSignals.responseShapes, ["api.example GET /items shape-a", "existing"]);
  assert.deepEqual(second.updatedRecipe, first.updatedRecipe);
  assert.equal(second.addedSignals.length, 0);
});

test("baseline sync rejects wrong model, stale evidence, scope drift, and incomplete health", () => {
  for (const invalid of [
    approval({ workerModel: "gpt-5.6-terra" }),
    approval({ workerReasoning: "high" }),
    approval({ sourceArtifactDigest: "2".repeat(64) }),
    approval({ specId: "beta" }),
    approval({ health: { complete: false, available: true, accountingConsistent: true } }),
    approval({ evidenceIds: ["missing-evidence"] }),
  ]) assert.throws(() => compileBaselineSync({ specId: "alpha", recipe, approvals: [invalid], sourceArtifact }));
});
