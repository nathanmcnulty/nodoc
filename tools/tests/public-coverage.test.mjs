import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runPortfolioRefresh } from "../portal-refresh.mjs";
import { buildSpecInventory } from "../spec-quality-lib.mjs";
import {
  assertPublicCoverageSnapshot, loadPublicCoverageSnapshots, projectRefreshOutput, reconcilePublicCoverageSnapshot,
} from "../public-coverage.mjs";

const freshness = (overrides = {}) => ({
  currentObservations: 2, staleObservations: 1, notObserved: 1, errorObserved: 1, schemaGaps: 3, exampleGaps: 4,
  historicalCaptureAnnotations: 2, completeBodyObserved: 2, wholeSpecCurrent: false, reason: "private", ...overrides,
});
const inventory = () => ({
  schemaVersion: 1, asOf: "2026-12-04T10:00:00.000Z", freshnessDays: 30,
  summary: { specCount: 2, operationCount: 8, ...freshness({ currentObservations: 4, staleObservations: 2, notObserved: 2, errorObserved: 2, schemaGaps: 6, exampleGaps: 8, completeBodyObserved: 4 }), recipeCount: 3 },
  specs: [
    { specId: "zeta", title: "Zeta Portal", specPath: "C:/private/zeta.yaml", operationCount: 4, freshness: freshness(), operations: [{ path: "/secret" }] },
    { specId: "alpha", title: "Alpha Portal", specPath: "C:/private/alpha.yaml", operationCount: 4, freshness: freshness(), operations: [{ path: "/secret" }] },
  ],
});
const report = () => {
  const { summary, specs } = inventory();
  return { schemaVersion: 1, asOf: "2026-12-04T10:00:00.000Z", portfolio: { summary, specs: specs.map(({ operations, ...spec }) => spec) } };
};
const options = { baseRevision: "abc1234" };
const clone = value => structuredClone(value);
const reconciled = () => projectRefreshOutput(inventory(), options);

test("the published November snapshot reconciles against current spec ids", async () => {
  const knownSpecIds = new Set((await buildSpecInventory()).map(spec => spec.specId));
  const snapshots = await loadPublicCoverageSnapshots();
  const november = snapshots.find(snapshot => snapshot.snapshotId === "2026-11-06");
  assert.ok(november);
  assert.deepEqual(reconcilePublicCoverageSnapshot(november, { knownSpecIds }), []);
  assert.equal(november.totals.operations, 2027);
  assert.equal(november.totals.currentObservations, 245);
  assert.equal(november.totals.completeBodyObserved, 184);
  assert.ok(november.specs.every(spec => spec.completeBodyObserved === null));
});

test("inventory projection copies only allowlisted aggregate counts", () => {
  const snapshot = reconciled();
  assert.equal(snapshot.snapshotId, "2026-12-04");
  assert.equal(snapshot.windowDays, 30);
  assert.deepEqual(snapshot.specs.map(spec => spec.specId), ["alpha", "zeta"]);
  assert.equal(snapshot.specs[0].latestErrorObserved, 1);
  assert.equal(snapshot.totals.latestErrorObserved, 2);
  const serialized = JSON.stringify(snapshot);
  for (const leaked of ["/secret", "C:/private", "specPath", "historicalCaptureAnnotations", "wholeSpecCurrent", "recipeCount", "errorObserved\""]) {
    assert.equal(serialized.includes(leaked), false, `${leaked} leaked into the public snapshot`);
  }
});

test("legacy reports require an explicit window; new reports preserve the inventory window", () => {
  assert.throws(() => projectRefreshOutput(report(), options), /window-days/u);
  assert.deepEqual(projectRefreshOutput(report(), { ...options, windowDays: 30 }), reconciled());
  assert.deepEqual(projectRefreshOutput({ ...report(), freshnessDays: 30 }, options), reconciled());
});

test("a report from the refresh controller projects with its actual non-default window", async () => {
  const asOf = "2026-11-06";
  const { report } = await runPortfolioRefresh({ captures: [], asOf, freshnessDays: 14 });
  const snapshot = projectRefreshOutput(report, options);
  assert.equal(snapshot.assessedAt, asOf);
  assert.equal(snapshot.windowDays, 14);
  assert.equal(snapshot.totals.currentObservations, 0);
});

test("a later monthly run cannot relabel the assessment date or freshness window", () => {
  for (const input of [inventory(), { ...report(), freshnessDays: 30 }]) {
    assert.deepEqual(projectRefreshOutput(input, { ...options, assessedAt: input.asOf, windowDays: 30 }), reconciled());
    assert.throws(() => projectRefreshOutput(input, { ...options, assessedAt: "2027-01-01" }), /must match the input asOf/u);
    assert.throws(() => projectRefreshOutput(input, { ...options, windowDays: 90 }), /must match the input freshnessDays/u);
    delete input.asOf;
    assert.throws(() => projectRefreshOutput(input, { ...options, assessedAt: "2027-01-01" }), /original asOf/u);
  }
  const incomplete = inventory();
  delete incomplete.freshnessDays;
  assert.throws(() => projectRefreshOutput(incomplete, { ...options, windowDays: 30 }), /missing freshnessDays/u);
});

test("projection never turns a missing measure into zero", () => {
  const input = inventory();
  delete input.specs[1].freshness.completeBodyObserved;
  assert.throws(() => projectRefreshOutput(input, options), /specs\[1\]\.freshness lacks completeBodyObserved/u);
  const summaryless = inventory();
  delete summaryless.summary.errorObserved;
  assert.throws(() => projectRefreshOutput(summaryless, options), /summary lacks errorObserved/u);
});

test("projection rejects unknown spec ids and unsupported inputs", () => {
  assert.throws(() => projectRefreshOutput(inventory(), { ...options, knownSpecIds: new Set(["alpha"]) }), /unknown specId zeta/u);
  assert.throws(() => projectRefreshOutput({ schemaVersion: 2 }, options), /schemaVersion 1/u);
  assert.throws(() => projectRefreshOutput({ schemaVersion: 1, specs: [] }, options), /independent summary/u);
  assert.throws(() => projectRefreshOutput(inventory(), { baseRevision: "not-a-sha" }), /baseRevision/u);
});

test("reconciliation reports each class of mismatch", () => {
  const cases = [
    [snapshot => { snapshot.totals.specs = 3; }, /spec-count-mismatch/u],
    [snapshot => { snapshot.totals.operations = 9; snapshot.totals.notObserved = 3; }, /operation-count-mismatch/u],
    [snapshot => { snapshot.totals.exampleGaps = 7; }, /measure-mismatch: exampleGaps/u],
    [snapshot => { snapshot.specs = []; }, /missing-rows/u],
    [snapshot => { delete snapshot.totals; }, /missing-baseline/u],
    [snapshot => { snapshot.specs[0].notObserved = 2; }, /do not partition/u],
    [snapshot => { snapshot.specs[0].latestErrorObserved = 4; }, /latest errors exceed/u],
    [snapshot => { snapshot.specs[0].completeBodyObserved = 4; }, /complete bodies exceed/u],
    [snapshot => { snapshot.specs[0].schemaGaps = 5; }, /schemaGaps exceeds operations/u],
    [snapshot => { snapshot.specs[1].specId = "alpha"; }, /duplicate specId/u],
    [snapshot => { snapshot.snapshotId = "2026-12-05"; }, /snapshotId must equal/u],
    [snapshot => { snapshot.assessedAt = "2026-02-30"; }, /assessedAt/u],
    [snapshot => { snapshot.source.report = "../outside.md"; }, /repository-relative/u],
  ];
  for (const [mutate, expected] of cases) {
    const snapshot = clone(reconciled());
    mutate(snapshot);
    const problems = reconcilePublicCoverageSnapshot(snapshot);
    assert.ok(problems.some(problem => expected.test(problem)), `${expected} not reported: ${problems.join("; ")}`);
  }
});

test("reconciliation rejects leaked fields at every level", () => {
  for (const mutate of [
    snapshot => { snapshot.routes = ["/secret"]; },
    snapshot => { snapshot.source.capturePath = "C:/private/capture.har"; },
    snapshot => { snapshot.totals.recipeCount = 3; },
    snapshot => { snapshot.specs[0].operationsList = [{ path: "/secret", body: "{}" }]; },
  ]) {
    const snapshot = clone(reconciled());
    mutate(snapshot);
    assert.ok(reconcilePublicCoverageSnapshot(snapshot).some(problem => problem.includes("unexpected field")));
  }
});

test("only per-spec complete bodies may be unknown, and unknown rows skip that sum", () => {
  const snapshot = clone(reconciled());
  for (const spec of snapshot.specs) spec.completeBodyObserved = null;
  snapshot.totals.completeBodyObserved = 5;
  assert.deepEqual(reconcilePublicCoverageSnapshot(snapshot), []);
  snapshot.totals.completeBodyObserved = null;
  assert.ok(reconcilePublicCoverageSnapshot(snapshot).some(problem => problem.startsWith("totals: completeBodyObserved")));
  const unknownGap = clone(reconciled());
  unknownGap.specs[0].schemaGaps = null;
  assert.ok(reconcilePublicCoverageSnapshot(unknownGap).some(problem => problem.includes("schemaGaps must be a nonnegative integer")));
});

test("snapshot files must be named for their snapshot id", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-coverage-"));
  try {
    await writeFile(path.join(directory, "2026-12-05.json"), JSON.stringify(reconciled()));
    await assert.rejects(loadPublicCoverageSnapshots(directory), /file name must match snapshotId/u);
    await rm(path.join(directory, "2026-12-05.json"));
    await writeFile(path.join(directory, "2026-12-04.json"), JSON.stringify(reconciled()));
    const [snapshot] = await loadPublicCoverageSnapshots(directory);
    assert.equal(assertPublicCoverageSnapshot(snapshot), snapshot);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
