import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runPostmanTool, stabilizeCollection } from "../generate-postman-collections.mjs";

const recorder = createRequire(import.meta.url)("../nodoc-recorder/evidence.js");
const marker = "fixture-only-sensitive-value";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nodoc-recorder-postman-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { spec: path.join(directory, "spec.json"), collection: path.join(directory, "collection.json") };
}

test("Postman artifacts retain capture states and media uncertainty without private values", t => {
  const files = fixture(t);
  const cases = [
    { state: "captured", encoding: "utf8", sampleTruncated: false, decodedBytes: 2 },
    { state: "empty", encoding: "utf-8" },
    { state: "omitted", reason: "decoded-size-limit", encoding: "base64" },
    { state: "failed", reason: "invalid-utf8", encoding: "base64" },
    { state: marker, reason: marker, encoding: marker },
  ];
  const entries = cases.map((capture, index) => ({
    id: `metadata-${index}`, method: "GET", url: "https://metadata.example.com/items",
    statusCode: 200, requestBody: null, responseBody: null,
    requestCapture: capture, responseCapture: capture,
  }));
  const document = recorder.buildOpenApiDocuments(entries)[0];
  writeFileSync(files.spec, JSON.stringify(document));
  writeFileSync(files.collection, JSON.stringify({ info: {}, item: [{ request: { method: "GET", url: { raw: "https://metadata.example.com/items", path: ["items"] } } }] }));
  stabilizeCollection(files.spec, files.collection, null);
  const ledger = JSON.parse(readFileSync(files.collection, "utf8")).item[0]["x-nodoc-evidence"];
  assert.equal(ledger.observations.length, cases.length);
  for (const [index, capture] of cases.entries()) {
    const item = ledger.observations.find(value => value.observationId === `metadata-${index}`);
    for (const side of ["requestBody", "responseBody"]) {
      const { shape, ...metadata } = item[side];
      assert.deepEqual(metadata, recorder.normalizeCaptureMetadata(capture));
    }
    assert.deepEqual(item.responseMediaType, { value: "application/octet-stream", state: "unknown", reason: "missing-content-type" });
  }
  assert.doesNotMatch(JSON.stringify(ledger), new RegExp(marker));
});

test("Postman evidence and examples bind to the most specific route and matching origin", t => {
  const files = fixture(t);
  const operation = (id, servers) => ({
    ...(servers ? { servers } : {}),
    responses: { 200: { description: "Observed", content: { "application/json": { example: { source: id } } } } },
    "x-nodoc-observations": [{ observationId: id, variantId: `${id}-variant`, statusCode: 200, responseBody: { state: "captured", schema: { type: "number" }, value: marker } }],
  });
  writeFileSync(files.spec, JSON.stringify({ servers: [{ url: "https://alpha.example.com" }], paths: {
    "/items/{id}": { get: operation("obs-generic") },
    "/items/count": { get: operation("obs-count", [{ url: "https://beta.example.com" }]) },
  } }));
  const request = (parts, origin) => ({ method: "GET", url: { raw: `${origin}/${parts.join("/")}`, protocol: "https", host: new URL(origin).hostname.split("."), path: parts } });
  writeFileSync(files.collection, JSON.stringify({ info: {}, item: [
    { name: "count", request: request(["items", "count"], "https://alpha.example.com"), response: [{ code: 200, body: "converter" }] },
    { name: "generic", request: request(["items", ":id"], "https://alpha.example.com"), response: [{ code: 200, body: "converter" }] },
  ] }));
  stabilizeCollection(files.spec, files.collection, null, { hostRouting: true });
  const result = JSON.parse(readFileSync(files.collection, "utf8"));
  assert.equal(result.item[0].request.url.host.join("."), "beta.example.com");
  assert.equal(result.item[0]["x-nodoc-evidence"].observations[0].observationId, "obs-count");
  assert.equal(result.item[1]["x-nodoc-evidence"].observations[0].observationId, "obs-generic");
  assert.deepEqual(JSON.parse(result.item[0].response[0].body), { source: "obs-count" });
  assert.deepEqual(JSON.parse(result.item[1].response[0].body), { source: "obs-generic" });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  result.item = [{ name: "wrong-origin", request: request(["items", "count"], "https://gamma.example.com") }];
  writeFileSync(files.collection, JSON.stringify(result));
  stabilizeCollection(files.spec, files.collection, null);
  assert.equal(JSON.parse(readFileSync(files.collection, "utf8")).item[0]["x-nodoc-evidence"], undefined);
});

test("synthetic recorder observations survive the pinned converter and stabilization", t => {
  const files = fixture(t);
  const entries = [200, 404, 500].map((statusCode, index) => ({
    id: `obs-${index}`, method: "GET", url: `https://api.example.com/items?secret=${marker}`, statusCode,
    responseHeaders: { "Content-Type": "application/json" }, responseBody: JSON.stringify({ value: marker }),
  }));
  writeFileSync(files.spec, JSON.stringify(recorder.buildOpenApiDocuments(entries)[0]));
  const cli = path.resolve("node_modules", "openapi-to-postmanv2", "bin", "openapi2postmanv2.js");
  runPostmanTool(cli, ["-s", files.spec, "-o", files.collection, "-p", "-c", "postman_to_openapi.json"]);
  stabilizeCollection(files.spec, files.collection, null, { hostRouting: true });
  const collection = JSON.parse(readFileSync(files.collection, "utf8"));
  const requests = [];
  const visit = items => { for (const item of items ?? []) { if (item.request) requests.push(item); if (item.item) visit(item.item); } };
  visit(collection.item);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]["x-nodoc-evidence"].observations.map(item => item.status).sort(), [200, 404, 500]);
  assert.doesNotMatch(JSON.stringify(collection), new RegExp(marker));
});
