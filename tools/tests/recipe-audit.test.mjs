import assert from "node:assert/strict";
import test from "node:test";

import { buildEvaluationStatus } from "../generate-recipe-audit.mjs";

const status = (overrides = {}) => buildEvaluationStatus({
  blockedPrerequisiteCount: 0,
  derivedResearchSurface: false,
  noveltyTargetCount: 0,
  satisfiedNoveltyCount: 0,
  ...overrides,
});

test("recipe evaluation status fails open frontiers ahead of terminal sibling recipes", () => {
  assert.equal(status({ noveltyTargetCount: 1, satisfiedNoveltyCount: 1 }), "active-frontier");
  assert.equal(status({ blockedPrerequisiteCount: 1, satisfiedNoveltyCount: 1 }), "blocked-prerequisite");
  assert.equal(status({
    blockedPrerequisiteCount: 1,
    noveltyTargetCount: 1,
    satisfiedNoveltyCount: 1,
  }), "active-frontier");
});

test("recipe evaluation status preserves independent evidence gaps for terminal novelty", () => {
  assert.equal(status({ satisfiedNoveltyCount: 1 }), "evaluated-with-gaps");
  assert.equal(status({ blockedPrerequisiteCount: 1 }), "blocked-prerequisite");
  assert.equal(status({ derivedResearchSurface: true }), "derived-current");
  assert.equal(status(), "needs-frontier");
});

test("known refresh declaration stays pending while novelty remains active", () => {
  assert.equal(status({ knownOperationRefreshCount: 1 }), "refresh-contract-present");
  assert.equal(status({ knownOperationRefreshCount: 1, noveltyTargetCount: 1 }), "active-frontier");
});

test("blocked prerequisites lead recommendations even when a novelty target exists", async () => {
  const { buildRecommendedNext } = await import("../generate-recipe-audit.mjs");
  assert.equal(buildRecommendedNext({ recipeCount: 1, blockedPrerequisiteCount: 1, noveltyTargetCount: 1 }, "MTO", 10), "blocked-prerequisite-await-new-approved-frontier");
});

test("strict JSON audit matches pending disposition status and preserves blocked display", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(new URL("../generate-recipe-audit.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [script, "--json", "--require-evaluated"], { encoding: "utf8" });
  const rows = JSON.parse(run.stdout);
  const pendingCount = rows.filter(row => ["active-frontier", "needs-frontier", "refresh-contract-present", "freshness-gap"].includes(row.evaluationStatus)).length;
  assert.equal(run.status, pendingCount > 0 ? 1 : 0);
  assert.ok(rows.some(row => row.evaluationStatus === "evaluated-with-gaps"));
  assert.ok(rows.every(row => !row.missingAxes.includes("iframe") && !row.missingAxes.includes("seeded-replay")));
  assert.ok(rows.every(row => row.scoreMeaning === "recipe-capability-inventory-not-api-execution-coverage"));
  const mto = rows.find(row => row.title === "Defender XDR (MTO)");
  assert.equal(mto.evaluationStatus, "blocked-prerequisite");
  assert.equal(mto.recommendedNext, "blocked-prerequisite-await-new-approved-frontier");
  const text = spawnSync(process.execPath, [script, "--require-evaluated"], { encoding: "utf8" });
  assert.equal(text.status, run.status);
  const pending = text.stdout.split("\n").find(line => line.startsWith("Specifications awaiting evaluation"));
  assert.ok(pending);
  assert.doesNotMatch(pending, /Defender XDR \(MTO\)/);
});

test("reviewed siblings do not cover missing or changed refresh evaluations", () => {
  assert.equal(status({ knownOperationRefreshCount: 2, reviewedRefreshCount: 1 }), "refresh-contract-present");
  assert.equal(status({ knownOperationRefreshCount: 2, reviewedRefreshCount: 2 }), "evaluated-with-gaps");
  assert.equal(status({ knownOperationRefreshCount: 2, reviewedRefreshCount: 2, noveltyTargetCount: 1 }), "active-frontier");
});
