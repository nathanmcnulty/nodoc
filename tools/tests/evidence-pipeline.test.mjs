import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { mergeItems, requestEvidence, toApiRecord } from "../cdp-deep-capture.mjs";
import { buildObservation, buildSpecContext, aggregateCandidates } from "../generate-crawl-candidates.mjs";
import { assertPublishableEvidenceInput, compareOperationContract, contractObservation } from "../operation-contract.mjs";
import { buildSpecRouteInventory } from "../spec-quality-lib.mjs";
import { buildCandidateHandoff, buildPartitionedCandidateHandoff } from "../discovery-candidate-handoff.mjs";
import { buildReviewAssignmentPlan } from "../discovery-review-assignments.mjs";
import { compilePromotionPlan, promotionDigest } from "../portal-discovery-promotion-planner.mjs";
import { loadBenchmarkCorpus, runOfflineBenchmark } from "../portal-discovery-benchmark.mjs";
import { runPostmanTool, stabilizeCollection } from "../generate-postman-collections.mjs";

const recorder = createRequire(import.meta.url)("../nodoc-recorder/evidence.js");
const privateMarker = "fixture-only-private-value";

function record(id, status, responseBody, {
  origin = "https://alpha.example",
  route = "/items",
  responseBodyCapture = { state: "captured" },
  requestHeaders = {},
  requestBody,
} = {}) {
  return toApiRecord({
    evidenceId: id,
    method: "GET",
    url: `${origin}${route}?access_token=${privateMarker}`,
    status,
    mimeType: "application/json",
    headers: requestHeaders,
    responseHeaders: { "Content-Type": "application/json", "Set-Cookie": `session=${privateMarker}` },
    requestBody,
    requestBodyCapture: { state: requestBody === undefined ? "empty" : "captured" },
    responseBody,
    responseBodyCapture,
    pageLabel: "synthetic-fixture",
  }, "synthetic-fixture");
}

async function inventoryFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-evidence-review-"));
  const specDirectory = path.join(directory, "nodoc-alpha", "specification");
  await mkdir(specDirectory, { recursive: true });
  const response = {
    description: "Synthetic response",
    content: { "application/json": { schema: { type: "object", properties: { count: { type: "number" } } } } },
  };
  const spec = {
    openapi: "3.0.3",
    info: { title: "Offline alpha", version: "1" },
    servers: [{ url: "https://alpha.example" }],
    paths: {
      "/items": { get: { responses: { 200: response } } },
      "/drift": { get: { responses: { 200: response } } },
      "/media": { get: {
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
        responses: { 200: response },
      } },
    },
  };
  await writeFile(path.join(specDirectory, "openapi.yml"), JSON.stringify(spec));
  return { directory, inventory: await buildSpecRouteInventory({ specificationsRoot: directory }) };
}

function groupedHandoff(records, inventory) {
  const context = buildSpecContext(inventory[0]);
  const observations = records
    .filter((entry) => new URL(entry.url).origin.startsWith("https://") && ["/items", "/drift", "/media", "/new"].includes(entry.path))
    .map((entry) => buildObservation(entry, "api-records.json", "confirmed"));
  const candidates = aggregateCandidates(observations, context, false);
  const handoff = buildCandidateHandoff({
    candidateQueue: { candidates, suppressedCandidates: [], scopeReviewCandidates: [] },
    specId: "alpha",
    specTitle: "Offline alpha",
    metadataNextPass: null,
    recovery: { captureComplete: true },
    interactionHealthStatus: { available: true, accounting: { consistent: true } },
    saturation: { eligibility: "known" },
  });
  return buildPartitionedCandidateHandoff(handoff);
}

test("offline records keep operation, contract variant, completeness and sanitized provenance distinct", () => {
  const success = record("obs-success", 200, '{"count":42}');
  const errorA = record("obs-error-a", 404, '{"error":{"code":"FeatureMissing","message":"Unavailable"}}');
  const errorB = record("obs-error-b", 404, '{"error":{"code":"ResourceMissing","message":"Unavailable"}}');
  const otherOrigin = record("obs-other-origin", 200, '{"count":42}', { origin: "https://beta.example" });
  const omitted = record("obs-omitted", 200, null, { route: "/drift", responseBodyCapture: { state: "omitted", reason: "size-limit" } });

  assert.notEqual(success.operationFingerprint, otherOrigin.operationFingerprint);
  assert.equal(errorA.operationFingerprint, errorB.operationFingerprint);
  assert.notEqual(errorA.responseErrorSignature, errorB.responseErrorSignature);
  assert.equal(requestEvidence({
    method: "GET",
    url: "https://alpha.example/items",
    responseBody: "0",
  }).responseShapeSummary, "number");
  assert.equal(omitted.responseShapeComplete, false);
  assert.equal(omitted.responseBodyCapture.state, "omitted");
  assert.doesNotMatch(JSON.stringify([
    requestEvidence(success),
    requestEvidence(errorA),
    requestEvidence(errorB),
  ]), new RegExp(privateMarker));

  let merged;
  for (let index = 0; index < 10; index += 1) {
    const item = record(`obs-sample-${index}`, 200, JSON.stringify({ count: index }));
    merged = merged ? mergeItems(merged, item) : item;
  }
  assert.equal(merged.observationIds.length, 10);
  assert.equal(merged.responseBodySamples.length, 8);
  assert.equal(merged.responseBodySamplesTruncated, true);
  assert.ok(merged.responseBodySamples.every((sample) => sample.observationIds.length === 1));
});

test("candidate, handoff and promotion review compare existing contracts and keep uncertainty report-only", async (t) => {
  const { directory, inventory } = await inventoryFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const exact = groupedHandoff([record("obs-exact", 200, '{"count":42}')], inventory);
  const exactPlan = compilePromotionPlan({ groupedHandoff: exact, specInventory: inventory });
  assert.equal(exactPlan.mode, "report-only");
  assert.equal(exactPlan.mappings[0].mapping, "exact");
  assert.equal(exactPlan.mappings[0].outcome, "already-documented");

  const reviewed = groupedHandoff([
    record("obs-success", 200, '{"count":42}'),
    record("obs-error", 404, '{"error":{"code":"FeatureMissing"}}'),
    record("obs-drift", 200, '{"count":"wrong-type"}', { route: "/drift" }),
    record("obs-unknown", 200, null, { route: "/drift", responseBodyCapture: { state: "omitted", reason: "size-limit" } }),
  ], inventory);
  const plan = compilePromotionPlan({ groupedHandoff: reviewed, specInventory: inventory });
  assert.deepEqual(plan, compilePromotionPlan({ groupedHandoff: reviewed, specInventory: inventory }));
  assert.ok(plan.mappings.every((mapping) => mapping.outcome !== "proposed"));
  assert.ok(plan.mappings.some((mapping) => mapping.mapping === "enrichment"));
  assert.ok(plan.mappings.some((mapping) => mapping.reasonCodes.includes("architecture-schema-conflict")));
  assert.ok(plan.mappings.some((mapping) => mapping.reasonCodes.includes("contract-evidence-incomplete")));
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(privateMarker));
  assert.equal(compareOperationContract(inventory[0].operations.find((operation) => operation.path === "/items").contract, [
    contractObservation({ status: 204, responseBodyState: "omitted" }),
  ]).kind, "unverified");

  const jsonRequest = groupedHandoff([
    record("obs-json-request", 200, '{"count":42}', {
      route: "/media",
      requestBody: '{"name":"example"}',
      requestHeaders: { "Content-Type": "application/json; charset=utf-8" },
    }),
  ], inventory);
  assert.equal(compilePromotionPlan({ groupedHandoff: jsonRequest, specInventory: inventory }).mappings[0].mapping, "exact");
  const patchRequest = groupedHandoff([
    record("obs-patch-request", 200, '{"count":42}', {
      route: "/media",
      requestBody: '{"name":"example"}',
      requestHeaders: { "Content-Type": "application/merge-patch+json" },
    }),
  ], inventory);
  const patchMapping = compilePromotionPlan({ groupedHandoff: patchRequest, specInventory: inventory }).mappings[0];
  assert.equal(patchMapping.mapping, "enrichment");
  assert.ok(patchMapping.reasonCodes.includes("new-request-variant"));
});

test("origin-bound assignments and approvals cannot be replayed against changed observations", async (t) => {
  const { directory, inventory } = await inventoryFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const grouped = groupedHandoff([
    record("obs-alpha", 200, '{"count":42}', { route: "/new" }),
    record("obs-beta", 200, '{"count":42}', { origin: "https://beta.example", route: "/new" }),
  ], inventory);
  const candidates = grouped.partitions.flatMap((partition) => partition.candidates);
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].originBindingId, candidates[1].originBindingId);
  assert.doesNotMatch(JSON.stringify(grouped), /beta\.example/u);

  const review = buildReviewAssignmentPlan(grouped);
  assert.equal(review.sourceHandoffDigest, promotionDigest(grouped));
  assert.ok(review.assignments.every((assignment) => assignment.sourceHandoffDigest === review.sourceHandoffDigest));
  const assignment = review.assignments[0];
  const acceptedId = grouped.partitions.find((partition) => promotionDigest(partition) === assignment.partitionDigest)?.candidates[0]?.candidateId;
  assert.ok(acceptedId);
  const workerResult = {
    assignmentId: assignment.assignmentId,
    assignmentDigest: assignment.assignmentDigest,
    sourceHandoffDigest: review.sourceHandoffDigest,
    status: "completed",
    decision: "accept",
    candidateAccounting: { accepted: [acceptedId] },
  };
  const approvedPlan = compilePromotionPlan({ groupedHandoff: grouped, reviewPlan: review, workerResults: [workerResult], specInventory: inventory });
  assert.equal(approvedPlan.mappings.find((mapping) => mapping.candidateId === acceptedId).outcome, "proposed");

  const changed = structuredClone(grouped);
  changed.partitions[0].candidates[0].contractObservations[0].responseShape.count = "string";
  const stalePlan = compilePromotionPlan({ groupedHandoff: changed, reviewPlan: review, workerResults: [workerResult], specInventory: inventory });
  assert.ok(stalePlan.mappings.some((mapping) => mapping.reasonCodes.includes("approval-evidence-binding-mismatch")
    || mapping.reasonCodes.includes("approval-assignment-mismatch")));
  assert.notEqual(stalePlan.sourceHandoffDigest, workerResult.sourceHandoffDigest);
});

test("typed contract vocabulary is allowed while raw values and untrusted handoff evidence are rejected", async (t) => {
  const canonical = contractObservation({
    status: 200,
    mimeType: "application/json",
    responseShapeSummary: { authorization: "string", secret: "boolean" },
    responseShapeComplete: true,
    observationId: "obs-safe",
  });
  assertPublishableEvidenceInput({ contractObservations: [canonical] });
  const { directory, inventory } = await inventoryFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const grouped = groupedHandoff([record("obs-private", 200, '{"count":42}')], inventory);
  grouped.partitions[0].candidates[0].contractObservations[0].responseShape.count = "actual-private-value";
  assert.throws(() => compilePromotionPlan({ groupedHandoff: grouped, specInventory: inventory }), /contract observations|sensitive data/u);
});

test("benchmark results identify fixture self-checks versus supplied execution results", async () => {
  const corpus = {
    schemaVersion: 1,
    corpusId: "evidence-source-test",
    scenarios: [{ scenarioId: "one", assertions: { retained: true }, syntheticResult: { retained: true } }],
  };
  assert.equal(runOfflineBenchmark(corpus).results[0].evidenceSource, "fixture-self-check");
  assert.equal(runOfflineBenchmark(corpus, { inputs: { one: { retained: true } } }).results[0].evidenceSource, "caller-supplied-result");
  assert.equal(runOfflineBenchmark(corpus).measurements.synthetic, true);
  const checkedInCorpus = await loadBenchmarkCorpus();
  assert.equal(runOfflineBenchmark(checkedInCorpus).results[0].evidenceSource, "fixture-self-check");
});

test("synthetic recorder observations survive the pinned converter and evidence stabilization", {
  skip: process.env.NODOC_POSTMAN_PIPELINE !== "1"
    ? "Set NODOC_POSTMAN_PIPELINE=1 to run the pinned npm converter; no live portal traffic."
    : false,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nodoc-evidence-postman-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const specPath = path.join(directory, "openapi.json");
  const collectionPath = path.join(directory, "collection.json");
  const entries = [200, 404, 500].map((statusCode, index) => ({
    id: `obs-${index}`,
    method: "GET",
    url: `https://api.example/items?secret=${privateMarker}`,
    statusCode,
    responseHeaders: { "Content-Type": "application/json", "Set-Cookie": `session=${privateMarker}` },
    responseBody: JSON.stringify({ count: index, private: privateMarker }),
  }));
  const [document] = recorder.buildOpenApiDocuments(entries);
  await writeFile(specPath, JSON.stringify(document));
  const converterPath = path.resolve("node_modules", "openapi-to-postmanv2", "bin", "openapi2postmanv2.js");
  runPostmanTool(converterPath, ["-s", specPath, "-o", collectionPath, "-p", "-c", "postman_to_openapi.json"], { stdio: "pipe" });
  stabilizeCollection(specPath, collectionPath, null);
  const collection = JSON.parse(await readFile(collectionPath, "utf8"));
  const requests = [];
  const visit = (items) => {
    for (const item of items ?? []) {
      if (item.request) requests.push(item);
      if (item.item) visit(item.item);
    }
  };
  visit(collection.item);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]["x-nodoc-evidence"].observations.map((observation) => observation.status).sort(), [200, 404, 500]);
  assert.doesNotMatch(JSON.stringify(collection), new RegExp(privateMarker));
});
