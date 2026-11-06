import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildRefreshInventory, hasSchemaGap, summarizeRefreshOperation } from "../portal-refresh-inventory.mjs";

const operation = { operationId: "getThings", responses: { 200: { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { enabled: { type: "boolean" } } } } } } } } };
const base = { specId: "alpha", method: "GET", path: "/things", operation, asOf: "2026-11-06T12:00:00Z" };
const observation = { specId: "alpha", method: "GET", path: "/things", observedAt: "2026-11-05T10:00:00Z", health: "healthy-observed", bodyVerified: true, attributed: true, captureComplete: true, evidenceId: "request-1", captureId: "capture-1" };

test("freshness is exact operation scoped and independent of authored annotations", () => {
  const annotated = { ...operation, "x-nodoc-live-capture": { source: "current" } };
  const row = summarizeRefreshOperation({ ...base, operation: annotated, observations: [
    { ...observation, specId: "beta" }, { ...observation, method: "POST" }, { ...observation, path: "/things/{id}" },
  ] });
  assert.equal(row.freshness.status, "not-observed");
  assert.equal(row.schema.evidence, "unknown");
  assert.equal(row.checkedInCaptureAnnotation, "historical-unverified");
  const observed = summarizeRefreshOperation({ ...base, observations: [observation] });
  assert.equal(observed.freshness.status, "current-observation");
  assert.equal(observed.schema.definition, "present-unverified");
  assert.equal(observed.schema.evidence, "complete-body-observed");
  assert.equal(observed.examples.definition, "gap");
});

test("new errors stay current observations and never support endpoint removal", () => {
  const row = summarizeRefreshOperation({ ...base, observations: [observation, { ...observation, evidenceId: "request-404", observedAt: "2026-11-06T11:00:00Z", health: "error-observed", bodyVerified: false }] });
  assert.equal(row.freshness.status, "current-observation");
  assert.equal(row.health.status, "error-observed");
  assert.equal(row.health.removalSupported, false);
  assert.equal(row.freshness.evidenceId, "request-404");
});

test("incomplete captures and missing action attribution cannot refresh an operation", () => {
  for (const overrides of [{ attributed: false }, { attributed: undefined }, { captureComplete: false }, { captureComplete: undefined }]) {
    const row = summarizeRefreshOperation({ ...base, observations: [{ ...observation, ...overrides }] });
    assert.equal(row.freshness.status, "not-observed");
    assert.equal(row.freshness.excludedObservationCount, 1);
    assert.equal(row.health.status, "unknown");
    assert.equal(row.schema.evidence, "unknown");
  }
  const row = summarizeRefreshOperation({ ...base, observations: [
    { ...observation, observedAt: "2026-09-05T10:00:00Z" },
    { ...observation, attributed: false },
  ] });
  assert.equal(row.freshness.status, "stale-observation");
});

test("refresh engine health states retain transport and body uncertainty", () => {
  for (const [health, expected] of [
    ["successful-body-observed", "healthy-observed"], ["no-content-observed", "healthy-observed"],
    ["http-error-observed", "error-observed"], ["semantic-error-observed", "error-observed"],
    ["body-unverified", "incomplete"], ["transport-unverified", "unknown"], ["not-executed", "unknown"],
    ["unrecognized", "unknown"], ["__proto__", "unknown"],
  ]) {
    const row = summarizeRefreshOperation({ ...base, observations: [{ ...observation, health }] });
    assert.equal(row.health.status, expected);
    assert.equal(row.freshness.status, "current-observation");
    assert.equal(row.health.removalSupported, false);
  }
});

test("stale, future, invalid and incomplete observations stay explicit", () => {
  const row = summarizeRefreshOperation({ ...base, observations: [
    { ...observation, observedAt: "2026-09-05T10:00:00Z", health: "incomplete", bodyVerified: false },
    { ...observation, observedAt: "2026-11-07T10:00:00Z" },
    { ...observation, observedAt: "2026-02-30T10:00:00Z" },
    { ...observation, observedAt: "yesterday" },
  ] });
  assert.equal(row.freshness.status, "stale-observation");
  assert.equal(row.freshness.excludedObservationCount, 3);
  assert.equal(row.health.status, "incomplete");
  assert.equal(row.schema.evidence, "unknown");
  assert.throws(() => summarizeRefreshOperation({ ...base, asOf: "2026-02-30" }), /calendar/);
  assert.throws(() => summarizeRefreshOperation({ ...base, freshnessDays: -1 }), /nonnegative/);
});

test("date-only inventories include that day, with timezone-aware timestamps", () => {
  const row = summarizeRefreshOperation({ ...base, asOf: "2026-11-06", observations: [{ ...observation, observedAt: "2026-11-06T23:00:00-01:00" }, { ...observation, observedAt: "2026-11-06T23:00:00Z" }] });
  assert.equal(row.freshness.excludedObservationCount, 1);
  assert.equal(row.freshness.observedAt, "2026-11-06T23:00:00.000Z");
});

test("schema diagnostics preserve unknown shapes and do not invent array items", () => {
  assert.equal(hasSchemaGap({}), true);
  assert.equal(hasSchemaGap({ type: "array", items: {} }), true);
  assert.equal(hasSchemaGap({ type: "object", additionalProperties: true }), true);
  assert.equal(hasSchemaGap({ type: "object", additionalProperties: { type: "string" } }), false);
  assert.equal(hasSchemaGap({ type: "object", properties: { result: {} } }), true);
  assert.equal(hasSchemaGap({ allOf: [{ type: "object", properties: { value: { type: "string" } } }, {}] }), true);
  const noContent = summarizeRefreshOperation({ ...base, operation: { responses: { 204: { description: "No content" } } } });
  assert.equal(noContent.schema.definition, "present-unverified");
  assert.equal(noContent.examples.definition, "present-or-not-applicable");
  const undeclared = summarizeRefreshOperation({ ...base, operation: { responses: { 200: { description: "Unknown" } } } });
  assert.equal(undeclared.schema.definition, "gap");
});

test("inventory does not echo private values or unsafe evidence identifiers", () => {
  const row = summarizeRefreshOperation({ ...base, observations: [{ ...observation, evidenceId: "C:\\private\\body.json", captureId: "https://private.example/capture", body: "private-scalar", sha256: "private-body-fingerprint", byteLength: 987654 }] });
  assert.equal(row.freshness.evidenceId, null);
  assert.equal(row.freshness.captureId, null);
  assert.doesNotMatch(JSON.stringify(row), /private-scalar|private-body-fingerprint|987654|private.example|body.json/);
});

test("portfolio inventory includes every specification and partitions every operation", async () => {
  const inventory = await buildRefreshInventory({ asOf: "2026-11-06" });
  const specDirectories = (await readdir(path.resolve(import.meta.dirname, "../../specifications"), { withFileTypes: true })).filter(entry => entry.isDirectory());
  assert.equal(inventory.summary.specCount, specDirectories.length);
  assert.equal(inventory.summary.recipeCount, new Set(inventory.specs.flatMap(spec => spec.recipes.map(recipe => recipe.recipePath))).size);
  assert.ok(inventory.summary.recipeCount > 0);
  assert.equal(inventory.specs.reduce((sum, spec) => sum + spec.operationCount, 0), inventory.summary.operationCount);
  assert.equal(inventory.summary.notObserved, inventory.summary.operationCount);
  assert.equal(inventory.summary.currentObservations, 0);
  assert.equal(inventory.specs.every(spec => spec.freshness.wholeSpecCurrent === false), true);
  assert.ok(inventory.specs.some(spec => spec.blockers.includes("refresh-approval-expired-or-invalid")));
  assert.ok(inventory.specs.some(spec => spec.evidenceFiles.length > 0));
  assert.ok(inventory.specs.flatMap(spec => spec.recipes).some(recipe => recipe.disposition === "evaluated-with-gaps"));
  assert.doesNotMatch(JSON.stringify(inventory), /recipeSha256|byteLength|proposalSha256|artifactSha256/);
});
