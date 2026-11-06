import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { captureResponseBodyEvidence, graphQlOperationMetadata, mergeItems, privateRequestBodyEvidence, requestEvidence, responseErrorSignature } from "../cdp-deep-capture.mjs";
import { loadResponseBodySidecar } from "../response-body-sidecars.mjs";

const request = body => ({ url: "https://portal.example/api/items", method: "GET", status: 403, responseBody: JSON.stringify(body) });
const fingerprint = body => requestEvidence(request(body));

test("same-shaped error variants retain distinct private aggregation identities", () => {
  const denied = fingerprint({ error: { code: "Denied", message: "synthetic policy refusal" }, traceId: "first" });
  const gated = fingerprint({ error: { code: "Gated", message: "synthetic unavailable state" }, traceId: "second" });
  const repeated = fingerprint({ traceId: "third", error: { message: "synthetic policy refusal", code: "Denied" } });
  assert.equal(denied.responseShapeFingerprint, gated.responseShapeFingerprint);
  assert.notEqual(denied.responseErrorSignature, gated.responseErrorSignature);
  assert.notEqual(denied.requestFingerprint, gated.requestFingerprint);
  assert.equal(denied.responseErrorSignature, repeated.responseErrorSignature);
  assert.equal(denied.requestFingerprint, repeated.requestFingerprint);
  assert.doesNotMatch(JSON.stringify(denied), /synthetic policy refusal|Denied|first/u);
});

test("successful scalar changes do not split request aggregation", () => {
  const first = { ...request({ code: "A", message: "first", count: 1 }), status: 200 };
  const next = { ...request({ code: "B", message: "second", count: 2 }), status: 200 };
  assert.equal(responseErrorSignature(first), null);
  assert.equal(responseErrorSignature(next), null);
  assert.equal(requestEvidence(first).requestFingerprint, requestEvidence(next).requestFingerprint);
});

test("private aggregation separates exact API origins and media types", () => {
  const record = { ...request({ items: [] }), status: 200, mimeType: "application/json" };
  const variants = [
    "https://portal.example/api/items",
    "https://other.example/api/items",
    "http://portal.example/api/items",
    "https://portal.example:8443/api/items",
  ].map(url => requestEvidence({ ...record, url }).requestFingerprint);
  assert.equal(new Set(variants).size, variants.length);
  assert.equal(variants[0], requestEvidence({ ...record, url: "https://PORTAL.example:443/api/items" }).requestFingerprint);
  assert.equal(variants[0], requestEvidence({ ...record }).requestFingerprint);
  assert.notEqual(variants[0], requestEvidence({ ...record, mimeType: "application/problem+json" }).requestFingerprint);
});

test("same-name GraphQL queries with changed literal or persisted selectors stay distinct", () => {
  const record = {
    ...request({ data: {} }), url: "https://portal.example/graphql", method: "POST", status: 200,
    requestBody: "{}", requestBodyCaptureState: "captured",
  };
  const selectors = { kind: "query", name: "Items", literalQuerySha256Hash: "a".repeat(64), persistedQuerySha256Hash: null };
  const first = requestEvidence({ ...record, graphQlOperationSelectors: selectors });
  const literalChanged = requestEvidence({ ...record, graphQlOperationSelectors: { ...selectors, literalQuerySha256Hash: "b".repeat(64) } });
  const persistedChanged = requestEvidence({ ...record, graphQlOperationSelectors: { ...selectors, persistedQuerySha256Hash: "c".repeat(64) } });
  assert.notEqual(first.requestFingerprint, literalChanged.requestFingerprint);
  assert.notEqual(first.requestFingerprint, persistedChanged.requestFingerprint);
  assert.equal(first.requestFingerprint, requestEvidence({ ...record, graphQlOperationSelectors: selectors }).requestFingerprint);
  assert.notEqual(first.requestFingerprint, requestEvidence({ ...record, graphQlOperationSelectors: { ...selectors, kind: "mutation" } }).requestFingerprint);
});

test("captured GraphQL selectors and RPC command values survive request-preview truncation privately", () => {
  const url = "https://portal.example/graphql";
  const body = field => JSON.stringify({ operationName: "Items", query: `query Items { ${"same ".repeat(1200)}${field} }` });
  const makeRecord = text => ({ ...request({ data: {} }), url, method: "POST", status: 200,
    requestBody: `${text.slice(0, 5000)}…`, ...privateRequestBodyEvidence({ url, sanitizedBody: text }) });
  const first = makeRecord(body("first")), next = makeRecord(body("other"));
  assert.equal(first.requestBody, next.requestBody);
  assert.equal(first.requestBodyCaptureState, "truncated");
  assert.equal(graphQlOperationMetadata(first).name, "Items");
  assert.notEqual(graphQlOperationMetadata(first).literalQuerySha256Hash, graphQlOperationMetadata(next).literalQuerySha256Hash);
  assert.notEqual(requestEvidence(first).requestFingerprint, requestEvidence(next).requestFingerprint);

  const rpc = command => {
    const rpcUrl = "https://portal.example/api/rpc";
    const text = JSON.stringify({ padding: "x".repeat(6000), command });
    return { ...request({ result: [] }), url: rpcUrl, method: "POST", status: 200,
      requestBody: `${text.slice(0, 5000)}…`, ...privateRequestBodyEvidence({ url: rpcUrl, sanitizedBody: text }) };
  };
  const readItems = rpc("GetItems"), readGroups = rpc("GetGroups");
  assert.equal(readItems.requestBody, readGroups.requestBody);
  assert.equal(requestEvidence(readItems).requestShapeFingerprint, requestEvidence(readGroups).requestShapeFingerprint);
  assert.notEqual(requestEvidence(readItems).requestFingerprint, requestEvidence(readGroups).requestFingerprint);
  assert.equal(requestEvidence({ ...readItems, evidenceId: "first" }).requestFingerprint, requestEvidence({ ...readItems, evidenceId: "other" }).requestFingerprint);
  assert.deepEqual(graphQlOperationMetadata(readItems), { kind: null, name: null, persistedQuerySha256Hash: null, literalQuerySha256Hash: null });
});

test("unverified request prefixes and unavailable bodies do not acquire complete command identity", () => {
  const prefix = { ...request({}), method: "POST", requestBody: '{"command":"', requestBodyCaptureState: "truncated" };
  assert.notEqual(requestEvidence({ ...prefix, evidenceId: "request-first" }).requestFingerprint, requestEvidence({ ...prefix, evidenceId: "request-other" }).requestFingerprint);
  assert.equal(requestEvidence(prefix).requestBodyCaptureState, "truncated");
  assert.deepEqual(privateRequestBodyEvidence({ url: prefix.url, sanitizedBody: null, hasPostData: true }), { requestBodyCaptureState: "unavailable" });
  assert.deepEqual(privateRequestBodyEvidence({ url: prefix.url, sanitizedBody: null }), { requestBodyCaptureState: "not-observed" });
  assert.equal(graphQlOperationMetadata({ url: "https://portal.example/graphql", requestBody: prefix.requestBody }).name, null);
});

test("HTTP 200 GraphQL partial errors preserve semantics independently of data values", () => {
  const partial = (message, name) => ({ ...request({ data: { item: { name } }, errors: [{ message, extensions: { code: "GATED" } }] }), status: 200 });
  assert.equal(responseErrorSignature(partial("state unavailable", "first")), responseErrorSignature(partial("state unavailable", "second")));
  assert.notEqual(responseErrorSignature(partial("state unavailable", "first")), responseErrorSignature(partial("access denied", "first")));
  assert.equal(responseErrorSignature({ ...request({ data: { item: {} }, errors: [] }), status: 200 }), null);
  assert.notEqual(responseErrorSignature({ ...request({ success: false }), status: 200 }), null);
});

test("verified complete sidecar text takes precedence over a preview or cached preview signature", () => {
  const full = JSON.stringify({ error: { message: "complete error", code: "FULL" } });
  const first = { ...request({ error: { message: "preview error", code: "PREVIEW" } }), responseBodyForAnalysis: full };
  const expected = responseErrorSignature({ ...first, responseBody: undefined });
  first.responseErrorSignature = responseErrorSignature(request({ error: { message: "stale error", code: "STALE" } }));
  assert.equal(responseErrorSignature(first), expected);
  assert.equal(requestEvidence(first).responseErrorSignature, expected);
});

test("capture computes variant identity from complete sanitized bodies beyond preview limits", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-error-variants-"));
  try {
    const capture = async (code, evidenceId) => captureResponseBodyEvidence({
      artifactDir, evidenceId, status: 403, requestUrl: "https://portal.example/api/items", matchHosts: ["portal.example"],
      payload: { body: JSON.stringify({ padding: "x".repeat(6000), error: { code, message: "synthetic error" } }) },
    });
    const first = await capture("FIRST", "request-error-first");
    const next = await capture("OTHER", "request-error-other");
    assert.equal(first.bodyCapture.state, "complete");
    assert.equal(first.bodyCapture.previewState, "truncated");
    assert.equal(first.responseBody, next.responseBody);
    assert.notEqual(first.responseErrorSignature, next.responseErrorSignature);
    const body = await loadResponseBodySidecar({ artifactDir, evidenceId: "request-error-first", descriptor: first.bodyCapture });
    assert.equal(first.responseErrorSignature, responseErrorSignature({ status: 403, responseBodyForAnalysis: body }));
    const capturedRequest = { ...request({}), ...first };
    assert.equal(requestEvidence(capturedRequest).responseErrorSignature, first.responseErrorSignature);
    assert.equal(first.bodyCapture.path, "response-body-sidecars/request-error-first.body");
  } finally { await rm(artifactDir, { recursive: true, force: true }); }
});

test("unrecognized, deep and incomplete failures remain bounded opaque variants", async () => {
  const malformed = { ...request({}), responseBody: '{"error":', bodyCapture: { state: "truncated" } };
  assert.match(responseErrorSignature(malformed), /^[a-f0-9]{64}$/u);
  assert.notEqual(responseErrorSignature(malformed), responseErrorSignature({ ...malformed, responseBody: '{"errors":' }));
  assert.equal(responseErrorSignature({ ...malformed, status: 200 }), null);
  assert.equal(responseErrorSignature({ status: 404, responseBody: null }), null);
  const deep = code => request({ a: { b: { c: { d: { e: { error: { code } } } } } } });
  assert.notEqual(responseErrorSignature(deep("A")), responseErrorSignature(deep("B")));
  const wide = code => request({ ...Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`field${String(index).padStart(3, "0")}`, index])), zError: code });
  assert.notEqual(responseErrorSignature(wide("A")), responseErrorSignature(wide("B")));
  const oversize = await captureResponseBodyEvidence({ status: 404, payload: { body: "x".repeat(65) }, limits: { perBodyBytes: 64, totalBytes: 64 } });
  assert.equal(oversize.bodyCapture.state, "oversize");
  assert.equal(oversize.responseErrorSignature, undefined);
  assert.notEqual(requestEvidence({ ...malformed, url: "invalid" }).requestFingerprint, requestEvidence({ ...malformed, url: "invalid", responseBody: "different" }).requestFingerprint);
});

test("response merge retains complete sidecar identity ahead of incomplete newer previews", () => {
  const complete = {
    evidenceId: "request-existing", responseBodySample: "complete-preview", responseErrorSignature: "a".repeat(64), status: 403,
    observedAt: "2026-10-30T12:00:00Z", attribution: { actionIndex: 2, pageLabel: "original-action" },
    url: "https://portal.example/api/items?view=original", mimeType: "application/json",
    bodyCapture: { state: "complete", path: "response-body-sidecars/request-existing.body", sha256: "b".repeat(64), byteLength: 16 },
  };
  const incomplete = { evidenceId: "request-next", responseBodySample: "incomplete-preview", responseErrorSignature: "c".repeat(64), bodyCapture: { state: "truncated" }, status: 500,
    observedAt: "2026-11-06T12:00:00Z", attribution: { actionIndex: 4, pageLabel: "later-action" },
    url: "https://portal.example/api/items?view=later", mimeType: "text/plain" };
  const merged = mergeItems(complete, incomplete);
  assert.equal(merged.responseErrorSignature, complete.responseErrorSignature);
  assert.equal(merged.evidenceId, complete.evidenceId);
  assert.deepEqual(merged.bodyCapture, complete.bodyCapture);
  assert.equal(merged.status, 403);
  assert.equal(merged.observedAt, complete.observedAt);
  assert.deepEqual(merged.attribution, complete.attribution);
  assert.equal(merged.url, complete.url);
  assert.equal(merged.mimeType, complete.mimeType);
  const withoutDate = { ...complete };
  delete withoutDate.observedAt;
  assert.equal(Object.hasOwn(mergeItems(withoutDate, incomplete), "observedAt"), false);
});

test("capture sanitizes credential-bearing semantic values before calculating private signatures", async () => {
  const capture = value => captureResponseBodyEvidence({ status: 403, payload: { body: JSON.stringify({ error: { message: `Bearer ${value}` } }) } });
  const first = await capture("synthetic-first");
  const next = await capture("synthetic-other");
  assert.equal(first.responseErrorSignature, next.responseErrorSignature);
  assert.doesNotMatch(first.sanitizedBody, /synthetic-first/u);
  assert.equal(first.responseErrorSignature, responseErrorSignature({ status: 403, responseBodyForAnalysis: first.sanitizedBody }));
});
