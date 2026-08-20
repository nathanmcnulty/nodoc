import assert from "node:assert/strict";
import test from "node:test";
import { loadBenchmarkCorpus, runOfflineBenchmark } from "../portal-discovery-benchmark.mjs";
import { calculateUnresolvedFrontier, compileOfflineFrontier, scheduleFrontier, validateFrontier, validateOfflineFrontier } from "../portal-discovery-frontier.mjs";
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

test("offline frontier compiler never authorizes capture without an exact approved UI state", () => {
  const specification = { servers: [{ url: "https://api.example.test" }], paths: { "/items": { get: { responses: { 200: { description: "ok" } } } } } };
  const blocked = compileOfflineFrontier({ specId: "alpha", specification, coverage: {}, recipe: {} });
  validateOfflineFrontier(blocked);
  assert.equal(blocked.terminal, "blocked-no-exact-frontier");
  assert.equal(blocked.items[0].status, "candidate");

  const recipe = {
    url: "https://portal.example.test",
    actions: ["navigate=https://portal.example.test/items", "capture=items"],
    noveltyFrontier: {
      approvalDigest: "d".repeat(64),
      baselineSignals: { queryMetadata: [], requestShapes: [], responseMetadata: [], responseShapes: [], routes: [] },
      reopenCondition: "The items view has an undocumented response shape.",
      targets: [{ acceptanceKey: "items-shape", actionIndexes: [0, 1], evidenceLevel: "confirmed", expectedHostFamilies: ["api.example.test"], expectedInformationClasses: ["response-shape"], expectedRoutePrefixes: ["/items"], id: "items-shape", rationale: "Schema is opaque.", safeAction: "Open the read-only items view.", state: "Items" }],
    },
  };
  const approved = compileOfflineFrontier({ specId: "alpha", specification, coverage: {}, recipe });
  assert.equal(approved.terminal, "capture-authorized");
  assert.equal(approved.items[0].requiredActionState.targetId, "items-shape");

  const ownershipBlocked = compileOfflineFrontier({ specId: "alpha", specification: { paths: {} }, recipe, candidateHandoff: { adjacentConfirmedReadCandidates: [{ hostFamily: "other.example", method: "GET", normalizedPath: "/items", evidenceIds: ["evidence-1"] }] } });
  assert.equal(ownershipBlocked.terminal, "blocked-adjacent-ownership");
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
