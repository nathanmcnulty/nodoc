import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildCaptureWorkerPacket } from "../run-portal-discovery.mjs";
import { repoRoot } from "../spec-quality-lib.mjs";

const execute = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-driver-readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recipePath = path.join(root, "recipe.json");
  await writeFile(recipePath, "{}\n");
  return { root, recipePath, actionBudget: {}, args: { variables: [], cdpEndpoint: "http://127.0.0.1:9222", operationCeiling: "observe-only" },
    brief: { specId: "synthetic", recipe: "recipe.json", allowedEvidence: [], pathPrefixes: [], portal: "synthetic", serverUrls: [], specPath: "synthetic.yml" } };
}

test("default SPA packet endpoint is an origin key while native UI URLs remain intact", async t => {
  const input = await fixture(t);
  input.brief.portalUrl = "https://admin.example.test/#/groups";
  const packet = await buildCaptureWorkerPacket(input);
  for (const argv of [packet.execution.driverArgs, packet.execution.verificationArgs]) {
    assert.equal(argv[argv.indexOf("--endpoint") + 1], "admin.example.test:443");
  }
  assert.equal(packet.scope.portalUrl, input.brief.portalUrl);
});

test("known refresh ledger default follows the actual proxy caller, not canonical spec portal", async t => {
  const input = await fixture(t);
  input.brief.portalUrl = "https://canonical.example.test/#/settings";
  input.knownOperationRefreshPlan = { entryUrl: "https://caller.example.test:8443/home?tid=synthetic" };
  const packet = await buildCaptureWorkerPacket(input);
  for (const argv of [packet.execution.driverArgs, packet.execution.verificationArgs]) {
    assert.equal(argv[argv.indexOf("--endpoint") + 1], "caller.example.test:8443");
    assert.ok(!argv.some(value => value.includes("tid=")));
  }
  assert.equal(input.knownOperationRefreshPlan.entryUrl, "https://caller.example.test:8443/home?tid=synthetic");
});

test("explicit endpoint paths, fragments, queries and credentials cannot produce a dispatch packet", async t => {
  const input = await fixture(t);
  for (const endpoint of ["https://admin.example.test/#/groups", "https://admin.example.test/home", "https://admin.example.test/?tid=synthetic", "https://user:secret@admin.example.test"]) {
    await assert.rejects(buildCaptureWorkerPacket({ ...input, args: { ...input.args, endpoint } }), /only an HTTP\(S\) origin/);
  }
});

test("public planning rejects an invalid ledger endpoint before reporting capture readiness", async t => {
  const { root } = await fixture(t);
  const artifacts = path.join(root, "blocked-plan"), ledger = path.join(root, "ledger.jsonl");
  await assert.rejects(execute(process.execPath, [path.join(repoRoot, "tools/run-portal-discovery.mjs"),
    "--portal", "m365-admin", "--recipe", "tools/capture-recipes/m365-admin-deep.json", "--phase", "plan", "--json",
    "--endpoint", "https://admin.cloud.microsoft/#/groups", "--artifacts", artifacts, "--ledger-path", ledger], { cwd: repoRoot }), error => {
    const result = JSON.parse(error.stderr);
    assert.equal(error.code, 2);
    assert.equal(result.status, "blocked");
    assert.equal(result.blocker.code, "endpoint-invalid");
    assert.match(result.blocker.detail, /only an HTTP\(S\) origin/);
    assert.equal(result.workerPacket, undefined);
    return true;
  });
  await assert.rejects(readFile(ledger), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(artifacts, "capture/summary.json")), { code: "ENOENT" });
});
