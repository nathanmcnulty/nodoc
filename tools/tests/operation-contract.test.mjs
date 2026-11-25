import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPublishableEvidenceInput, compareOperationContract, contractObservation,
  mergeContractObservations, normalizeContractShape, operationContract,
} from "../operation-contract.mjs";
import { buildSpecRouteInventory } from "../spec-quality-lib.mjs";

test("real inventory compares documented request, response, status and media variants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-contract-inventory-"));
  try {
    const directory = path.join(root, "nodoc-alpha", "specification");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "openapi.yml"), JSON.stringify({
      openapi: "3.0.1", info: { title: "alpha", version: "1" },
      servers: [{ url: "https://alpha.example" }],
      paths: { "/v1/exact": { get: {
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { cursor: { type: "string" } } } } } },
        responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { tenantId: { type: "string" }, count: { type: "integer" } } } } } } },
      } } },
    }));
    const inventory = await buildSpecRouteInventory({ specificationsRoot: root });
    const contract = inventory[0].operations[0].contract;
    assert.deepEqual(contract.responses[0], { status: "200", mediaType: "application/json", shape: { count: "number", tenantId: "string" } });
    const base = { status: 200, mimeType: "application/json", responseShapeSummary: { tenantId: "string", count: "number" }, responseShapeComplete: true, requestShapeComplete: true, observationId: "obs-one" };
    const compare = (observation) => compareOperationContract(contract, [observation]);
    assert.equal(compare(base).kind, "exact");
    assert.equal(compare({ ...base, responseShapeSummary: { count: "number" } }).kind, "unverified");
    assert.equal(compare({ ...base, responseShapeSummary: { count: "string" } }).kind, "conflict");
    for (const observation of [
      { ...base, status: 404 },
      { ...base, mimeType: "application/problem+json" },
      { ...base, responseShapeSummary: { count: "number", tenantId: "string", newField: "boolean" } },
      { ...base, requestMediaType: "application/json", requestShapeSummary: { cursor: "string", filter: "string" } },
    ]) assert.equal(compare(observation).kind, "enrichment");
    assert.equal(compare({ ...base, responseShapeSummary: null, responseBodyCapture: { state: "omitted" } }).kind, "unverified");
    assert.equal(compare({ ...base, requestMediaType: "application/json", requestShapeSummary: { cursor: "number" } }).kind, "conflict");
    assert.equal(compareOperationContract(contract, []).kind, "unverified");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("contract observations retain distinct semantic errors without publishing values", () => {
  const observations = mergeContractObservations([
    { status: 404, mimeType: "application/json", responseShapeSummary: { error: { code: "string" } }, responseErrorSignature: "a".repeat(64), observationId: "obs-a" },
    { status: 404, mimeType: "application/json", responseShapeSummary: { error: { code: "string" } }, responseErrorSignature: "b".repeat(64), observationId: "obs-b" },
  ]);
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0].errorSignatures[0], observations[1].errorSignatures[0]);
  assert.deepEqual(normalizeContractShape({ value: { array: ["null", "number", "number"] } }), { value: { array: ["null", "number"] } });
  assert.deepEqual(contractObservation({ responseShape: { secret: "actual-secret-value", "person@example.test": "string" }, responseBody: "private" }).responseShape, { "{dynamicProperty}": "unknown", secret: "unknown" });
  const safe = contractObservation({ errorSignatures: ["sensitivecode", "secret_value", "a".repeat(64)], observationIds: ["obs-safe", "Bearer-private", "secret_value", "C:\\private", "https://private"] });
  assert.deepEqual(safe.errorSignatures, ["a".repeat(64)]);
  assert.deepEqual(safe.observationIds, ["obs-safe"]);
  assert.doesNotThrow(() => assertPublishableEvidenceInput({ contractObservations: [safe] }));
  assert.throws(() => assertPublishableEvidenceInput({ contractObservations: [{ ...safe, responseBody: "private" }] }), /noncanonical/);
});

test("composition and identifier-like property keys remain unknown", () => {
  const declared = operationContract({ responses: { 200: { content: { "application/json": { schema: { type: "object", properties: { count: { type: "number" } }, allOf: [{ type: "object" }] } } } } } });
  assert.equal(compareOperationContract(declared, [{ status: 200, mimeType: "application/json", responseShapeSummary: { count: "number" }, responseShapeComplete: true }]).kind, "unverified");
  const observation = contractObservation({ status: 200, mimeType: "application/json", responseShapeComplete: true, responseShapeSummary: { "abcdef01-2345-7abc-9def-0123456789ab": "string", "private.onmicrosoft.com": "number", "person@example.test": "boolean" } });
  assert.deepEqual(observation.responseShape, { "{dynamicProperty}": "unknown" });
  assert.doesNotMatch(JSON.stringify(observation), /abcdef01|private\.onmicrosoft|person@example/u);
  assert.equal(compareOperationContract({ requests: [], responses: [{ status: "200", mediaType: "application/json", shape: {} }] }, [observation]).kind, "unverified");
});

test("bounded contract retention remains explicitly incomplete", () => {
  const observations = mergeContractObservations(Array.from({ length: 140 }, (_, index) => ({
    status: 404, mimeType: "application/json", responseShapeSummary: { error: "string" }, responseErrorSignature: String(index).padStart(64, "0"),
  })));
  assert.equal(observations.length, 128);
  assert.equal(observations.at(-1).omittedVariantCount, 13);
  const comparison = compareOperationContract({ requests: [], responses: [] }, observations);
  assert.equal(comparison.kind, "unverified");
  assert.ok(comparison.reasonCodes.includes("contract-observation-retention-incomplete"));
});

test("partial evidence is unverified and captured empty responses match declared no-content", () => {
  const existing = { requests: [], responses: [{ status: "200", mediaType: "application/json", shape: { count: "number" } }] };
  for (const responseShapeComplete of [false, undefined]) {
    assert.equal(compareOperationContract(existing, [{ status: 200, mimeType: "application/json", responseShapeSummary: { count: "number" }, responseShapeComplete }]).kind, "unverified");
  }
  const empty = { requests: [], responses: [{ status: "204", mediaType: null, shape: "unknown" }] };
  const observation = { status: 204, mimeType: "application/json", responseBodyState: "empty", responseShapeComplete: false };
  assert.equal(compareOperationContract(empty, [observation]).kind, "exact");
  for (const responseBodyState of ["omitted", "unavailable", "unknown"]) {
    assert.equal(compareOperationContract(empty, [{ ...observation, responseBodyState }]).kind, "unverified");
  }
  assert.equal(compareOperationContract({ requests: [], responses: [{ status: "204", mediaType: "application/json", shape: { count: "number" } }] }, [observation]).kind, "unverified");
});
