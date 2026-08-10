import assert from "node:assert/strict";
import test from "node:test";
import { loadBenchmarkCorpus, runOfflineBenchmark } from "../portal-discovery-benchmark.mjs";
import { calculateUnresolvedFrontier, scheduleFrontier, validateFrontier } from "../portal-discovery-frontier.mjs";
import { compileIntegratedController, transitionControllerState } from "../portal-discovery-controller.mjs";
import { buildPortfolioManifest } from "../portal-discovery-control-plane.mjs";

test("offline benchmark corpus is sanitized and stable", async () => {
  const corpus = await loadBenchmarkCorpus();
  const first = runOfflineBenchmark(corpus);
  assert.deepEqual(first, runOfflineBenchmark(corpus));
  assert.equal(first.measurements.failCount, 0);
  assert.ok(first.measurements.inputBytes > 0);
  assert.doesNotMatch(JSON.stringify(corpus), /tenant|bearer|cookie|https?:\/\//iu);
});

test("frontier covers classes, preserves IDs, and respects deterministic budgets", () => {
  const frontier = calculateUnresolvedFrontier({
    discovery: {
      unvisitedStates: ["state-a"], eligibleButUnattempted: ["control-a"], failedTransitions: ["transition-a"],
      bundleOnlyFamilies: ["family-a"], missingSchemaShapes: ["shape-a"], unassignedAdjacent: ["host-a"],
      specEvidenceGaps: ["gap-a"], safetyOwnershipSchemaConflicts: ["conflict-a"],
      health: { complete: false, available: true, accountingConsistent: true },
    },
    benchmark: { regressions: ["scenario-a"] },
  });
  validateFrontier(frontier);
  assert.equal(frontier.items.length, 10);
  const schedule = scheduleFrontier(frontier, { budgets: { maxActions: 2 } });
  assert.equal(schedule.selected.length, 2);
  assert.deepEqual(schedule, scheduleFrontier(frontier, { budgets: { maxActions: 2 } }));
});

test("controller is report-only, idempotent, and blocks unresolved frontier", async () => {
  const manifest = await buildPortfolioManifest();
  const benchmarkCorpus = await loadBenchmarkCorpus();
  const input = { manifest, benchmarkCorpus, discovery: { health: { complete: true, available: true, accountingConsistent: true }, saturation: "unknown", unvisitedStates: ["state-a"] }, options: {}, budgets: {} };
  const first = compileIntegratedController(input);
  const second = compileIntegratedController(input);
  assert.deepEqual(first, second);
  assert.equal(first.mode, "report-only");
  assert.equal(first.state, "capture-recommended");
  assert.equal(first.execution.preflight.apply, false);
});

test("controller state transitions fail closed", () => {
  assert.deepEqual(transitionControllerState("planned", "offline-ready", "offline-analysis-ready"), { state: "offline-ready", reasonCode: "offline-analysis-ready" });
  assert.throws(() => transitionControllerState("planned", "merged", "offline-analysis-ready"), /Invalid controller state/);
});
