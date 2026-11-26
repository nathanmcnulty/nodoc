import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { measurePrivateStorage } from "../measure-private-storage.mjs";

const cli = fileURLToPath(new URL("../measure-private-storage.mjs", import.meta.url));

test("offline sizing counts unique encoded payloads, distinct manifests and attempted puts without modifying inputs", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-sizing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = path.join(root, "first"), second = path.join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  const small = Buffer.from([1, 2, 3]);
  await Promise.all([
    writeFile(path.join(first, "one"), small), writeFile(path.join(first, "two"), small),
    writeFile(path.join(second, "four"), small), writeFile(path.join(second, "empty"), ""),
  ]);
  const report = await measurePrivateStorage([first, second], 0.02);
  assert.equal(report.snapshots, 2);
  assert.equal(report.sourceFiles, 4);
  assert.equal(report.sourceBytes, 9);
  assert.equal(report.payloadBytes, 3);
  assert.equal(report.uniqueBlobs, 4); // two payloads, two manifests
  assert.ok(report.manifestBytes > 0);
  assert.equal(report.retainedBytes, report.manifestBytes + 3);
  assert.equal(report.estimatedCapacityUsdPerMonth, report.retainedBytes / 2 ** 30 * 0.02);
  assert.ok(report.archivePutCalls >= report.uniqueBlobs);
  assert.deepEqual((await readdir(first)).sort(), ["one", "two"]);
  assert.deepEqual((await readdir(root)).sort(), ["first", "second"]);
});

test("CLI omits pricing without a supplied rate and never prints capture paths or values", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-private-marker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "private-file-marker"), "private-value-marker");
  const run = (...args) => spawnSync(process.execPath, [cli, "--directory", root, ...args], { encoding: "utf8" });
  const success = run();
  assert.equal(success.status, 0);
  const report = JSON.parse(success.stdout);
  assert.equal(report.sourceFiles, 1);
  assert.equal("estimatedCapacityUsdPerMonth" in report, false);
  assert.doesNotMatch(success.stdout + success.stderr, /marker|[a-f0-9]{64}/u);
  for (const rate of ["", "Infinity", "-1", "unknown"]) assert.notEqual(run("--usd-per-gib-month", rate).status, 0);
  const failure = run("--directory", path.join(root, "absent-private-marker"));
  assert.notEqual(failure.status, 0);
  assert.equal(failure.stdout, "");
  assert.doesNotMatch(failure.stderr, /marker/u);
});
