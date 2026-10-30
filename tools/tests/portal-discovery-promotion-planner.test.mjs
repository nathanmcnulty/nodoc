import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSpecRouteInventory } from "../spec-quality-lib.mjs";
import { compareOperationContract, contractObservation, mergeContractObservations, normalizeContractShape, operationContract } from "../operation-contract.mjs";
import { buildObservation, buildSpecContext, aggregateCandidates } from "../generate-crawl-candidates.mjs";
import { buildPartitionedCandidateHandoff } from "../discovery-candidate-handoff.mjs";
import { buildReviewAssignmentPlan } from "../discovery-review-assignments.mjs";

import {
  compilePromotionPlan,
  promotionDigest,
  validatePromotionPlan,
  validatePromotionResult,
} from "../portal-discovery-promotion-planner.mjs";

const inventory = [
  { specId: "alpha", specPath: "specifications/nodoc-alpha/specification/openapi.yml", operations: [
    { method: "GET", path: "/v1/exact" },
    { method: "POST", path: "/v1/extend" },
  ] },
  { specId: "beta", specPath: "specifications/nodoc-beta/specification/openapi.yml", operations: [] },
];

function handoff(overrides = {}) {
  const candidates = overrides.candidates ?? [
    { candidateId: "exact", evidenceFamilyId: "ev-exact", evidence: "confirmed", documentationStatus: "documented", method: "GET", normalizedPath: "/v1/exact" },
    { candidateId: "extend", evidenceFamilyId: "ev-extend", evidence: "confirmed", documentationStatus: "undocumented", method: "PUT", normalizedPath: "/v1/extend" },
    { candidateId: "new", evidenceFamilyId: "ev-new", evidence: "successfully-probed", documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/new" },
  ];
  return {
    manifest: { totals: { candidateCount: candidates.length, evidenceFamilyCount: new Set(candidates.map((entry) => entry.evidenceFamilyId)).size }, sharedMetadata: {
      recovery: { captureComplete: true }, interactionHealthStatus: { available: true, accounting: { consistent: true } }, saturation: { eligibility: "known" },
    } },
    partitions: [{ destination: { specId: overrides.destinationSpec ?? "alpha", hostFamily: "alpha.example" }, reviewClass: overrides.reviewClass ?? "confirmed-read", candidates }],
  };
}

function approved(plan, candidateIds = ["extend", "new"]) {
  const assignment = plan.assignments[0];
  return [{ assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, sourceHandoffDigest: plan.sourceHandoffDigest, assignmentType: "promotion-preparation", status: "completed", decision: "accept", reasonCodes: ["approved"], candidateAccounting: { accepted: candidateIds, rejected: [], escalated: [], blocked: [] } }];
}

test("maps exact, extension, and new candidates with stable focused grouping", () => {
  const first = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: [] });
  const plan = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: approved(first) });
  assert.deepEqual(plan, compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: approved(first) }));
  assert.equal(plan.mappings.find((entry) => entry.candidateId === "exact").outcome, "already-documented");
  assert.equal(plan.mappings.find((entry) => entry.candidateId === "extend").mapping, "extension");
  assert.equal(plan.mappings.find((entry) => entry.candidateId === "new").mapping, "novel");
  assert.equal(plan.measurements.expectedPrCount, 1);
  validatePromotionPlan(plan);
});

test("rejects adjacent, suppressed, bundle-only, and incomplete health", () => {
  for (const [reviewClass, evidence, expected] of [["adjacent-confirmed-read", "confirmed", "adjacent-scope"], ["suppressed", "confirmed", "suppressed-candidate"], ["bundle-only", "bundle-discovered", "bundle-only-candidate"]]) {
    const plan = compilePromotionPlan({ groupedHandoff: handoff({ reviewClass, candidates: [{ candidateId: "x", evidenceFamilyId: "ev-x", evidence, documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/x" }] }), specInventory: inventory });
    assert.ok(plan.mappings[0].reasonCodes.includes(expected));
  }
  const incomplete = handoff();
  incomplete.manifest.sharedMetadata.recovery.captureComplete = false;
  assert.equal(compilePromotionPlan({ groupedHandoff: incomplete, specInventory: inventory }).mappings[0].reasonCodes[0], "incomplete-health");
});

test("preserves multi-evidence traceability and routes ambiguous destinations", () => {
  const grouped = handoff({ destinationSpec: "unassigned", candidates: [{ candidateId: "multi", evidenceIds: ["ev-a", "ev-b"], evidenceFamilyId: "ev-a", evidence: "confirmed", documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/multi" }] });
  const plan = compilePromotionPlan({ groupedHandoff: grouped, specInventory: inventory });
  assert.deepEqual(plan.mappings[0].evidenceIds, ["ev-a", "ev-b"]);
  assert.ok(plan.mappings[0].reasonCodes.includes("ambiguous-destination"));
  assert.equal(plan.measurements.exactTraceabilityCount, 1);
  assert.doesNotMatch(JSON.stringify(plan), /tenant|bearer|cookie|https?:\/\//i);
});

test("validates promotion result capability and exact cardinality", () => {
  const initial = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory });
  const plan = compilePromotionPlan({ groupedHandoff: handoff(), specInventory: inventory, workerResults: approved(initial) });
  const assignment = plan.assignments[0];
  const result = { assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, sourceHandoffDigest: plan.sourceHandoffDigest, assignmentType: "promotion-preparation", status: "completed", decision: "accept", candidateAccounting: { accepted: assignment.candidateIds, rejected: [], escalated: [], blocked: [] } };
  assert.equal(validatePromotionResult({ schemaVersion: 1, ...result }, plan).sanitized, true);
  assert.throws(() => validatePromotionResult({ schemaVersion: 1, ...result, sourceHandoffDigest: undefined }, plan), /evidence binding/);
  assert.throws(() => validatePromotionResult({ schemaVersion: 1, ...result, candidateAccounting: { accepted: ["extend"], rejected: [], escalated: [], blocked: [] } }, plan), /exact/);
  assert.equal(typeof promotionDigest(plan), "string");
});

test("fails closed on incompatible schemas and promotion budgets", () => {
  const input = { groupedHandoff: handoff(), specInventory: inventory, workerResults: [] };
  input.budgets = { maxChanges: 1, maxPrs: 1, maxFiles: 1 };
  input.groupedHandoff.partitions.push({
    ...input.groupedHandoff.partitions[0],
    destination: { specId: "missing-spec", hostFamily: "service" },
    candidates: [{ candidateId: "conflict", evidenceFamilyId: "ev-conflict", evidence: "confirmed", documentationStatus: "undocumented", method: "GET", normalizedPath: "/v1/conflict", responseShapeFingerprint: "changed" }],
  });
  input.groupedHandoff.manifest.totals.candidateCount += 2;
  input.groupedHandoff.manifest.totals.evidenceFamilyCount += 2;
  assert.throws(() => compilePromotionPlan(input), /candidate cardinality|evidence cardinality|digest/i);
});

test("real spec inventory compares documented response, request, status and media variants", async () => {
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
    const specInventory = await buildSpecRouteInventory({ specificationsRoot: root });
    assert.deepEqual(specInventory[0].operations[0].contract.responses[0], {
      status: "200", mediaType: "application/json", shape: { count: "number", tenantId: "string" },
    });
    const candidate = (observation) => handoff({ candidates: [{
      candidateId: "observed", evidenceFamilyId: "ev-observed", evidence: "confirmed", documentationStatus: "documented", method: "GET", normalizedPath: "/v1/exact", originBindingId: createHash("sha256").update("https://alpha.example").digest("hex"), contractObservations: [contractObservation(observation)],
    }] });
    const mapping = (observation, extra = {}) => compilePromotionPlan({ groupedHandoff: candidate(observation), specInventory, ...extra }).mappings[0];
    const base = { status: 200, mimeType: "application/json", responseShapeSummary: { tenantId: "string", count: "number" }, responseShapeComplete: true, requestShapeComplete: true, observationId: "obs-one" };
    assert.equal(mapping(base).outcome, "already-documented");
    // Missing optional fields in one sample do not prove a contract changed.
    assert.equal(mapping({ ...base, responseShapeSummary: { count: "number" } }).mapping, "unverified");
    const conflict = mapping({ ...base, responseShapeSummary: { count: "string" } });
    assert.equal(conflict.outcome, "blocked");
    assert.ok(conflict.reasonCodes.includes("architecture-schema-conflict"));
    assert.deepEqual(conflict.contractObservations[0].observationIds, ["obs-one"]);
    for (const observation of [
      { ...base, status: 404 },
      { ...base, mimeType: "application/problem+json" },
      { ...base, responseShapeSummary: { count: "number", newField: "boolean" } },
      { ...base, requestMediaType: "application/json", requestShapeSummary: { cursor: "string", filter: "string" } },
    ]) {
      const result = mapping(observation);
      assert.equal(result.mapping, "enrichment");
      assert.equal(result.outcome, "blocked");
      assert.ok(result.reasonCodes.includes("manual-approval-required"));
      assert.equal(mapping(observation, { workerResults: [{ status: "completed", decision: "accept", sourceHandoffDigest: promotionDigest(candidate(observation)), candidateAccounting: { accepted: ["observed"] } }] }).outcome, "proposed");
    }
    assert.equal(mapping({ ...base, responseShapeSummary: null, responseBodyCapture: { state: "omitted", reason: "size-limit" } }).mapping, "unverified");
    assert.ok(mapping({ ...base, requestMediaType: "application/json", requestShapeSummary: { cursor: "number" } }).reasonCodes.includes("architecture-schema-conflict"));
    const wrongHost = candidate(base);
    wrongHost.partitions[0].destination.hostFamily = "other.example";
    assert.ok(compilePromotionPlan({ groupedHandoff: wrongHost, specInventory }).mappings[0].reasonCodes.includes("architecture-host-binding-conflict"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("contract observations preserve distinct semantic errors without publishing values", () => {
  const observations = mergeContractObservations([
    { status: 404, mimeType: "application/json", responseShapeSummary: { error: { code: "string" } }, responseErrorSignature: "a".repeat(64), observationId: "obs-a" },
    { status: 404, mimeType: "application/json", responseShapeSummary: { error: { code: "string" } }, responseErrorSignature: "b".repeat(64), observationId: "obs-b" },
  ]);
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0].errorSignatures[0], observations[1].errorSignatures[0]);
  assert.deepEqual(normalizeContractShape({ value: { array: ["null", "number", "number"] } }), { value: { array: ["null", "number"] } });
  assert.deepEqual(contractObservation({ responseShape: { secret: "actual-secret-value", "person@example.test": "string" }, responseBody: "private" }).responseShape, { "{dynamicProperty}": "unknown", secret: "unknown" });
  assert.doesNotMatch(JSON.stringify(contractObservation({ responseBody: "private", errorSignature: "https://private.example" })), /private|https/u);
  const safe = contractObservation({ errorSignatures: ["sensitivecode", "secret_value", "a".repeat(64)], observationIds: ["obs-safe", "Bearer-private", "secret_value", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJwZXJzb24ifQ.signature", "C:\\private", "https://private"] });
  assert.deepEqual(safe.errorSignatures, ["a".repeat(64)]);
  assert.deepEqual(safe.observationIds, ["obs-safe"]);
});

test("composition and identifier-like property keys remain unknown", () => {
  const declared = operationContract({ responses: { 200: { content: { "application/json": { schema: { type: "object", properties: { count: { type: "number" } }, allOf: [{ type: "object", properties: { enabled: { type: "boolean" } } }] } } } } } });
  const result = compareOperationContract(declared, [{ status: 200, mimeType: "application/json", responseShapeSummary: { count: "number" }, responseShapeComplete: true }]);
  assert.equal(result.kind, "unverified");
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

test("production generator and handoff isolate origins sharing a sanitized host family", () => {
  const context = buildSpecContext({ specId: "alpha", title: "alpha", serverUrls: ["https://{tenant}-admin.sharepoint.com"], pathPrefixes: ["/_api/"], operations: [] });
  const candidates = aggregateCandidates(["alpha", "beta"].map((name) => buildObservation({
    method: "GET", path: "/_api/items", url: `https://${name}-admin.sharepoint.com/_api/items`, status: 200,
    mimeType: "application/json", responseShapeSummary: { count: "number" }, responseShapeComplete: true,
  }, "api-records.json", "confirmed")), context, false);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].hostFamily, candidates[1].hostFamily);
  assert.notEqual(candidates[0].originBindingId, candidates[1].originBindingId);
  const grouped = buildPartitionedCandidateHandoff({
    schemaVersion: 1, spec: { id: "alpha" }, confirmedReadCandidates: candidates,
    confirmedSafetyReviewCandidates: [], successfullyProbedCandidates: [], bundleOnlyCandidates: [], suppressedCandidates: [],
    adjacentConfirmedReadCandidates: [], adjacentConfirmedSafetyReviewCandidates: [], adjacentSuccessfullyProbedCandidates: [], adjacentBundleOnlyCandidates: [],
  });
  const entries = grouped.partitions.flatMap((partition) => partition.candidates);
  assert.equal(new Set(entries.map((entry) => entry.candidateId)).size, 2);
  assert.equal(new Set(entries.map((entry) => entry.evidenceFamilyId)).size, 2);
  assert.equal(grouped.manifest.totals.evidenceFamilyCount, 2);
  assert.doesNotMatch(JSON.stringify(grouped), /alpha-admin|beta-admin/u);
});

test("partial or legacy shape evidence cannot be classified as an exact contract", () => {
  const existing = { requests: [], responses: [{ status: "200", mediaType: "application/json", shape: { count: "number" } }] };
  for (const responseShapeComplete of [false, undefined]) {
    const result = compareOperationContract(existing, [{ status: 200, mimeType: "application/json", responseShapeSummary: { count: "number" }, responseShapeComplete }]);
    assert.equal(result.kind, "unverified");
    assert.ok(result.reasonCodes.includes("contract-evidence-incomplete"));
  }
});

test("captured empty responses match declared no-content without implying populated schema evidence", () => {
  const existing = { requests: [], responses: [{ status: "204", mediaType: null, shape: "unknown" }] };
  const observation = { status: 204, mimeType: "application/json", responseBodyState: "empty", responseShapeComplete: false };
  assert.equal(compareOperationContract(existing, [observation]).kind, "exact");
  for (const responseBodyState of ["omitted", "unavailable", "unknown"]) {
    assert.equal(compareOperationContract(existing, [{ ...observation, responseBodyState }]).kind, "unverified");
  }
  const populated = { requests: [], responses: [{ status: "204", mediaType: "application/json", shape: { count: "number" } }] };
  assert.equal(compareOperationContract(populated, [observation]).kind, "unverified");
});

test("actual candidate pipeline compares parameter aliases and blocks ambiguous host-scoped templates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-promotion-templates-"));
  try {
    const directory = path.join(root, "nodoc-alpha", "specification");
    await mkdir(directory, { recursive: true });
    const operation = {
      responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { count: { type: "number" } } } } } } },
    };
    const specification = {
      openapi: "3.0.1", info: { title: "alpha", version: "1" }, servers: [{ url: "https://alpha.example/service" }],
      paths: { "/items/{itemId}": { get: operation } },
    };
    const plan = async (origin = "https://alpha.example", basePath = "/service") => {
      await writeFile(path.join(directory, "openapi.yml"), JSON.stringify(specification));
      const specInventory = await buildSpecRouteInventory({ specificationsRoot: root });
      const observations = [buildObservation({ method: "GET", url: `${origin}${basePath}/items/12345`, status: 200, mimeType: "application/json", responseShapeSummary: { count: "string" }, responseShapeComplete: true, observationId: "obs-template" }, "api-records.json", "confirmed")];
      const candidates = aggregateCandidates(observations, buildSpecContext(specInventory[0]), false);
      assert.equal(candidates[0].normalizedPath, `${basePath}/items/{id}`);
      assert.equal(candidates[0].documentationStatus, "documented");
      const groupedHandoff = buildPartitionedCandidateHandoff({
        schemaVersion: 1, spec: { id: "alpha" }, ...handoff().manifest.sharedMetadata,
        confirmedReadCandidates: candidates, confirmedSafetyReviewCandidates: [], successfullyProbedCandidates: [], bundleOnlyCandidates: [], suppressedCandidates: [],
        adjacentConfirmedReadCandidates: [], adjacentConfirmedSafetyReviewCandidates: [], adjacentSuccessfullyProbedCandidates: [], adjacentBundleOnlyCandidates: [],
      });
      return compilePromotionPlan({ groupedHandoff, specInventory }).mappings[0];
    };
    const drift = await plan();
    assert.equal(drift.mapping, "conflict");
    assert.equal(drift.outcome, "blocked");
    assert.ok(drift.reasonCodes.includes("architecture-schema-conflict"));
    assert.deepEqual(drift.contractObservations[0].observationIds, ["obs-template"]);
    assert.ok((await plan("http://alpha.example:8080")).reasonCodes.includes("architecture-origin-binding-conflict"));
    assert.equal((await plan("https://alpha.example", "")).mapping, "novel", "server base path cannot become an implicit root alias");
    specification.paths["/items/{anotherId}"] = { get: { ...operation, servers: [{ url: "https://other.example/service" }] } };
    assert.ok((await plan()).reasonCodes.includes("architecture-schema-conflict"));
    specification.paths["/items/{anotherId}"].get.servers = [{ url: "https://alpha.example/service" }];
    const ambiguous = await plan();
    assert.equal(ambiguous.outcome, "blocked");
    assert.ok(ambiguous.reasonCodes.includes("ambiguous-operation-template"));
    assert.ok(!ambiguous.reasonCodes.includes("add-new"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("approval binds the full current evidence and current review assignment", () => {
  const groupedHandoff = buildPartitionedCandidateHandoff({
    schemaVersion: 1, spec: { id: "alpha" }, ...handoff().manifest.sharedMetadata,
    confirmedReadCandidates: [{ candidateId: "new", evidenceFamilyId: "ev-new", method: "GET", normalizedPath: "/v1/new", hostFamily: "alpha.example", evidence: "confirmed", documentationStatus: "undocumented", contractObservations: [contractObservation({ status: 200, mimeType: "application/json", responseShapeSummary: { count: "number" }, responseShapeComplete: true })] }],
    confirmedSafetyReviewCandidates: [], successfullyProbedCandidates: [], bundleOnlyCandidates: [], suppressedCandidates: [],
    adjacentConfirmedReadCandidates: [], adjacentConfirmedSafetyReviewCandidates: [], adjacentSuccessfullyProbedCandidates: [], adjacentBundleOnlyCandidates: [],
  });
  const reviewPlan = buildReviewAssignmentPlan(groupedHandoff);
  const assignment = reviewPlan.assignments[0];
  assert.equal(reviewPlan.sourceHandoffDigest, promotionDigest(groupedHandoff));
  assert.equal(assignment.sourceHandoffDigest, reviewPlan.sourceHandoffDigest);
  assert.throws(() => compilePromotionPlan({ groupedHandoff, specInventory: inventory, reviewPlan: { ...reviewPlan, assignments: reviewPlan.assignments.map((entry) => ({ ...entry, sourceHandoffDigest: "incorrect" })) } }), /evidence binding mismatch/);
  const result = { status: "completed", decision: "accept", assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, sourceHandoffDigest: assignment.sourceHandoffDigest, candidateAccounting: { accepted: ["new"] } };
  const compile = (handoffValue, resultValue, reviewValue = null) => compilePromotionPlan({ groupedHandoff: handoffValue, specInventory: inventory, reviewPlan: reviewValue, workerResults: [resultValue] });
  assert.equal(compile(groupedHandoff, result, reviewPlan).mappings[0].outcome, "proposed");
  const changed = structuredClone(groupedHandoff);
  changed.partitions[0].candidates[0].contractObservations[0].responseShape.count = "string";
  const stale = compile(changed, result);
  assert.equal(stale.mappings[0].outcome, "blocked");
  assert.ok(stale.mappings[0].reasonCodes.includes("approval-evidence-binding-mismatch"));
  assert.notEqual(stale.sourceHandoffDigest, result.sourceHandoffDigest);
  const current = { ...result, sourceHandoffDigest: promotionDigest(changed) };
  assert.equal(compile(changed, current).mappings[0].outcome, "proposed");
  assert.ok(compile(changed, current, reviewPlan).mappings[0].reasonCodes.includes("approval-assignment-mismatch"));
  assert.ok(compile(groupedHandoff, { ...result, sourceHandoffDigest: undefined }).mappings[0].reasonCodes.includes("approval-evidence-binding-required"));
  assert.ok(compile(groupedHandoff, { ...result, assignmentDigest: "incorrect" }, reviewPlan).mappings[0].reasonCodes.includes("approval-assignment-mismatch"));
  assert.ok(compile(groupedHandoff, { ...result, candidateAccounting: { accepted: ["new", "outside-partition"] } }, reviewPlan).mappings[0].reasonCodes.includes("approval-assignment-mismatch"));
});
