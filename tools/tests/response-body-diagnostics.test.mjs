import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { captureResponseBodyEvidence, captureResponseBodyWithLoader, mergeItems } from "../cdp-deep-capture.mjs";
import { responseBodySidecarLimit } from '../response-body-sidecars.mjs';

const safeCodes = new Set([
  "cdp-response-body-retrieval-failed",
  "bounded-response-body-decode-failed",
  "response-body-sanitization-rejected",
  "response-body-sidecar-incomplete",
  "response-body-capture-failed",
]);

test("CDP body retrieval failure has a private safe code and preserves legacy state", async () => {
  const result = await captureResponseBodyWithLoader({
    loadPayload: async () => { throw new Error("private URL and token must not escape"); },
  });
  assert.equal(result.bodyCapture.state, "decode-failed");
  assert.equal(result.bodyCaptureDiagnostic, "cdp-response-body-retrieval-failed");
  assert.equal(JSON.stringify(result).includes("private URL"), false);
  assert.equal(JSON.stringify(result).includes("token must not escape"), false);
});

test("bounded payload decoding reports a distinct safe code without changing state", async () => {
  const result = await captureResponseBodyWithLoader({
    loadPayload: async () => ({ body: "%%%", base64Encoded: true }),
  });
  assert.equal(result.bodyCapture.state, "decode-failed");
  assert.equal(result.bodyCaptureDiagnostic, "bounded-response-body-decode-failed");
  assert.deepEqual([...safeCodes].includes(result.bodyCaptureDiagnostic), true);
});

test("sanitization rejection is distinct from decoding and retains no raw payload", async () => {
  const result = await captureResponseBodyWithLoader({
    loadPayload: async () => ({ body: '{"authorization":"Bearer private-value", broken' }),
  });
  assert.equal(result.bodyCapture.state, "decode-failed");
  assert.equal(result.bodyCaptureDiagnostic, "response-body-sanitization-rejected");
  assert.equal(JSON.stringify(result).includes("private-value"), false);
});

test("incomplete sidecar writes get a safe stage code and retain the existing incomplete-write state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-diagnostic-sidecar-"));
  try {
    const result = await captureResponseBodyEvidence({
      artifactDir: dir,
      evidenceId: "request-sidecar-failure",
      payload: { body: "{}" },
      requestUrl: "https://portal.example/api/read",
      matchHosts: ["portal.example"],
      matchPathPrefixes: ["/api/read"],
      writeSidecar: async () => ({
        preview: "{}",
        bodyCapture: { state: "incomplete-write", previewState: "complete", path: null, sha256: null, byteLength: 2 },
      }),
    });
    assert.equal(result.bodyCapture.state, "incomplete-write");
    assert.equal(result.bodyCaptureDiagnostic, "response-body-sidecar-incomplete");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unexpected capture failure uses a fixed safe diagnostic", async () => {
  const result = await captureResponseBodyWithLoader({
    loadPayload: async () => ({ body: "{}" }),
    artifactDir: "unused",
    evidenceId: "request-capture-failure",
    requestUrl: "https://portal.example/api/read",
    matchHosts: ["portal.example"],
    matchPathPrefixes: ["/api/read"],
    writeSidecar: async () => { throw new Error("private path and response text"); },
  });
  assert.equal(result.bodyCapture.state, "decode-failed");
  assert.equal(result.bodyCaptureDiagnostic, "response-body-capture-failed");
  assert.equal(JSON.stringify(result).includes("private path"), false);
});

test("a complete empty response is preserved as evidence when a later capture fails", () => {
  const merged = mergeItems({
    evidenceId: "request-empty-success",
    attribution: { actionIndex: 2 },
    responseBodySample: "",
    bodyCapture: { state: "complete", path: "response-body-sidecars/request-empty-success.body", sha256: "c".repeat(64), byteLength: 0 },
    status: 204,
  }, {
    evidenceId: "request-empty-later-failure",
    attribution: { actionIndex: 4 },
    responseBodySample: null,
    bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
    bodyCaptureDiagnostic: "cdp-response-body-retrieval-failed",
    status: 204,
  });
  assert.equal(merged.evidenceId, "request-empty-success");
  assert.equal(merged.responseBodySample, "");
  assert.equal(merged.bodyCapture.state, "complete");
  assert.equal(merged.bodyCapture.byteLength, 0);
  assert.equal(merged.attribution.actionIndex, 2);
  assert.equal(Object.hasOwn(merged, "bodyCaptureDiagnostic"), false);
});

test("a valid complete descriptor without a preview is retained over a later failure", () => {
  const merged = mergeItems({
    evidenceId: "request-complete-no-preview",
    responseBodySample: null,
    bodyCapture: { state: "complete", path: "response-body-sidecars/request-complete-no-preview.body", sha256: "d".repeat(64), byteLength: 0 },
    status: 204,
  }, {
    evidenceId: "request-failure-after-no-preview",
    responseBodySample: null,
    bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
    bodyCaptureDiagnostic: "cdp-response-body-retrieval-failed",
    status: 204,
  });
  assert.equal(merged.evidenceId, "request-complete-no-preview");
  assert.equal(merged.responseBodySample, null);
  assert.equal(merged.bodyCapture.state, "complete");
  assert.equal(Object.hasOwn(merged, "bodyCaptureDiagnostic"), false);
});

test("invalid complete-descriptor path, evidence ID, or size falls through to later failure", () => {
  const cases = [
    { evidenceId: "request-valid-path", path: "response-body-sidecars/other.body", byteLength: 10 },
    { evidenceId: "../invalid-id", path: "response-body-sidecars/../invalid-id.body", byteLength: 10 },
    { evidenceId: "request-oversize", path: "response-body-sidecars/request-oversize.body", byteLength: responseBodySidecarLimit + 1 },
  ];
  for (const invalid of cases) {
    const merged = mergeItems({
      evidenceId: invalid.evidenceId,
      responseBodySample: null,
      bodyCapture: { state: "complete", path: invalid.path, sha256: "e".repeat(64), byteLength: invalid.byteLength },
      status: 200,
    }, {
      evidenceId: "request-valid-later-failure",
      responseBodySample: null,
      bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
      bodyCaptureDiagnostic: "bounded-response-body-decode-failed",
      status: 200,
    });
    assert.equal(merged.evidenceId, "request-valid-later-failure");
    assert.equal(merged.bodyCaptureDiagnostic, "bounded-response-body-decode-failed");
  }
});
test("null or non-string empty-like samples do not override a later failure tuple", () => {
  for (const responseBodySample of [null, 0]) {
    const merged = mergeItems({
      evidenceId: "request-no-response-sample",
      responseBodySample,
      bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
      bodyCaptureDiagnostic: "response-body-capture-failed",
      status: 200,
    }, {
      evidenceId: "request-new-failure",
      responseBodySample: null,
      bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
      bodyCaptureDiagnostic: "bounded-response-body-decode-failed",
      status: 200,
    });
    assert.equal(merged.evidenceId, "request-new-failure");
    assert.equal(merged.bodyCaptureDiagnostic, "bounded-response-body-decode-failed");
  }
});
test("a newer successful preview clears an older failure diagnostic", () => {
  const merged = mergeItems({
    evidenceId: "request-failed",
    attribution: { actionIndex: 2 },
    responseBodySample: null,
    bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
    bodyCaptureDiagnostic: "cdp-response-body-retrieval-failed",
    status: 200,
  }, {
    evidenceId: "request-success",
    attribution: { actionIndex: 3 },
    responseBodySample: "safe preview",
    bodyCapture: { state: "complete", path: "response-body-sidecars/request-success.body", sha256: "a".repeat(64), byteLength: 12 },
    status: 200,
  });
  assert.equal(merged.evidenceId, "request-success");
  assert.equal(merged.responseBodySample, "safe preview");
  assert.equal(merged.bodyCapture.state, "complete");
  assert.equal(Object.hasOwn(merged, "bodyCaptureDiagnostic"), false);
});

test("a later failure does not detach its diagnostic from the preserved successful preview", () => {
  const merged = mergeItems({
    evidenceId: "request-success",
    attribution: { actionIndex: 2 },
    responseBodySample: "previous preview",
    bodyCapture: { state: "complete", path: "response-body-sidecars/request-success.body", sha256: "b".repeat(64), byteLength: 17 },
    status: 200,
  }, {
    evidenceId: "request-later-failure",
    attribution: { actionIndex: 4 },
    responseBodySample: null,
    bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
    bodyCaptureDiagnostic: "bounded-response-body-decode-failed",
    status: 200,
  });
  assert.equal(merged.evidenceId, "request-success");
  assert.equal(merged.responseBodySample, "previous preview");
  assert.equal(merged.bodyCapture.state, "complete");
  assert.equal(merged.attribution.actionIndex, 2);
  assert.equal(Object.hasOwn(merged, "bodyCaptureDiagnostic"), false);
});

test("preview-preserving merge keeps an incomplete-sidecar diagnostic with its descriptor", () => {
  const merged = mergeItems({
    evidenceId: "request-preview",
    attribution: { actionIndex: 1 },
    responseBodySample: "preview only",
    bodyCapture: { state: "incomplete-write", path: null, sha256: null, byteLength: 50 },
    bodyCaptureDiagnostic: "response-body-sidecar-incomplete",
    status: 200,
  }, {
    evidenceId: "request-no-preview",
    attribution: { actionIndex: 2 },
    responseBodySample: null,
    bodyCapture: { state: "decode-failed", path: null, sha256: null, byteLength: 0 },
    bodyCaptureDiagnostic: "cdp-response-body-retrieval-failed",
    status: 200,
  });
  assert.equal(merged.evidenceId, "request-preview");
  assert.equal(merged.responseBodySample, "preview only");
  assert.equal(merged.bodyCapture.state, "incomplete-write");
  assert.equal(merged.bodyCaptureDiagnostic, "response-body-sidecar-incomplete");
});

test("successful capture has no diagnostic and remains complete", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-diagnostic-sidecar-ok-"));
  try {
    const result = await captureResponseBodyEvidence({
      artifactDir: dir,
      evidenceId: "request-sidecar-success",
      payload: { body: "{}" },
      requestUrl: "https://portal.example/api/read",
      matchHosts: ["portal.example"],
      matchPathPrefixes: ["/api/read"],
    });
    assert.equal(result.bodyCapture.state, "complete");
    assert.equal(Object.hasOwn(result, "bodyCaptureDiagnostic"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
