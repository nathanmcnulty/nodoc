import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncGraphContracts } from "../sync-graph-contract.mjs";
import { loadGraphContractCache } from "../graph-contract-cache.mjs";

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
