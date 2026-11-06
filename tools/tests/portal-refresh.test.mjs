import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { analyzeRefreshCapture, compareRefreshResponse, groupRefreshEnrichments, inferRefreshSchema, loadVerifiedRefreshAnalysis, matchRefreshOperation, responseHealth, syntheticRefreshExample } from "../portal-refresh.mjs";
import { buildSpecRouteInventory } from "../spec-quality-lib.mjs";
import { writeResponseBodySidecar } from "../response-body-sidecars.mjs";
import { aggregateInteractionHealth } from "../discovery-capture-policy.mjs";

test("refresh operation identity binds scheme, host, port, base path and method", () => {
  const inventory = [{ specId: "alpha", operations: [{ method: "GET", path: "/items/{id}", serverUrls: ["https://api.example:8443/v2"] }] }];
  const record = { method: "GET", url: "https://api.example:8443/v2/items/one?select=name" };
  assert.equal(matchRefreshOperation(record, inventory).length, 1);
  for (const url of ["http://api.example:8443/v2/items/one", "https://api.example/v2/items/one", "https://other.example:8443/v2/items/one", "https://api.example:8443/items/one", "https://user@api.example:8443/v2/items/one"]) assert.equal(matchRefreshOperation({ ...record, url }, inventory).length, 0);
  assert.equal(matchRefreshOperation({ ...record, method: "POST" }, inventory).length, 0);
  const variable = [{ specId: "variable", operations: [{ method: "GET", path: "/items", serverUrls: ["https://{name}.example/v2"] }] }];
  assert.equal(matchRefreshOperation({ method: "GET", url: "https://selected.example/v2/items" }, variable).length, 1);
  assert.equal(matchRefreshOperation({ method: "GET", url: "https://selected.other.example/v2/items" }, variable).length, 0);
});

test("refresh health keeps incomplete, semantic errors, aborts and 404 distinct", () => {
  const record = { status: 200, bodyCapture: { state: "complete" }, responseBodyForAnalysis: '{"items":[]}' };
  assert.equal(responseHealth(record), "successful-body-observed");
  for (const body of ['{"errors":[{"message":"private"}]}', '{"data":{"items":[]},"errors":[{"message":"private"}]}', '{"error":"private"}', '{"ErrorData":{"ErrorMessage":"private"}}', '{"errorData":{"errorMessage":"private"}}', '{"success":false}']) assert.equal(responseHealth({ ...record, responseBodyForAnalysis: body }), "semantic-error-observed");
  assert.equal(responseHealth({ ...record, bodyCapture: { state: "oversize" } }), "body-unverified");
  assert.equal(responseHealth({ ...record, responseBodyForAnalysis: '{"partial":' }), "body-unverified");
  assert.equal(responseHealth({ ...record, status: 404 }), "http-error-observed");
  assert.equal(responseHealth({ ...record, status: 204 }), "no-content-observed");
  assert.equal(responseHealth({ ...record, abortedBeforeSend: true }), "not-executed");
  assert.equal(responseHealth({ ...record, graphQlOperationName: "Items" }), "body-unverified");
});

test("inference preserves integers, null-only and empty arrays and uses synthetic values", () => {
  const privateValue = { count: 19, fraction: 1.25, name: "private-scalar-986", nullOnly: null, empty: [], entries: [{ enabled: true }] };
  const schema = inferRefreshSchema(privateValue);
  assert.deepEqual(schema.properties.nullOnly, { nullable: true });
  assert.deepEqual(schema.properties.empty, { type: "array", items: {} });
  assert.equal(schema.properties.count.type, "integer");
  assert.equal(schema.properties.fraction.type, "number");
  assert.ok(!JSON.stringify(schema).includes("private-scalar"));
  assert.deepEqual(syntheticRefreshExample(privateValue), { count: 0, empty: [], entries: [{ enabled: false }], fraction: 0.5, name: "example", nullOnly: null });
  assert.throws(() => inferRefreshSchema(Array.from({ length: 25 }).reduce(value => ({ nested: value }), null)), /depth/u);
});

test("review grouping reuses identical shapes without combining request variants", () => {
  const entry = { specId: "alpha", method: "GET", path: "/items", status: "200", mimeType: "application/json", comparison: "schema-missing", schema: { type: "array", items: {} }, exampleMissing: true,
    requestVariantDigest: "first", evidenceId: "one", captureId: "capture", actionIndex: 0, observedAt: "2026-11-05T10:00:00Z" };
  const groups = groupRefreshEnrichments([entry, { ...entry, evidenceId: "two", actionIndex: 1 }, { ...entry, requestVariantDigest: "different-query", evidenceId: "three" }]);
  assert.equal(groups.length, 2);
  assert.equal(groups.reduce((sum, group) => sum + group.supportingObservations.length, 0), 3);
  assert.equal(groups.find(group => group.requestVariantDigest === "first").supportingObservations.length, 2);
});

test("unsupported constraints never authorize potentially invalid synthetic examples", () => {
  assert.equal(compareRefreshResponse("abc", { type: "string", maxLength: 3 }), "contract-unverified");
  assert.equal(compareRefreshResponse([1, 2], { type: "array", minItems: 2, items: { type: "integer" } }), "contract-unverified");
  assert.equal(compareRefreshResponse([1, 2], { type: "array", uniqueItems: true, items: { type: "integer" } }), "contract-unverified");
  assert.equal(compareRefreshResponse({ count: "x" }, { type: "object", properties: { count: { type: "integer" } } }), "contract-conflict");
});

test("one immutable capture feeds all axes, repeats reuse analysis, tampering fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-refresh-test-"));
  const artifacts = path.join(root, "capture"), cacheDir = path.join(root, "cache");
  await mkdir(artifacts);
  const inventory = await buildSpecRouteInventory();
  const spec = inventory.find(entry => entry.specId === "purview");
  const operation = spec.operations.find(entry => entry.method === "GET" && !entry.path.includes("{"));
  assert.ok(operation);
  const url = `${operation.serverUrls[0].replace(/\/$/u, "")}${operation.path}`;
  const sidecar = await writeResponseBodySidecar({ artifactDir: artifacts, evidenceId: "refresh-fixture", sanitizedBody: '{"count":4,"items":[]}' });
  const records = [{ evidenceId: "refresh-fixture", method: "GET", url, path: new URL(url).pathname,
    mimeType: "application/json", status: 200, observedAt: "2026-11-05T10:00:00Z", attribution: { actionIndex: 0 }, bodyCapture: sidecar.bodyCapture }];
  const files = {
    "api-records.json": [{ ...records[0], url: "https://other.example/aggregated-loss" }],
    "raw-requests.json": records,
    "summary.json": { portal: "Purview", interactionHealth: aggregateInteractionHealth([]), actionValidation: { requiredActionFailures: [] } },
    "action-results.json": [{ actionIndex: 0, type: "capture", required: true, result: {} }],
  };
  for (const [filename, data] of Object.entries(files)) await writeFile(path.join(artifacts, filename), JSON.stringify(data));
  const before = new Map(await Promise.all((await readdir(artifacts)).filter(file => file.endsWith(".json")).map(async file => [file, await readFile(path.join(artifacts, file), "utf8")])));
  const first = await analyzeRefreshCapture({ artifacts, cacheDir, specId: spec.specId, inventory });
  const second = await analyzeRefreshCapture({ artifacts, cacheDir, specId: spec.specId, inventory });
  assert.equal(first.reused, false); assert.equal(second.reused, true);
  assert.deepEqual(first.analysis, second.analysis);
  assert.equal(first.analysis.captureComplete, true);
  assert.equal(first.analysis.recordSource, "raw-requests.json");
  assert.ok(first.analysis.observations.some(entry => entry.path === operation.path && entry.bodyVerified && entry.attributed));
  assert.ok(first.analysis.candidateQueue.candidates.some(entry => entry.documentationStatus === "documented"));
  assert.ok(first.analysis.groupedHandoff.manifest);
  for (const [filename, bytes] of before) assert.equal(await readFile(path.join(artifacts, filename), "utf8"), bytes);
  assert.equal(first.analysis.observations.some(entry => entry.removalRecommended), false);
  const changedInventory = structuredClone(inventory);
  changedInventory.find(entry => entry.specId === spec.specId).title += " fixture revision";
  const changed = await analyzeRefreshCapture({ artifacts, cacheDir, specId: spec.specId, inventory: changedInventory });
  assert.equal(changed.reused, false);
  assert.notEqual(changed.cacheKey, first.cacheKey);
  const cacheFile = path.join(cacheDir, `${first.cacheKey}.json`), cached = JSON.parse(await readFile(cacheFile));
  cached.analysis.captureComplete = false;
  await writeFile(cacheFile, JSON.stringify(cached));
  await assert.rejects(loadVerifiedRefreshAnalysis(cacheFile), /cache binding/u);
  await assert.rejects(analyzeRefreshCapture({ artifacts, cacheDir, specId: spec.specId, inventory }), /integrity/u);
  await writeFile(path.join(artifacts, "response-body-sidecars/refresh-fixture.body"), "{}");
  await assert.rejects(analyzeRefreshCapture({ artifacts, cacheDir, specId: spec.specId, inventory }), /hash or length/u);
});
