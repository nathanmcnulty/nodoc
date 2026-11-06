import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRequestEvidenceId } from "../cdp-deep-capture.mjs";
import { decodeBoundedCdpBodyResult } from "../discovery-capture-policy.mjs";
import { assessResponseBodySidecarCompleteness, hydrateResponseBodySidecars, loadResponseBodySidecar, responseBodySidecarLimit, sanitizeResponseBody, writeResponseBodySidecar } from "../response-body-sidecars.mjs";

test("complete sanitized bodies use hash-bound sidecars separate from truncated previews", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-sidecar-"));
  const raw = JSON.stringify({ padding: "x".repeat(6000), password: "secret-after-5k" });
  const sanitized = sanitizeResponseBody(raw);
  const result = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-abc", sanitizedBody: sanitized });
  assert.equal(result.bodyCapture.state, "complete");
  assert.equal(result.bodyCapture.previewState, "truncated");
  assert.equal(result.preview.includes("secret-after-5k"), false);
  const loaded = await loadResponseBodySidecar({ artifactDir: dir, evidenceId: "request-abc", descriptor: result.bodyCapture });
  assert.equal(loaded.includes("secret-after-5k"), false);
  assert.equal(loaded.includes("[redacted]"), true);
  const records = [{ evidenceId: "request-abc", bodyCapture: result.bodyCapture }];
  await hydrateResponseBodySidecars(records, dir);
  assert.equal(records[0].responseBodyForAnalysis, loaded);
  assert.equal(JSON.stringify(records).includes("padding"), false);
});

test("strict decoding distinguishes invalid base64, invalid utf8, exact cap, and oversize", () => {
  assert.equal(decodeBoundedCdpBodyResult({ body: "%%%", base64Encoded: true }).state, "decode-failed");
  assert.equal(decodeBoundedCdpBodyResult({ body: Buffer.from([0xff]).toString("base64"), base64Encoded: true }).state, "decode-failed");
  assert.equal(decodeBoundedCdpBodyResult({ body: "x".repeat(16) }, 16).state, "complete");
  assert.equal(decodeBoundedCdpBodyResult({ body: "x".repeat(17) }, 16).state, "oversize");
});

test("malformed structured bodies with credential values fail closed", () => {
  for (const raw of [
    '{"password":"secret with spaces", broken',
    '{"client_secret":"escaped \\\"secret\\\" value", broken',
    '{"authorization":"Bearer private-value", broken',
  ]) {
    assert.equal(sanitizeResponseBody(raw), null);
  }
  assert.equal(sanitizeResponseBody("authorization=Bearer+private+value&safe=yes"), "authorization=%5Bredacted%5D&safe=yes");
});

test("loader rejects traversal, filename mismatch, tamper, length mismatch, and incomplete writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-sidecar-"));
  const complete = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-safe", sanitizedBody: "{}" });
  await assert.rejects(loadResponseBodySidecar({ artifactDir: dir, evidenceId: "request-safe", descriptor: { ...complete.bodyCapture, path: "../escape" } }), /outside|filename/);
  await assert.rejects(loadResponseBodySidecar({ artifactDir: dir, evidenceId: "request-other", descriptor: complete.bodyCapture }), /filename/);
  const absolute = path.join(dir, complete.bodyCapture.path);
  await writeFile(absolute, "tampered");
  await assert.rejects(loadResponseBodySidecar({ artifactDir: dir, evidenceId: "request-safe", descriptor: complete.bodyCapture }), /hash or length/);
  const failed = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-fail", sanitizedBody: "{}", write: async () => { throw new Error("fail"); } });
  assert.equal(failed.bodyCapture.state, "incomplete-write");
  assert.equal(failed.bodyCapture.path, null);
});

test("writer and loader independently enforce the shared retention cap", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-sidecar-"));
  const oversized = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-large", sanitizedBody: "x".repeat(responseBodySidecarLimit + 1) });
  assert.equal(oversized.bodyCapture.state, "oversize");
  assert.equal(oversized.bodyCapture.path, null);

  await assert.rejects(loadResponseBodySidecar({
    artifactDir: dir,
    evidenceId: "request-large",
    descriptor: {
      state: "complete",
      path: "response-body-sidecars/request-large.body",
      sha256: "0".repeat(64),
      byteLength: responseBodySidecarLimit + 1,
    },
  }), /retention limit/);
});

test("a scoped atomic-write failure propagates capture incompleteness", () => {
  const result = assessResponseBodySidecarCompleteness([
    { evidenceId: "scoped-failure", matchesCurrentSpec: true, bodyCapture: { state: "incomplete-write" } },
    { evidenceId: "adjacent-failure", matchesCurrentSpec: false, bodyCapture: { state: "incomplete-write" } },
    { evidenceId: "scoped-oversize", matchesCurrentSpec: true, bodyCapture: { state: "oversize" } },
  ]);
  assert.deepEqual(result, { captureComplete: false, incompleteWriteCount: 1, evidenceIds: ["scoped-failure"] });
});

test("writer and loader deny symlink or junction sidecar boundaries", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-sidecar-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodoc-sidecar-outside-"));
  const link = path.join(dir, "response-body-sidecars");
  await mkdir(dir, { recursive: true });
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "ENOSYS"].includes(error?.code)) return t.skip(`symlink unavailable: ${error.code}`);
    throw error;
  }
  const writeResult = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-linked", sanitizedBody: "{}" });
  assert.equal(writeResult.bodyCapture.state, "incomplete-write");

  const outsideFile = path.join(outside, "request-linked.body");
  await writeFile(outsideFile, "{}", "utf8");
  await assert.rejects(loadResponseBodySidecar({
    artifactDir: dir,
    evidenceId: "request-linked",
    descriptor: { state: "complete", path: "response-body-sidecars/request-linked.body", sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", byteLength: 2 },
  }), /symlink|real path/);
  await rm(link, { force: true });
});

test("repeated same-route requests retain distinct hash-bound sidecars and reject collisions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-sidecar-repeat-"));
  const attribution = { actionIndex: 2, attempt: 0, frameId: "frame-1", loaderId: "loader-1", pageLabel: "admin", sessionId: "root", targetId: "page-1" };
  const shared = { attribution, method: "POST", requestUrl: "https://portal.example/graphql" };
  const firstId = buildRequestEvidenceId({ ...shared, requestId: "100.1", startedAt: 100 });
  const secondId = buildRequestEvidenceId({ ...shared, requestId: "100.2", startedAt: 101 });
  assert.notEqual(firstId, secondId);

  const first = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: firstId, sanitizedBody: '{"data":{"id":1}}' });
  const second = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: secondId, sanitizedBody: '{"data":{"id":2}}' });
  assert.equal(await loadResponseBodySidecar({ artifactDir: dir, evidenceId: firstId, descriptor: first.bodyCapture }), '{"data":{"id":1}}');
  assert.equal(await loadResponseBodySidecar({ artifactDir: dir, evidenceId: secondId, descriptor: second.bodyCapture }), '{"data":{"id":2}}');

  const collision = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: firstId, sanitizedBody: '{"data":{"id":3}}' });
  assert.equal(collision.bodyCapture.state, "incomplete-write");
  assert.equal(await loadResponseBodySidecar({ artifactDir: dir, evidenceId: firstId, descriptor: first.bodyCapture }), '{"data":{"id":1}}');

  const oversizedId = buildRequestEvidenceId({ ...shared, requestId: "100.3", startedAt: 102 });
  const oversizedPath = path.join(dir, "response-body-sidecars", `${oversizedId}.body`);
  await writeFile(oversizedPath, "x".repeat(responseBodySidecarLimit + 1));
  const oversizedCollision = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: oversizedId, sanitizedBody: "{}" });
  assert.equal(oversizedCollision.bodyCapture.state, "incomplete-write");
});
