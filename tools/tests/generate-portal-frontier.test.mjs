import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { repoRoot } from "../spec-quality-lib.mjs";
import { loadBenchmarkCorpus, runOfflineBenchmark } from "../portal-discovery-benchmark.mjs";
import { validateFrontier } from "../portal-discovery-frontier.mjs";

const execFileAsync = promisify(execFile);

test("scorecard mode generates actionable deterministic benchmark frontier items", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-benchmark-frontier-"));
  try {
    const benchmark = runOfflineBenchmark(await loadBenchmarkCorpus(), { mode: "measured" });
    const file = path.join(dir, "scorecard.json");
    await writeFile(file, JSON.stringify(benchmark));
    const command = [path.join(repoRoot, "tools", "generate-portal-frontier.mjs"), "--benchmark-scorecard", file];
    const { stdout } = await execFileAsync(process.execPath, command, { cwd: repoRoot });
    const result = JSON.parse(stdout);
    validateFrontier(result);
    assert.equal((await execFileAsync(process.execPath, command, { cwd: repoRoot })).stdout, stdout);
    assert.equal(result.items.filter((item) => item.class === "incomplete-health").length, 1);
    const items = result.items.filter((item) => item.class === "benchmark-regression");
    assert.equal(items.length, benchmark.regressions.length);
    for (const regression of benchmark.regressions) {
      const item = items.find((entry) => entry.subject === regression.scenarioId);
      assert.deepEqual(item.metadata.benchmarkRegression, regression);
      assert.deepEqual(item.sourceRefs, [benchmark.benchmarkId]);
    }
    await assert.rejects(execFileAsync(process.execPath, [...command, "--spec", "exchange-beta"], { cwd: repoRoot }), /cannot be combined/u);
    benchmark.regressions.pop();
    await writeFile(file, JSON.stringify(benchmark));
    await assert.rejects(execFileAsync(process.execPath, command, { cwd: repoRoot }), /digest or schema mismatch/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approved-only frontier output retains full-set identity without unrelated candidates", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repoRoot, "tools", "generate-portal-frontier.mjs"),
    "--spec",
    "exchange-beta",
    "--recipe",
    "tools/capture-recipes/exchange-bootstrap-shape-novelty.json",
    "--approved-only",
  ], { cwd: repoRoot });
  const projection = JSON.parse(stdout);
  assert.equal(projection.projection, "approved-only");
  assert.match(projection.frontierSetDigest, /^[a-f0-9]{64}$/u);
  assert.equal(projection.measurements.itemCount > projection.items.length, true);
  assert.equal(projection.items.length, projection.measurements.approvedCount);
  assert.equal(projection.items.every((item) => item.status === "approved"), true);
});

test("selected-item frontier output is compact and preserves full-set identity", async () => {
  const command = path.join(repoRoot, "tools", "generate-portal-frontier.mjs");
  const common = [command, "--spec", "exchange-beta", "--recipe", "tools/capture-recipes/exchange-bootstrap-shape-novelty.json"];
  const { stdout: fullStdout } = await execFileAsync(process.execPath, common, { cwd: repoRoot });
  const full = JSON.parse(fullStdout);
  const selectedId = full.items[0].frontierId;
  const { stdout } = await execFileAsync(process.execPath, [...common, "--frontier-id", selectedId], { cwd: repoRoot });
  const projection = JSON.parse(stdout);
  assert.equal(projection.projection, "selected-item");
  assert.equal(projection.frontierSetDigest, full.frontierSetDigest);
  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].frontierId, selectedId);
  assert.equal(Buffer.byteLength(stdout) < Buffer.byteLength(fullStdout) / 10, true);

  await assert.rejects(
    execFileAsync(process.execPath, [...common, "--frontier-id", "offline-frontier-missing"], { cwd: repoRoot }),
    /was not found exactly once/u,
  );
});
