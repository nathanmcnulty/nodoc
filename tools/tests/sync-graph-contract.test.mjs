import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";

import { parseGraphContractArgs, syncGraphContracts } from "../sync-graph-contract.mjs";
import { loadGraphContractCache } from "../graph-contract-cache.mjs";

const fixtureSha = "a".repeat(40);
const sourceBody = version => `openapi: 3.0.1\ninfo: { title: ${version}, version: 1 }\npaths:\n  /users:\n    get: {}\n`;
const fixtureFetch = async url => url.includes("/commits/master")
  ? new Response(JSON.stringify({ sha: fixtureSha }), { status: 200 })
  : new Response(sourceBody(url.includes("/beta/") ? "beta" : "v1.0"), { status: 200 });

async function pinnedFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-pinned-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseline = await syncGraphContracts({ outputDir: path.join(root, "baseline"), fetchImpl: fixtureFetch });
  const pin = { repository: baseline.repository, commitSha: baseline.commitSha, manifestDigest: baseline.manifestDigest,
    sources: Object.fromEntries(baseline.contracts.map(entry => [entry.version, { sha256: entry.sha256, operationCount: entry.operationCount }])) };
  const pinnedSpec = path.join(root, "research.yml");
  const writePin = async value => writeFile(pinnedSpec, YAML.stringify({ "x-nodoc-graph-contract": value }));
  await writePin(pin);
  return { root, baseline, pin, pinnedSpec, writePin };
}

test("Graph contract sync pins one official commit and hashes both versions", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-graph-contract-"));
  const sha = "a".repeat(40);
  const fetchImpl = async (url) => {
    if (url.includes("/commits/master")) return new Response(JSON.stringify({ sha }), { status: 200 });
    const version = url.includes("/beta/") ? "beta" : "v1.0";
    return new Response(`openapi: 3.0.1\ninfo: { title: ${version}, version: 1 }\npaths:\n  /users:\n    get: {}\n`, { status: 200 });
  };
  try {
    const manifest = await syncGraphContracts({ outputDir, fetchImpl });
    assert.equal(manifest.commitSha, sha);
    assert.deepEqual(manifest.contracts.map((entry) => entry.version), ["v1.0", "beta"]);
    assert.ok(manifest.contracts.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256)));
    assert.ok(manifest.contracts.every((entry) => entry.operationCount === 1));
    assert.ok(manifest.contracts.every((entry) => /^[a-f0-9]{64}$/u.test(entry.indexSha256)));
    assert.equal(JSON.parse(await readFile(path.join(outputDir, "graph-beta-operations.json"), "utf8")).operations[0].path, "/users");
    assert.equal(JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8")).manifestDigest, manifest.manifestDigest);
    const loaded = await loadGraphContractCache(outputDir);
    assert.equal(loaded.contractSnapshot.commitSha, sha);
    assert.equal(loaded.betaContract.operations.length, 1);
    await writeFile(path.join(outputDir, "graph-beta-operations.json"), "{}\n", "utf8");
    await assert.rejects(loadGraphContractCache(outputDir), /digest mismatch/u);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("an explicit specification pin skips master and materializes the exact verified manifest", async t => {
  const { root, baseline, pinnedSpec } = await pinnedFixture(t);
  const calls = [];
  const outputDir = path.join(root, "pinned");
  const manifest = await syncGraphContracts({ outputDir, pinnedSpec, fetchImpl: async url => { calls.push(url); return fixtureFetch(url); } });
  assert.deepEqual(manifest, baseline);
  assert.deepEqual(calls, ["v1.0", "beta"].map(version => `https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/${fixtureSha}/openapi/${version}/openapi.yaml`));
  const verified = await loadGraphContractCache(outputDir);
  assert.equal(verified.contractSnapshot.manifestDigest, baseline.manifestDigest);
});

test("invalid pin metadata fails before any fetch or output materialization", async t => {
  const { root, pin, pinnedSpec, writePin } = await pinnedFixture(t);
  const cases = [
    [{ ...pin, repository: "other/repository" }, /repository is invalid/u],
    [{ ...pin, commitSha: "master" }, /exact lowercase SHA/u],
    [{ ...pin, manifestDigest: "not-a-digest" }, /manifest digest is invalid/u],
    [{ ...pin, sources: { beta: pin.sources.beta } }, /exactly beta and v1.0/u],
    [{ ...pin, sources: { ...pin.sources, beta: { ...pin.sources.beta, sha256: "invalid" } } }, /source hash or operation count is invalid/u],
    [{ ...pin, sources: { ...pin.sources, beta: { ...pin.sources.beta, operationCount: "1" } } }, /source hash or operation count is invalid/u],
  ];
  for (const [index, [invalid, expected]] of cases.entries()) {
    await writePin(invalid);
    let fetched = false;
    const outputDir = path.join(root, `invalid-${index}`);
    await assert.rejects(syncGraphContracts({ outputDir, pinnedSpec, fetchImpl: async () => { fetched = true; throw new Error("Fetch must not run."); } }), expected);
    assert.equal(fetched, false);
    await assert.rejects(readFile(path.join(outputDir, "manifest.json")), { code: "ENOENT" });
  }
});

test("pinned source bytes, operation counts and generated manifest must all match before publication", async t => {
  const { root, pin, pinnedSpec, writePin } = await pinnedFixture(t);
  const cases = [
    ["source", { ...pin, sources: { ...pin.sources, beta: { ...pin.sources.beta, sha256: "b".repeat(64) } } }, /source digest mismatch/u],
    ["count", { ...pin, sources: { ...pin.sources, beta: { ...pin.sources.beta, operationCount: 2 } } }, /operation count mismatch/u],
    ["manifest", { ...pin, manifestDigest: "b".repeat(64) }, /generated manifest digest mismatch/u],
  ];
  for (const [name, invalid, expected] of cases) {
    await writePin(invalid);
    const outputDir = path.join(root, name);
    await assert.rejects(syncGraphContracts({ outputDir, pinnedSpec, fetchImpl: fixtureFetch }), expected);
    await assert.rejects(readFile(path.join(outputDir, "graph-v1.0-openapi.yaml")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(outputDir, "manifest.json")), { code: "ENOENT" });
  }
  await writePin(pin);
  const alteredDir = path.join(root, "altered-source");
  await assert.rejects(syncGraphContracts({ outputDir: alteredDir, pinnedSpec,
    fetchImpl: async url => new Response(sourceBody(url.includes("/beta/") ? "beta" : "v1.0") + "# altered bytes\n", { status: 200 }) }), /source digest mismatch/u);
  await assert.rejects(readFile(path.join(alteredDir, "manifest.json")), { code: "ENOENT" });
});

test("explicit commit mode skips lookup and rejects a conflicting specification pin", async t => {
  const { root, baseline, pinnedSpec } = await pinnedFixture(t);
  const calls = [];
  const manifest = await syncGraphContracts({ outputDir: path.join(root, "explicit"), commitSha: fixtureSha,
    fetchImpl: async url => { calls.push(url); return fixtureFetch(url); } });
  assert.deepEqual(manifest, baseline);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(url => url.includes("/commits/")), false);
  await assert.rejects(syncGraphContracts({ outputDir: path.join(root, "conflict"), commitSha: "b".repeat(40), pinnedSpec, fetchImpl: fixtureFetch }), /does not match/u);
  await assert.rejects(syncGraphContracts({ outputDir: path.join(root, "branch"), commitSha: "master", fetchImpl: fixtureFetch }), /exact lowercase SHA/u);
});

test("sync CLI keeps latest mode and parses exact pin arguments without silently accepting unknown options", () => {
  assert.deepEqual(parseGraphContractArgs(["--output-dir", "cache"]), { outputDir: "cache" });
  assert.deepEqual(parseGraphContractArgs(["--pinned-spec", "research.yml", "--output-dir", "cache"]), { pinnedSpec: "research.yml", outputDir: "cache" });
  assert.deepEqual(parseGraphContractArgs(["--output-dir", "cache", "--commit", fixtureSha]), { outputDir: "cache", commitSha: fixtureSha });
  for (const args of [["--output-dir"], ["--unknown", "cache"], ["--output-dir", "cache", "constructor", "unknown"], ["--output-dir", "one", "--output-dir", "two"], ["--pinned-spec", "research.yml"]]) assert.throws(() => parseGraphContractArgs(args), /Use --output-dir/u);
});
