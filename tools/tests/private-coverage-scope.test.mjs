import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { executeCapture } from "../private-capture-job.mjs";
import { runPortfolioRefresh } from "../portal-refresh.mjs";
import { prepareCoverageReview } from "../publish-capture-coverage.mjs";
import { projectRefreshOutput, reconcilePublicCoverageSnapshot } from "../public-coverage.mjs";
import { renderPublicCoverage } from "../generate-public-coverage.mjs";

const titles = new Map([["fixture-a", "Fixture A"], ["fixture-b", "Fixture B"]]);
const measured = { currentObservations: 1, staleObservations: 0, notObserved: 0, errorObserved: 0, completeBodyObserved: 1, schemaGaps: 0, exampleGaps: 1 };
const unmeasured = { ...measured, currentObservations: 0, notObserved: 1, completeBodyObserved: 0 };
const report = () => ({
  schemaVersion: 1, mode: "report-only", asOf: "2026-12-04T10:00:00Z", freshnessDays: 30,
  blockers: [], captures: [{ specId: "fixture-a", captureId: "capture-a", captureComplete: true }],
  portfolio: {
    summary: { specCount: 2, operationCount: 2, ...measured, notObserved: 1, exampleGaps: 2 },
    specs: [
      { specId: "fixture-a", operationCount: 1, freshness: { ...measured } },
      { specId: "fixture-b", operationCount: 1, freshness: { ...unmeasured } },
    ],
  },
});
const revision = "a".repeat(40);
const prepare = input => prepareCoverageReview(Buffer.from(JSON.stringify(input)), revision, titles);

test("one capture publishes scoped, reconciled totals and leaves the other spec unassessed on the webpage", async () => {
  const input = report();
  const snapshot = prepare(input).snapshot;
  assert.deepEqual(snapshot.specs.map(row => row.specId), ["fixture-a"]);
  assert.equal(snapshot.totals.specs, 1);
  assert.equal(snapshot.totals.operations, 1);
  assert.equal(snapshot.totals.currentObservations, 1);
  assert.equal(snapshot.totals.notObserved, 0);
  assert.deepEqual(reconcilePublicCoverageSnapshot(snapshot), []);

  const oldInput = structuredClone(input);
  oldInput.asOf = "2026-11-04T10:00:00Z";
  oldInput.portfolio.specs[1].freshness = measured;
  oldInput.portfolio.summary = { ...oldInput.portfolio.summary, currentObservations: 2, notObserved: 0, completeBodyObserved: 2 };
  const old = projectRefreshOutput(oldInput, { baseRevision: revision, publicTitles: titles });
  const inventory = {
    summary: { specCount: 2, operationCount: 2, schemaGaps: 0, exampleGaps: 2 },
    specs: input.portfolio.specs.map(spec => ({ ...spec, title: titles.get(spec.specId) })),
  };
  const output = await renderPublicCoverage([old, snapshot], { inventory });
  const data = JSON.parse(output.match(/export const publicCoverage = ([\s\S]*?) as const;/u)[1]);
  assert.equal(data.latestSnapshotId, snapshot.snapshotId);
  assert.equal(data.snapshots[0].totals.specs, 1);
  assert.equal(data.specs.find(spec => spec.specId === "fixture-a").latest.currentObservations, 1);
  assert.equal(data.specs.find(spec => spec.specId === "fixture-b").latest, null);
  assert.equal(data.snapshots[1].snapshotId, old.snapshotId);
});

test("review rejects bad bindings and validates the whole portfolio before scoping", () => {
  for (const specId of [undefined, "", "unknown"]) {
    const input = report();
    input.captures[0].specId = specId;
    assert.throws(() => prepare(input), /known public specId/u);
  }
  const missingRow = report();
  missingRow.captures[0].specId = "fixture-b";
  missingRow.portfolio.specs.pop();
  missingRow.portfolio.summary = { specCount: 1, operationCount: 1, ...measured };
  assert.throws(() => prepare(missingRow), /missing from the refresh portfolio/u);
  const mismatch = report();
  mismatch.portfolio.specs[1].freshness.notObserved = 0;
  assert.throws(() => prepare(mismatch), /do not partition/u);
  const badSummary = report();
  badSummary.portfolio.summary.exampleGaps = 1;
  assert.throws(() => prepare(badSummary), /measure-mismatch/u);
  const missingMeasure = report();
  missingMeasure.portfolio.specs[1].freshness.completeBodyObserved = null;
  assert.throws(() => prepare(missingMeasure), /nonnegative integer/u);
  const incomplete = report();
  incomplete.captures[0].captureComplete = false;
  assert.throws(() => prepare(incomplete), /complete, unblocked/u);
});

test("refresh refuses missing or unknown capture bindings before inspecting artifacts", async () => {
  for (const capture of [{ artifacts: "missing" }, { specId: "unknown", artifacts: "missing" }]) {
    await assert.rejects(runPortfolioRefresh({ asOf: "2026-12-04", captures: [capture] }), /known specId/u);
  }
});

test("capture supervisor blocks an incomplete analysis even with zero blockers", async t => {
  const root = await mkdtemp(path.join(process.cwd(), ".private-coverage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const driver = path.join(root, "driver.mjs");
  await writeFile(driver, `import { mkdir, writeFile } from "node:fs/promises";
const dir = process.argv[process.argv.indexOf("--artifacts") + 1];
await mkdir(dir, { recursive: true });
await writeFile(new URL("discovery-run.json", "file:///" + dir.replaceAll("\\\\", "/") + "/"), JSON.stringify({ status: "completed" }));
`);
  const plan = { specId: "fixture-a", recipe: "tools/capture-recipes/example.json", targetId: "target", timeoutSeconds: 10 };
  for (const [complete, expected] of [[false, "blocked"], [true, "capture-completed"]]) {
    const directory = path.join(root, String(complete));
    await mkdir(directory);
    const result = await executeCapture(plan, directory, new AbortController().signal, {
      driver,
      refreshPortfolio: async () => ({ execution: { blockedCaptureCount: 0 }, report: { captures: [{ specId: plan.specId, captureComplete: complete }] } }),
    });
    assert.equal(result.status, expected);
    assert.equal(result.reason, complete ? "independent-review-required" : "capture-analysis-blocked");
  }
});
