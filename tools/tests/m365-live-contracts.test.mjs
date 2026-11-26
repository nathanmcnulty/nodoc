import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import YAML from "yaml";

const base = new URL("../../specifications/nodoc-m365-admin/", import.meta.url);
const root = YAML.parse(await readFile(new URL("specification/openapi.yml", base), "utf8"));
const evidence = JSON.parse(await readFile(new URL("evidence/live-refresh-20261126.json", base), "utf8"));
const entries = await Promise.all(evidence.operations.map(async entry => {
  const reference = root.paths[entry.path]?.$ref;
  assert.ok(reference, `Missing root reference for ${entry.path}`);
  const [filename, pointer] = reference.split("#");
  assert.equal(pointer, `/paths/${entry.path.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  const document = YAML.parse(await readFile(new URL(`specification/${filename}`, base), "utf8"));
  return { ...entry, document, operation: document.paths[entry.path][entry.method.toLowerCase()] };
}));

function resolveSchema(document, schema) {
  return schema?.$ref ? document.components.schemas[schema.$ref.split("/").at(-1)] : schema;
}

function* schemaNodes(schema) {
  yield schema;
  for (const child of Object.values(schema.properties ?? {})) yield* schemaNodes(child);
  if (schema.items) yield* schemaNodes(schema.items);
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") yield* schemaNodes(schema.additionalProperties);
  for (const child of schema.anyOf ?? []) yield* schemaNodes(child);
}

test("M365 live publication accounts for all 15 candidates as ten operations and two telemetry exclusions", () => {
  assert.equal(entries.length, 10);
  assert.equal(new Set(entries.map(entry => entry.operationId)).size, 10);
  const disposition = evidence.candidateDisposition;
  assert.equal(disposition.undocumentedQueueEntries,
    entries.length + disposition.templatedProductEntries - 1 + disposition.excludedTelemetry.length);
  assert.deepEqual(disposition.excludedTelemetry, ["GET /api/supportlog/WriteLog", "POST /api/supportlog/PostLogBatch"]);
  assert.ok(entries.every(entry => !entry.path.includes("/api/supportlog/")));
  assert.equal(root.servers[0].url, "https://admin.cloud.microsoft");
});

test("each published operation binds its observed method, parameters, statuses and action-attributed evidence", () => {
  for (const entry of entries) {
    const { operation } = entry;
    assert.equal(operation.operationId, entry.operationId);
    assert.equal(operation["x-nodoc-evidence"].record, "../evidence/live-refresh-20261126.json");
    assert.equal(operation["x-nodoc-operation-context"].behavior.methodKnowledge, "observed");
    const existence = operation["x-nodoc-operation-context"].automationEvidence.existence;
    assert.equal(existence.state, "verified");
    assert.deepEqual(existence.observationIds, entry.observations.map(item => item.observationId));
    assert.equal(existence.verifiedAt, entry.observations.map(item => item.observedAt).sort().at(-1));
    assert.ok(entry.observations.every(item => item.actionIndex >= 0 && Number.isFinite(Date.parse(item.observedAt))));
    assert.deepEqual(Object.keys(operation.responses).sort(),
      [...new Set(entry.observations.map(item => String(item.httpStatus)))].sort());
    assert.deepEqual((operation.parameters ?? []).filter(item => item.in === "query").map(item => item.name).sort(),
      entry.observedQueryParameters);
    assert.equal(operation.servers, undefined);
  }
});

test("incomplete support responses retain MIME and status without promoting truncated previews into schemas", () => {
  const incomplete = entries.filter(entry => !entry.responseSchemaPublished);
  assert.equal(incomplete.length, 6);
  for (const entry of incomplete) {
    assert.ok(entry.observations.every(item => !item.completeSidecarVerified && item.responseBodyState === "truncated"));
    assert.deepEqual(entry.operation.responses["200"].content, { "application/json": {} });
    assert.match(entry.operation.responses["200"].description, /incomplete/);
  }
});

test("marketplace product URLs are templated and preserve both successful and error responses", () => {
  const entry = entries.find(item => item.operationId === "Billing.GetMarketplaceProduct");
  assert.equal(entry.path, "/fd/arm/providers/Microsoft.Billing/billingAccounts/{billingAccountId}/providers/Microsoft.Marketplace/products/{productId}");
  assert.equal(entry.observations.length, 4);
  assert.deepEqual(entry.operation.parameters.filter(item => item.in === "path").map(item => [item.name, item.required]),
    [["billingAccountId", true], ["productId", true]]);
  assert.deepEqual(Object.keys(entry.operation.responses), ["200", "404"]);
  const schema = resolveSchema(entry.document, entry.operation.responses["200"].content["application/json"].schema);
  const benefit = schema.properties.plans.items.properties.benefits.items;
  assert.equal(benefit.properties.billingPlan.type, "string");
  assert.equal(benefit.properties.billingPlan.nullable, true);
  assert.equal(schema.properties.attributes.type, undefined);
  assert.match(schema.properties.attributes.description, /Only null/);
});

test("observed schemas retain string flags, unknown empty arrays and deeply nested request fields", () => {
  const feature = entries.find(item => item.operationId === "Features.GetAgent365Config").document.components.schemas.Agent365Config;
  assert.equal(feature.properties.EnableAgentXConvergence.type, "string");
  assert.deepEqual(feature.properties.Rules.properties.AllowedScheduledActions.items, {});
  const edge = entries.find(item => item.operationId === "Edge.AnalyzeReleaseNotes").document.components.schemas.EdgeReleaseNotesAnalysisRequest;
  assert.deepEqual(edge.properties.deployedEdgePolicies.additionalProperties, { type: "string" });
  assert.equal(edge.properties.deployedEdgePolicies.properties, undefined);
  const request = entries.find(item => item.operationId === "Search.GetPortalSuggestions").document.components.schemas.PortalSuggestionsRequest;
  assert.equal(request.properties.EntityRequests.items.properties.Filter.properties.And.items.properties.Or.items.properties.Term.properties.Product.type, "string");
});

test("new schemas do not invent requiredness, enums, formats or captured examples", () => {
  const schemas = new Set();
  for (const entry of entries.filter(item => item.responseSchemaPublished)) {
    assert.ok(entry.observations.every(item => item.completeSidecarVerified));
    for (const response of Object.values(entry.operation.responses)) {
      schemas.add(resolveSchema(entry.document, response.content["application/json"].schema));
    }
    if (entry.operation.requestBody) {
      assert.equal(entry.operation.requestBody.required, undefined);
      assert.equal(entry.operation["x-nodoc-operation-safety"], undefined);
      schemas.add(resolveSchema(entry.document, entry.operation.requestBody.content["application/json"].schema));
    }
  }
  for (const schema of schemas) {
    for (const node of schemaNodes(schema)) {
      for (const key of ["required", "enum", "format", "example", "examples", "default"]) assert.equal(node[key], undefined);
      if (node.nullable) assert.ok(node.type);
    }
  }
});
