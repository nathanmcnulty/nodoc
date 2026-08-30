import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { repoRoot } from "../spec-quality-lib.mjs";

const execFileAsync = promisify(execFile);

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
