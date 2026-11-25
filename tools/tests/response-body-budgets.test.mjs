import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyResponseBodyRetrievalError, configureResponseBodyNetwork, createResponseBodyQueue, createResponseBodySessionPool, decodeBoundedCdpBodyResult, resolveResponseBodyLimits, responseBodyAdmission, responseBodyLimits } from "../discovery-capture-policy.mjs";
import { captureResponseBodyEvidence, parseArgs } from "../cdp-deep-capture.mjs";
import { hydrateResponseBodySidecars, loadResponseBodySidecar, writeResponseBodySidecar } from "../response-body-sidecars.mjs";
import { inspectVerifiedResponse } from "../response-evidence.mjs";
import { buildKnownOperationExecutionDigest } from "../portal-discovery-evidence-contract.mjs";

async function temporary(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-body-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("shared defaults and explicit budgets reject unsafe or ambiguous settings", () => {
  assert.deepEqual(resolveResponseBodyLimits(), { perBodyBytes: 16 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });
  for (const value of [null, [], false, { unknown: 1 }, { perBodyBytes: "1024" }, { perBodyBytes: 0 }, { perBodyBytes: -1 }, { perBodyBytes: 1.5 }, { perBodyBytes: Infinity }, { perBodyBytes: 256 * 1024 * 1024 + 1 }, { totalBytes: 1024 ** 3 + 1 }, { perBodyBytes: 100, totalBytes: 99 }]) {
    assert.throws(() => resolveResponseBodyLimits(value));
  }
});

test("UTF8 and base64 limits count decoded bytes, including large payloads", () => {
  for (const body of ["é".repeat(300_000), "x".repeat(1024 * 1024)]) {
    const bytes = Buffer.byteLength(body);
    for (const payload of [{ body }, { body: Buffer.from(body).toString("base64"), base64Encoded: true }]) {
      assert.equal(decodeBoundedCdpBodyResult(payload, bytes).body, body);
      assert.equal(decodeBoundedCdpBodyResult(payload, bytes - 1).state, "oversize");
    }
  }
});

test("capture, sidecar loading, analysis and JSON inspection agree above the old ceiling", async t => {
  const artifactDir = await temporary(t);
  const body = JSON.stringify({ padding: "x".repeat(1024 * 1024), token: "private-credential" });
  const captured = await captureResponseBodyEvidence({ artifactDir, evidenceId: "request-large", payload: { body }, requestUrl: "https://portal.test/api/read", matchHosts: ["portal.test"], matchPathPrefixes: ["/api/read"] });
  assert.equal(captured.bodyCapture.state, "complete");
  const record = { evidenceId: "request-large", bodyCapture: captured.bodyCapture };
  const loaded = await loadResponseBodySidecar({ artifactDir, ...record, descriptor: record.bodyCapture });
  assert.equal(loaded.includes("private-credential"), false);
  await hydrateResponseBodySidecars([record], artifactDir);
  assert.equal(record.responseBodyForAnalysis, loaded);
  assert.equal(JSON.stringify(record).includes("padding"), false);
  const facts = await inspectVerifiedResponse(artifactDir, record);
  assert.equal(facts.verifiedCompleteSidecar, true);
  assert.equal(JSON.stringify(facts).includes("xxxxx"), false);
});

test("higher explicit policy is needed by every reader; descriptors cannot raise it", async t => {
  const artifactDir = await temporary(t);
  const limits = { perBodyBytes: 18 * 1024 * 1024, totalBytes: 36 * 1024 * 1024 };
  const result = await writeResponseBodySidecar({ artifactDir, evidenceId: "request-override", sanitizedBody: "x".repeat(17 * 1024 * 1024), limits });
  assert.equal(result.bodyCapture.state, "complete");
  await assert.rejects(loadResponseBodySidecar({ artifactDir, evidenceId: "request-override", descriptor: { ...result.bodyCapture, limits } }), /retention limit/);
  assert.equal((await loadResponseBodySidecar({ artifactDir, evidenceId: "request-override", descriptor: result.bodyCapture, limits })).length, 17 * 1024 * 1024);
});

test("concurrent writes and analysis respect the aggregate policy and retain legacy descriptors", async t => {
  const artifactDir = await temporary(t);
  const limits = { perBodyBytes: 4, totalBytes: 8 };
  const results = await Promise.all([0, 1, 2].map(n => writeResponseBodySidecar({ artifactDir, evidenceId: `request-${n}`, sanitizedBody: "null", limits })));
  assert.deepEqual(results.map(r => r.bodyCapture.state), ["complete", "complete", "oversize"]);
  assert.equal(results[2].bodyCaptureDiagnostic, "response-body-retention-budget-exceeded");
  assert.equal(await loadResponseBodySidecar({ artifactDir, evidenceId: "request-0", descriptor: results[0].bodyCapture, limits }), "null");
  const records = [0, 1].map(n => ({ evidenceId: `request-${n}`, bodyCapture: results[n].bodyCapture }));
  await assert.rejects(hydrateResponseBodySidecars(records, artifactDir, { perBodyBytes: 4, totalBytes: 7 }), /aggregate budget/);
});

test("Network setup keeps explicit bounded buffers and negotiates durable messages without deprecated enable flag", async () => {
  const calls = [];
  const limits = { perBodyBytes: 100, totalBytes: 200 };
  assert.deepEqual(await configureResponseBodyNetwork(async (method, params) => { calls.push([method, params]); }, limits), { durable: true });
  assert.deepEqual(calls, [["Network.enable", { maxPostDataSize: 128 * 1024, maxResourceBufferSize: 100, maxTotalBufferSize: 200 }], ["Network.configureDurableMessages", { maxResourceBufferSize: 100, maxTotalBufferSize: 200 }]]);
  const fallback = await configureResponseBodyNetwork(async method => { if (method === "Network.configureDurableMessages") throw Object.assign(new Error("private detail"), { code: -32601 }); }, limits);
  assert.deepEqual(fallback, { durable: false, diagnostic: "cdp-durable-body-buffer-unsupported" });
  await assert.rejects(configureResponseBodyNetwork(async () => { throw new Error("enable failed"); }), /enable failed/);
});

test("Network session shares cannot multiply the capture-wide buffer allocation", () => {
  const pool = createResponseBodySessionPool({perBodyBytes: 4, totalBytes: 9});
  assert.deepEqual(pool.reserve('root'), {perBodyBytes: 4, totalBytes: 4});
  assert.deepEqual(pool.reserve('child'), {perBodyBytes: 4, totalBytes: 4});
  assert.equal(pool.reserve('excess'), null);
  assert.deepEqual(pool.reserve('root'), {perBodyBytes: 4, totalBytes: 4});
  pool.release('child');
  assert.deepEqual(pool.reserve('replacement'), {perBodyBytes: 4, totalBytes: 4});
  assert.equal(pool.reserve('excess'), null);
});

test("unavailable Network setup is not mislabeled as an oversized response", () => {
  assert.deepEqual(responseBodyAdmission(100, false, 1024), {state:'truncated', diagnostic:'cdp-response-body-network-unavailable'});
  assert.deepEqual(responseBodyAdmission(1025, true, 1024), {state:'oversize', diagnostic:null});
  assert.equal(responseBodyAdmission(1024, true, 1024), null);
});

test("implicit inspection honors a stricter recorded run budget and recorded metadata cannot raise reader permission", async t => {
  const artifactDir = await temporary(t);
  const result = await writeResponseBodySidecar({artifactDir, evidenceId:'request-recorded-budget', sanitizedBody:JSON.stringify({padding:'x'.repeat(5 * 1024 * 1024)})});
  const record = {evidenceId:'request-recorded-budget', bodyCapture:result.bodyCapture};
  await writeFile(path.join(artifactDir,'summary.json'), JSON.stringify({responseBodyLimits:{perBodyBytes:4*1024*1024,totalBytes:8*1024*1024}}));
  await assert.rejects(inspectVerifiedResponse(artifactDir,record), /retention limit/);
  await assert.rejects(inspectVerifiedResponse(artifactDir,record,{perBodyBytes:8*1024*1024,totalBytes:16*1024*1024}), /retention limit/);
  await writeFile(path.join(artifactDir,'summary.json'), JSON.stringify({responseBodyLimits:{perBodyBytes:32*1024*1024,totalBytes:64*1024*1024}}));
  await assert.rejects(inspectVerifiedResponse(artifactDir,record,{perBodyBytes:4*1024*1024,totalBytes:8*1024*1024}), /retention limit/);
  await writeFile(path.join(artifactDir,'summary.json'), JSON.stringify({responseBodyLimits:{perBodyBytes:'untrusted',totalBytes:64*1024*1024}}));
  await assert.rejects(inspectVerifiedResponse(artifactDir,record), /budget/);
});

test("response fetching starts before earlier consumption completes, with bounded pending bodies", async () => {
  const queue = createResponseBodyQueue({ perBodyBytes: 4, totalBytes: 8 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetched = [];
  const one = queue(async () => { fetched.push(1); return "one"; }, async load => { await gate; return load(); });
  const two = queue(async () => { fetched.push(2); return "two"; }, load => load());
  assert.equal(queue(() => { throw new Error("must not fetch"); }, () => {}), null);
  await Promise.resolve();
  assert.deepEqual(fetched, [1, 2]);
  release();
  assert.deepEqual(await Promise.all([one, two]), ["one", "two"]);
  await assert.rejects(queue(async () => { throw new Error("failed"); }, load => load()), /failed/);
  assert.equal(await queue(async () => "recovered", load => load()), "recovered");
});

test("retrieval diagnostics are controlled codes and never raw messages", () => {
  for (const [message, code] of [["Request content was evicted from inspector cache", "cdp-response-body-evicted"], ["No resource with given identifier found", "cdp-response-body-unavailable"], ["Session closed", "cdp-response-body-session-closed"], ["Timed out after 100ms", "cdp-response-body-timeout"], ["private URL token arbitrary failure", "cdp-response-body-retrieval-failed"]]) {
    assert.equal(classifyResponseBodyRetrievalError(new Error(message)), code);
  }
});

test("recipe policy reaches the driver and changes its full execution commitment", async t => {
  const artifactDir = await temporary(t);
  const recipe = { url: "https://portal.test/", portal: "test", actions: [], responseBodyLimits: { perBodyBytes: 1024, totalBytes: 4096 } };
  const recipePath = path.join(artifactDir, "recipe.json");
  await writeFile(recipePath, JSON.stringify(recipe));
  const args = await parseArgs(["--recipe", recipePath, "--out", artifactDir]);
  assert.deepEqual(args.responseBodyLimits, recipe.responseBodyLimits);
  const original = buildKnownOperationExecutionDigest(recipe);
  assert.notEqual(buildKnownOperationExecutionDigest({ ...recipe, responseBodyLimits: responseBodyLimits }), original);
  assert.equal(JSON.parse(await readFile(recipePath)).responseBodyLimits.perBodyBytes, 1024);
  await writeFile(recipePath, JSON.stringify({ ...recipe, responseBodyLimits: { perBodyBytes: "1024" } }));
  await assert.rejects(parseArgs(["--recipe", recipePath, "--out", artifactDir]), /budget/);
});
