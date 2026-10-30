import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { decodeResponseCapture, mergeItems, requestEvidence, toApiRecord } from "../cdp-deep-capture.mjs";
import { buildObservation, buildSpecContext, aggregateCandidates } from "../generate-crawl-candidates.mjs";
import { compareOperationContract } from "../operation-contract.mjs";
import { buildSpecRouteInventory } from "../spec-quality-lib.mjs";
import { buildCandidateHandoff, buildPartitionedCandidateHandoff } from "../discovery-candidate-handoff.mjs";
import { compilePromotionPlan } from "../portal-discovery-promotion-planner.mjs";
import { convertOpenApiToPostman, stabilizeCollection } from "../generate-postman-collections.mjs";
import { runOfflineBenchmark } from "../portal-discovery-benchmark.mjs";

const recorder = createRequire(import.meta.url)("../nodoc-recorder/evidence.js");
const marker = "fixture-only-sensitive-value";

// Synthetic inputs, real production transformations. These tests prove offline
// retention and conversion behavior, not that any portal supports these routes.
function observation(id, status, body, { origin = "https://alpha.example", route = "/items", encoded = false, capture = null } = {}) {
  const decoded = capture ? { body: null, capture } : decodeResponseCapture({ body: encoded ? Buffer.from(body).toString("base64") : body, base64Encoded: encoded });
  return {
    evidenceId: id, method: "GET", url: `${origin}${route}?access_token=${marker}`,
    status, mimeType: "application/json", headers: { Authorization: `Bearer ${marker}`, "Content-Type": "application/json" },
    responseHeaders: { "Content-Type": "application/json", "Set-Cookie": `session=${marker}` },
    requestBody: JSON.stringify({ password: marker }), requestBodyCapture: { state: "captured" },
    responseBody: decoded.body, responseBodyCapture: decoded.capture, pageLabel: "fixture-page",
  };
}

function corpus() {
  return [
    observation("obs-success", 200, JSON.stringify({ count: 42, note: marker })),
    observation("obs-license", 404, JSON.stringify({ error: { code: "LicenseMissing", message: marker } })),
    observation("obs-resource", 404, JSON.stringify({ error: { code: "ResourceMissing", message: marker } })),
    observation("obs-permission", 500, JSON.stringify({ error: { code: "PermissionMissing", message: marker } })),
    observation("obs-other-origin", 200, JSON.stringify({ enabled: true }), { origin: "https://beta.example" }),
    observation("obs-drift", 200, JSON.stringify({ count: "changed-type" }), { route: "/drift" }),
    observation("obs-primitive", 200, "42", { route: "/primitive", encoded: true }),
    observation("obs-null", 200, "null", { route: "/null" }),
    observation("obs-mixed", 200, '[null,42,"value",false]', { route: "/mixed" }),
    observation("obs-empty", 204, "", { route: "/empty" }),
    observation("obs-omitted", 200, "", { route: "/omitted", capture: { state: "omitted", reason: "decoded-size-limit", encoding: "base64" } }),
    { ...observation("obs-request-json", 200, '{"count":42}', { route: "/media" }), headers: { "cOnTeNt-TyPe": "application/json; charset=utf-8" } },
    { ...observation("obs-request-patch", 200, '{"count":42}', { route: "/media" }), headers: { "cOnTeNt-TyPe": "application/merge-patch+json" } },
  ];
}

function aggregate(raw) {
  const records = new Map();
  for (const request of raw) {
    const record = toApiRecord(request, "offline-fixture");
    records.set(record.requestFingerprint, records.has(record.requestFingerprint) ? mergeItems(records.get(record.requestFingerprint), record) : record);
  }
  return [...records.values()].sort((a, b) => a.requestFingerprint.localeCompare(b.requestFingerprint));
}

function recorderEntry(raw) {
  return { id: raw.evidenceId, method: raw.method, url: raw.url, statusCode: raw.status,
    requestHeaders: raw.headers, responseHeaders: raw.responseHeaders,
    requestBody: raw.requestBody, responseBody: raw.responseBody,
    requestCapture: raw.requestBodyCapture, responseCapture: raw.responseBodyCapture,
    timestamp: "2026-01-01T00:00:00.000Z", portal: "offline-fixture" };
}

function operationWithObservation(document, id) {
  return Object.values(document.paths).flatMap(pathItem => Object.values(pathItem))
    .find(operation => operation["x-nodoc-observations"]?.some(observation => observation.observationId === id));
}

async function inventoryFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-evidence-corpus-"));
  const root = path.join(directory, "nodoc-alpha", "specification");
  await mkdir(root, { recursive: true });
  const operation = { responses: { 200: { description: "Known shape", content: { "application/json": { schema: { type: "object", properties: { count: { type: "number" } } } } } } } };
  const mediaOperation = { ...operation, requestBody: { content: { "application/json": { schema: { type: "object", properties: { password: { type: "string" } } } } } } };
  await writeFile(path.join(root, "openapi.yml"), JSON.stringify({ openapi: "3.0.3", info: { title: "Offline alpha", version: "1" }, servers: [{ url: "https://alpha.example" }], paths: { "/items": { get: operation }, "/drift": { get: operation }, "/media": { get: mediaOperation } } }));
  return buildSpecRouteInventory({ specificationsRoot: directory });
}

function groupedHandoff(records, inventory) {
  const specContext = buildSpecContext(inventory.find(spec => spec.specId === "alpha"));
  const observations = records.filter(record => new URL(record.url).origin === "https://alpha.example" && ["/items", "/drift", "/media"].includes(record.path))
    .map(record => buildObservation(record, "api-records.json", "confirmed"));
  const candidates = aggregateCandidates(observations, specContext, false);
  assert.equal(candidates.length, 3, "documented operations remain candidates when they carry contract evidence");
  const handoff = buildCandidateHandoff({
    candidateQueue: { candidates, suppressedCandidates: [], scopeReviewCandidates: [] },
    specId: "alpha", specTitle: "Offline alpha", metadataNextPass: null,
    recovery: { captureComplete: true }, interactionHealthStatus: { available: true, accounting: { consistent: true } },
    saturation: { eligibility: "known" },
  });
  return buildPartitionedCandidateHandoff(handoff);
}

test("offline corpus preserves origin, conditional error, status and body-state distinctions through real transforms", async () => {
  const raw = corpus(), records = aggregate(raw);
  assert.equal(records.length, raw.length);
  assert.deepEqual(records, aggregate([...raw].reverse()));
  const errors = records.filter(record => record.status === 404);
  assert.equal(new Set(errors.map(record => record.responseErrorSignature)).size, 2);
  assert.equal(new Set(raw.filter(record => new URL(record.url).pathname === "/items").map(record => requestEvidence(record).operationFingerprint)).size, 2);
  assert.equal(records.find(record => record.path === "/primitive").responseShapeSummary, "number");
  assert.equal(records.find(record => record.path === "/primitive").responseBodyCapture.encoding, "base64");
  assert.equal(records.find(record => record.path === "/empty").responseBodyCapture.state, "empty");
  assert.equal(records.find(record => record.path === "/omitted").responseBodyCapture.reason, "decoded-size-limit");
  const mediaRecords = records.filter(record => record.path === "/media");
  assert.equal(new Set(mediaRecords.map(record => record.requestFingerprint)).size, 2);
  assert.deepEqual(mediaRecords.map(record => record.requestMediaType).sort(), ["application/json", "application/merge-patch+json"]);

  const inventory = await inventoryFixture(), grouped = groupedHandoff(records, inventory);
  const plan = compilePromotionPlan({ groupedHandoff: grouped, specInventory: inventory });
  assert.deepEqual(plan, compilePromotionPlan({ groupedHandoff: grouped, specInventory: inventory }));
  assert.equal(plan.mappings.find(item => item.normalizedPath === "/items").mapping, "enrichment");
  assert.equal(plan.mappings.find(item => item.normalizedPath === "/drift").mapping, "conflict");
  assert.ok(plan.mappings.every(item => item.outcome === "blocked"), "new evidence requires review; drift is never silently applied");
  const retained = grouped.partitions.flatMap(partition => partition.candidates).flatMap(candidate => candidate.contractObservations);
  const jsonMedia = grouped.partitions.flatMap(partition => partition.candidates).find(candidate => candidate.normalizedPath === "/media").contractObservations.find(observation => observation.requestMediaType === "application/json");
  const mediaContract = inventory[0].operations.find(operation => operation.path === "/media").contract;
  assert.equal(compareOperationContract(mediaContract, [jsonMedia]).kind, "exact", "actual JSON request media must match the declared contract");
  const bounded = toApiRecord(observation("obs-bounded", 200, JSON.stringify({ count: 42, rows: Array.from({ length: 21 }, () => ({ enabled: true })) })), "offline-fixture");
  assert.equal(bounded.responseShapeComplete, false, "bounded sampling is explicitly incomplete");
  const boundedObservation = buildObservation(bounded, "api-records.json", "confirmed");
  assert.equal(compareOperationContract(inventory[0].operations.find(operation => operation.path === "/items").contract, boundedObservation.contractObservations).kind, "unverified", "sample truncation must prevent a complete-contract claim");
  assert.equal(new Set(retained.flatMap(item => item.errorSignatures)).size, 3);
  assert.ok(retained.flatMap(item => item.observationIds).includes("obs-success"));

  const entries = raw.map(recorderEntry), documents = recorder.buildOpenApiDocuments(entries);
  assert.deepEqual(documents, recorder.buildOpenApiDocuments([...entries].reverse()));
  assert.equal(documents.length, 2);
  const alpha = documents.find(document => operationWithObservation(document, "obs-primitive"));
  assert.equal(Object.keys(alpha.paths).length, 8, "redacted routes must retain distinct operation identities");
  assert.deepEqual(Object.keys(alpha.paths["/items"].get.responses).sort(), ["200", "404", "500"]);
  assert.equal(alpha.paths["/items"].get["x-nodoc-observations"].length, 4);
  assert.deepEqual(recorder.inferSchema([null, 42]), recorder.inferSchema([42, null]));
  assert.equal(operationWithObservation(alpha, "obs-primitive").responses["200"].content["application/json"].schema.type, "integer");
  assert.equal(operationWithObservation(alpha, "obs-mixed").responses["200"].content["application/json"].schema.items.anyOf.length, 3);
  assert.equal(operationWithObservation(alpha, "obs-omitted").responses["200"].content, undefined);
  assert.doesNotMatch(JSON.stringify(documents), new RegExp(marker));
  assert.doesNotMatch(JSON.stringify(entries.map(recorder.exportEntry)), new RegExp(marker));
});

test("benchmark distinguishes fixture self-checks from supplied execution results", () => {
  const fixture = { schemaVersion: 1, corpusId: "source-label", scenarios: [{ scenarioId: "one", assertions: { retained: true }, syntheticResult: { retained: true } }] };
  assert.equal(runOfflineBenchmark(fixture).results[0].evidenceSource, "fixture-self-check");
  assert.equal(runOfflineBenchmark(fixture, { inputs: { one: { retained: true } } }).results[0].evidenceSource, "caller-supplied-result");
});

test("Postman evidence binds to the most specific operation and its origin", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-postman-binding-"));
  const specPath = path.join(directory, "openapi.json"), collectionPath = path.join(directory, "collection.json");
  const operation = (id, servers) => ({
    ...(servers ? { servers } : {}), responses: { 200: { description: "Observed", content: { "application/json": { example: { source: id } } } } },
    "x-nodoc-observations": [{ observationId: id, variantId: `${id}-variant`, statusCode: 200, responseBody: { state: "captured", schema: { type: "number" }, value: marker } }],
  });
  await writeFile(specPath, JSON.stringify({ servers: [{ url: "https://alpha.example.com" }], paths: {
    "/items/{id}": { get: operation("obs-generic") },
    "/items/count": { get: operation("obs-count", [{ url: "https://beta.example.com" }]) },
  } }));
  const request = (parts, origin) => ({ method: "GET", url: { raw: `${origin}/${parts.join("/")}`, protocol: "https", host: new URL(origin).hostname.split("."), path: parts } });
  await writeFile(collectionPath, JSON.stringify({ info: {}, item: [
    { name: "count", request: request(["items", "count"], "https://alpha.example.com"), response: [{ code: 200, body: "converter" }] },
    { name: "generic", request: request(["items", ":id"], "https://alpha.example.com"), response: [{ code: 200, body: "converter" }] },
  ] }));
  stabilizeCollection(specPath, collectionPath, null, { hostRouting: true });
  const collection = JSON.parse(await readFile(collectionPath, "utf8"));
  assert.equal(collection.item[0].request.url.host.join("."), "beta.example.com");
  assert.equal(collection.item[0]["x-nodoc-evidence"].observations[0].observationId, "obs-count");
  assert.equal(collection.item[1]["x-nodoc-evidence"].observations[0].observationId, "obs-generic");
  assert.deepEqual(JSON.parse(collection.item[0].response[0].body), { source: "obs-count" });
  assert.deepEqual(JSON.parse(collection.item[1].response[0].body), { source: "obs-generic" });
  assert.doesNotMatch(JSON.stringify(collection), new RegExp(marker));
  collection.item = [{ name: "wrong-origin", request: request(["items", "count"], "https://gamma.example.com") }];
  await writeFile(collectionPath, JSON.stringify(collection));
  stabilizeCollection(specPath, collectionPath, null);
  assert.equal(JSON.parse(await readFile(collectionPath, "utf8")).item[0]["x-nodoc-evidence"], undefined);
});

test("offline corpus survives the actual pinned Postman converter and production stabilization", { skip: process.env.NODOC_POSTMAN_PIPELINE !== "1" ? "Set NODOC_POSTMAN_PIPELINE=1 to run the pinned npm converter; no live portal traffic." : false }, async () => {
  const documents = recorder.buildOpenApiDocuments(corpus().map(recorderEntry));
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-postman-corpus-"));
  for (const [index, document] of documents.entries()) {
    const specPath = path.join(directory, `openapi-${index}.json`), collectionPath = path.join(directory, `collection-${index}.json`);
    await writeFile(specPath, JSON.stringify(document));
    convertOpenApiToPostman(specPath, collectionPath);
    stabilizeCollection(specPath, collectionPath, null, { hostRouting: true });
    const collection = JSON.parse(await readFile(collectionPath, "utf8"));
    const requests = [];
    const visit = items => { for (const item of items ?? []) { if (item.request) requests.push(item); if (item.item) visit(item.item); } };
    visit(collection.item);
    assert.ok(requests.length > 0);
    assert.doesNotMatch(JSON.stringify(collection), new RegExp(marker));
    if (operationWithObservation(document, "obs-primitive")) {
      const item = requests.find(item => item.request.url.path.join("/") === "items");
      assert.ok(item);
      assert.deepEqual([...new Set(item.response.map(response => response.code))].sort(), [200, 404, 500]);
      assert.equal(item["x-nodoc-evidence"].observations.length, 4);
      assert.equal(new Set(item["x-nodoc-evidence"].observations.filter(observation => observation.status === 404).map(observation => observation.variantId)).size, 2);
      assert.ok(item["x-nodoc-evidence"].observations.some(observation => observation.observationId === "obs-success"));
    }
  }
});
