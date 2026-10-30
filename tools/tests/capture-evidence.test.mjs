import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { decodeResponseCapture, mergeItems, requestEvidence, toApiRecord } from "../cdp-deep-capture.mjs";
import { mineJavascriptBundles } from "../mine-javascript-bundles.mjs";

function request(overrides = {}) {
  return { method: "GET", url: "https://service.example/api/items", status: 404,
    mimeType: "application/json", responseBody: '{"error":{"code":"NoLicense","message":"Unavailable"}}',
    evidenceId: "observation-1", pageLabel: "synthetic", ...overrides };
}

test("operation and variant identity preserve origins, semantic errors, statuses and media", () => {
  const baseline = requestEvidence(request());
  const differentError = requestEvidence(request({ responseBody: '{"error":{"code":"MissingResource","message":"Unavailable"}}' }));
  assert.equal(baseline.operationFingerprint, differentError.operationFingerprint);
  assert.equal(baseline.responseShapeFingerprint, differentError.responseShapeFingerprint);
  assert.notEqual(baseline.requestFingerprint, differentError.requestFingerprint);
  assert.notEqual(baseline.responseErrorSignature, differentError.responseErrorSignature);
  for (const override of [{ url: "https://other.example/api/items" }, { status: 500 }, { mimeType: "text/json" }]) {
    assert.notEqual(baseline.requestFingerprint, requestEvidence(request(override)).requestFingerprint);
  }
  assert.notEqual(baseline.operationFingerprint, requestEvidence(request({ url: "https://other.example/api/items" })).operationFingerprint);
  assert.equal(JSON.stringify(baseline).includes("NoLicense"), false);
});

test("decoded empty, unavailable, omitted, captured primitive and encoded bodies stay distinct", () => {
  const empty = decodeResponseCapture({ body: "" }, 0);
  const absent = decodeResponseCapture({});
  const number = decodeResponseCapture({ body: Buffer.from("0").toString("base64"), base64Encoded: true }, 1);
  const oversized = decodeResponseCapture({ body: "x".repeat(512 * 1024 + 1) });
  assert.equal(empty.capture.state, "empty");
  assert.equal(empty.body, "");
  assert.equal(absent.capture.reason, "body-unavailable");
  assert.equal(number.body, "0");
  assert.equal(number.capture.encoding, "base64");
  assert.equal(number.capture.decodedBytes, 1);
  assert.equal(oversized.body, null);
  assert.equal(oversized.capture.reason, "decoded-size-limit");
  assert.equal(decodeResponseCapture({ body: "invalid!", base64Encoded: true }).capture.reason, "malformed-base64");
  assert.notEqual(requestEvidence(request({ responseBody: "0" })).responseShapeFingerprint, null);
  assert.notEqual(requestEvidence(request({ responseBody: "false" })).responseShapeFingerprint, null);
  assert.notEqual(requestEvidence(request({ responseBody: "null" })).responseShapeFingerprint, null);
  assert.notEqual(requestEvidence(request({ responseBody: null, responseBodyCapture: absent.capture })).requestFingerprint,
    requestEvidence(request({ responseBody: "", responseBodyCapture: empty.capture })).requestFingerprint);
});

test("text and JSON primitive errors retain distinct bounded signatures without publishing messages", () => {
  for (const bodies of [["License unavailable", "Resource unavailable"], ['"License unavailable"', '"Resource unavailable"']]) {
    const left = requestEvidence(request({ responseBody: bodies[0] }));
    const right = requestEvidence(request({ responseBody: bodies[1] }));
    assert.ok(left.responseErrorSignature);
    assert.ok(right.responseErrorSignature);
    assert.equal(left.responseShapeFingerprint, right.responseShapeFingerprint);
    assert.notEqual(left.responseErrorSignature, right.responseErrorSignature);
    assert.notEqual(left.requestFingerprint, right.requestFingerprint);
    assert.doesNotMatch(JSON.stringify(left), /License unavailable/u);
  }
  assert.equal(requestEvidence(request({ responseBody: "" })).responseErrorSignature, null);
  assert.equal(requestEvidence(request({ responseBody: "text", status: 200 })).responseErrorSignature, null);
});

test("request media types survive CDP normalization and distinguish otherwise identical variants", () => {
  const json = toApiRecord(request({ headers: { "Content-Type": "Application/JSON; charset=utf-8" }, requestBody: '{"name":"example"}' }), "synthetic");
  const patch = toApiRecord(request({ headers: { "cOnTeNt-TyPe": "application/merge-patch+json" }, requestBody: '{"name":"example"}' }), "synthetic");
  assert.equal(json.requestContentType, "application/json");
  assert.equal(json.requestMediaType, "application/json");
  assert.equal(patch.requestContentType, "application/merge-patch+json");
  assert.equal(patch.requestMediaType, "application/merge-patch+json");
  assert.equal(json.operationFingerprint, patch.operationFingerprint);
  assert.equal(json.requestShapeFingerprint, patch.requestShapeFingerprint);
  assert.equal(json.responseShapeFingerprint, patch.responseShapeFingerprint);
  assert.notEqual(json.requestFingerprint, patch.requestFingerprint);
  assert.equal(json.requestFingerprint, toApiRecord(request({ headers: { "content-type": "application/json" }, requestBody: '{"name":"example"}' }), "synthetic").requestFingerprint);
});

test("bounded shapes explicitly mark omitted array items, object keys and depth as incomplete", () => {
  const firstTwenty = Array.from({ length: 20 }, () => 42);
  const complete = toApiRecord(request({ requestBody: JSON.stringify(firstTwenty), responseBody: JSON.stringify(firstTwenty) }), "synthetic");
  const partial = toApiRecord(request({ requestBody: JSON.stringify([...firstTwenty, "different-type"]), responseBody: JSON.stringify([...firstTwenty, "different-type"]) }), "synthetic");
  assert.deepEqual(complete.responseShapeSummary, partial.responseShapeSummary);
  assert.equal(complete.requestShapeComplete, true);
  assert.equal(complete.responseShapeComplete, true);
  assert.equal(partial.requestShapeComplete, false);
  assert.equal(partial.responseShapeComplete, false);
  assert.notEqual(complete.requestFingerprint, partial.requestFingerprint);
  const tooManyKeys = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`field${index}`, true]));
  assert.equal(requestEvidence(request({ responseBody: JSON.stringify(tooManyKeys) })).responseShapeComplete, false);
  let deep = true;
  for (let index = 0; index < 8; index++) deep = { nested: deep };
  assert.equal(requestEvidence(request({ responseBody: JSON.stringify(deep) })).responseShapeComplete, false);
  assert.equal(requestEvidence(request({ responseBody: '{"00000000-0000-4000-8000-000000000001":42}' })).responseShapeComplete, false);
  assert.equal(requestEvidence(request({ responseBody: "not-json" })).responseShapeComplete, false);
  assert.equal(requestEvidence(request({ responseBody: null })).responseShapeComplete, false);
  assert.equal(requestEvidence(request({ responseBody: "{}", responseShapeComplete: false })).responseShapeComplete, false);
});

test("full sanitized shape survives bounded sample truncation and provenance survives aggregation", () => {
  const decoded = decodeResponseCapture({ body: JSON.stringify({ token: "synthetic-secret", text: "x".repeat(6000) }) });
  assert.equal(decoded.capture.sampleTruncated, true);
  assert.equal(decoded.fullBody.includes("synthetic-secret"), false);
  let merged = toApiRecord(request(), "synthetic");
  for (let index = 2; index <= 12; index++) {
    merged = mergeItems(merged, toApiRecord(request({ evidenceId: `observation-${index}`,
      responseBody: JSON.stringify({ error: { code: "NoLicense", message: `sample ${index}` } }) }), "synthetic"));
  }
  assert.equal(merged.observationIds.length, 12);
  assert.equal(merged.responseBodySamples.length, 8);
  assert.equal(merged.responseBodySamplesTruncated, true);
  assert.ok(merged.responseBodySamples.every((sample) => sample.responseShapeSummary && sample.observationIds.length));
});

test("bundle aggregation retains two origins and same-basename distinct source content", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-evidence-"));
  try {
    await mkdir(path.join(directory, "one"));
    await mkdir(path.join(directory, "two"));
    const first = path.join(directory, "one", "bundle.js");
    const second = path.join(directory, "two", "bundle.js");
    await writeFile(first, 'fetch("https://one.example/api/items"); fetch("https://two.example/api/items");');
    await writeFile(second, 'fetch("https://one.example/api/items");');
    const result = await mineJavascriptBundles({ bundleFiles: [first, second], prefixes: ["/api/"], cacheMode: "disabled" });
    assert.equal(result.candidates.length, 3);
    assert.equal(new Set(result.candidates.map((item) => item.sourceHash)).size, 2);
    assert.deepEqual([...new Set(result.candidates.map((item) => item.hostname))].sort(), ["one.example", "two.example"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
