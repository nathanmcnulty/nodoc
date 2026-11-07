import assert from "node:assert/strict";
import test from "node:test";
import { deriveNoveltyBaseline } from "../portal-discovery-novelty.mjs";

import {
  buildKnownOperationRefreshPlan,
  buildGraphQlOperationDefinitionDigest,
  buildReviewPacket,
  evaluateEvidenceAxes,
  evaluateKnownOperationRefreshEvidence,
  validateRepresentativeStateMatrix,
} from "../portal-discovery-evidence-contract.mjs";

const digest = "a".repeat(64);
const persistedQueryHash = "c".repeat(64);
const graphQlDefinitionDigest = buildGraphQlOperationDefinitionDigest({
  operationNames: ["KnownSettingsQuery"],
  operationKind: "query",
  persistedQuerySha256Hashes: [persistedQueryHash],
});
function recipe(overrides = {}) {
  return {
    url: "https://admin.example.com/home",
    matchHosts: ["admin.example.com"],
    inspectionPolicy: { mode: "observe-only", prohibitedControlPatterns: ["Save"] },
    actions: ["navigate=https://admin.example.com/settings", "wait-ms=1", "capture=known"],
    knownOperationRefresh: {
      status: "active",
      method: "GET",
      host: "admin.example.com",
      routes: ["/api/settings"],
      state: "settings after passive reload",
      actionIndexes: [0, 2],
      approvalArtifact: "tools/frontier-approvals/test.json",
      approvalDigest: digest,
      approvalExpiresAt: "2099-01-01T00:00:00.000Z",
      variableBindingsDigest: digest,
      documentationObjectives: ["response-example"],
      evidenceIds: ["evidence-old"],
    },
    ...overrides,
  };
}

const productionActionResults = [
  {
    actionIndex: 0,
    type: "navigate",
    value: "https://admin.example.com/settings",
    result: { resolvedUrl: "https://admin.example.com/settings", url: "https://admin.example.com/settings" },
  },
  { actionIndex: 2, type: "capture", value: "known", result: { capturedOnly: true } },
];

test("known-operation refresh binds resolved entry, actions, policy, variables, and bundled ownership", () => {
  const plan = buildKnownOperationRefreshPlan(recipe({ __resolvedVariableBindingsDigest: digest }), {
    required: true,
    baselineOperations: [{ method: "GET", path: "/api/settings", hosts: ["admin.example.com"] }],
  });
  assert.equal(plan.kind, "known-operation-refresh");
  assert.equal(plan.entryUrl, "https://admin.example.com/settings");
  assert.equal(plan.actionBindings.length, 2);
  assert.equal(plan.policy.mode, "observe-only");
  assert.throws(() => buildKnownOperationRefreshPlan(recipe({ __resolvedVariableBindingsDigest: "b".repeat(64) }), { required: true }), /variable binding digest mismatch/);
  assert.throws(() => buildKnownOperationRefreshPlan(recipe(), { required: true, baselineOperations: [{ method: "GET", path: "/other", hosts: ["admin.example.com"] }] }), /not owned/);
});

test("passively observed POST refreshes are representable without authorizing a POST probe", () => {
  const value = recipe();
  value.knownOperationRefresh.method = "POST";
  const plan = buildKnownOperationRefreshPlan(value, { baselineOperations: [{ method: "POST", path: "/api/settings", hosts: ["admin.example.com"] }] });
  assert.equal(plan.method, "POST");
  assert.equal(plan.actionBindings.some((action) => action.type === "probe-get"), false);
});

test("known-operation ownership binds wire paths to the matching server base path", () => {
  const baseline = deriveNoveltyBaseline({
    servers: [{ url: "https://admin.example.com/api" }],
    paths: { "/settings": { get: { responses: {} } } },
  });
  assert.equal(buildKnownOperationRefreshPlan(recipe(), { baselineOperations: baseline.operations }).routes[0], "/api/settings");
  for (const route of ["/settings", "/apiproxy/settings", "/api/api/settings"]) {
    const value = recipe();
    value.knownOperationRefresh.routes = [route];
    assert.throws(() => buildKnownOperationRefreshPlan(value, { baselineOperations: baseline.operations }), /not owned/);
  }
  const otherHost = deriveNoveltyBaseline({
    servers: [{ url: "https://other.example.com/api" }],
    paths: { "/settings": { get: { responses: {} } } },
  });
  assert.throws(() => buildKnownOperationRefreshPlan(recipe(), { baselineOperations: otherHost.operations }), /not owned/);
  const crossBindings = [{ method: "GET", path: "/settings", hosts: ["admin.example.com", "other.example.com"], serverBindings: [
    { host: "admin.example.com", basePath: "/other" },
    { host: "other.example.com", basePath: "/api" },
  ] }];
  assert.throws(() => buildKnownOperationRefreshPlan(recipe(), { baselineOperations: crossBindings }), /not owned/);
  const templated = deriveNoveltyBaseline({
    servers: [{ url: "https://admin.example.com/api" }],
    paths: { "/providers/{provider}/settings": { get: { responses: {} } } },
  });
  const concrete = recipe();
  concrete.knownOperationRefresh.routes = ["/api/providers/observed-provider/settings"];
  assert.equal(buildKnownOperationRefreshPlan(concrete, { baselineOperations: templated.operations }).routes[0], "/api/providers/observed-provider/settings");
  for (const route of ["/api/providers/observed-provider/settings/extra", "/api/providers/nested/provider/settings"]) {
    concrete.knownOperationRefresh.routes = [route];
    assert.throws(() => buildKnownOperationRefreshPlan(concrete, { baselineOperations: templated.operations }), /not owned/);
  }
});

test("GraphQL refreshes require and match an exact persisted operation name", () => {
  const value = recipe();
  value.knownOperationRefresh.method = "POST";
  value.knownOperationRefresh.routes = ["/graphql"];
  assert.throws(() => buildKnownOperationRefreshPlan(value), /operationNames/);
  value.knownOperationRefresh.operationNames = ["KnownSettingsQuery"];
  assert.throws(() => buildKnownOperationRefreshPlan(value), /operationKind=query/);
  value.knownOperationRefresh.operationKind = "query";
  assert.throws(() => buildKnownOperationRefreshPlan(value), /persisted-query or literal-query hash/);
  value.knownOperationRefresh.persistedQuerySha256Hashes = [persistedQueryHash];
  assert.throws(() => buildKnownOperationRefreshPlan(value), /operationDefinitionDigest/);
  value.knownOperationRefresh.operationDefinitionDigest = graphQlDefinitionDigest;
  const plan = buildKnownOperationRefreshPlan(value);
  const actionResults = productionActionResults;
  const common = { method: "POST", url: "https://admin.example.com/graphql", status: 200, attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) }, responseBodyForAnalysis: '{"data":{}}' };
  assert.equal(evaluateKnownOperationRefreshEvidence({ plan, actionResults, apiRecords: [{ ...common, graphQlOperationName: "OtherQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash }] }).status, "no-target-signal");
  assert.equal(evaluateKnownOperationRefreshEvidence({ plan, actionResults, apiRecords: [{ ...common, graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: "d".repeat(64) }] }).status, "no-target-signal");
  assert.equal(evaluateKnownOperationRefreshEvidence({ plan, actionResults, apiRecords: [{ ...common, graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash }] }).status, "observed");
});

test("malformed GraphQL errors values are incomplete even when empty or falsy", () => {
  const value = recipe();
  value.knownOperationRefresh.method = "POST";
  value.knownOperationRefresh.routes = ["/graphql"];
  value.knownOperationRefresh.operationNames = ["KnownSettingsQuery"];
  value.knownOperationRefresh.operationKind = "query";
  value.knownOperationRefresh.persistedQuerySha256Hashes = [persistedQueryHash];
  value.knownOperationRefresh.operationDefinitionDigest = graphQlDefinitionDigest;
  const plan = buildKnownOperationRefreshPlan(value);
  const record = responseBodyForAnalysis => ({
    method: "POST", url: "https://admin.example.com/graphql", status: 200,
    graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash,
    attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: digest },
    responseBodyForAnalysis: JSON.stringify(responseBodyForAnalysis),
  });
  const malformed = [
    ["empty object", { data: {}, errors: {} }],
    ["empty string", { data: {}, errors: "" }],
    ["false", { data: {}, errors: false }],
    ["zero", { data: {}, errors: 0 }],
    ["non-empty object", { data: {}, errors: { message: "invalid shape" } }],
    ["non-empty string", { data: {}, errors: "invalid shape" }],
  ];
  for (const [label, body] of malformed) {
    const evidence = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults, apiRecords: [record(body)] });
    assert.equal(evidence.status, "capture-incomplete", label);
    assert.equal(evidence.successfulRecordCount, 0, label);
    assert.equal(evidence.health.status, "incomplete", label);
    assert.equal(evidence.health.unverifiedGraphQlRecordCount, 1, label);
  }
  const compatible = [
    ["absent", { data: {} }],
    ["null", { data: {}, errors: null }],
    ["empty array", { data: {}, errors: [] }],
  ];
  for (const [label, body] of compatible) {
    const evidence = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults, apiRecords: [record(body)] });
    assert.equal(evidence.status, "observed", label);
    assert.equal(evidence.successfulRecordCount, 1, label);
    assert.equal(evidence.health.status, "healthy-observed", label);
    assert.equal(evidence.health.unverifiedGraphQlRecordCount, 0, label);
  }
});
test("HTTP 200 GraphQL errors are error evidence rather than healthy usage", () => {
  const value = recipe();
  value.knownOperationRefresh.method = "POST";
  value.knownOperationRefresh.routes = ["/graphql"];
  value.knownOperationRefresh.operationNames = ["KnownSettingsQuery"];
  value.knownOperationRefresh.operationKind = "query";
  value.knownOperationRefresh.persistedQuerySha256Hashes = [persistedQueryHash];
  value.knownOperationRefresh.operationDefinitionDigest = graphQlDefinitionDigest;
  const plan = buildKnownOperationRefreshPlan(value);
  const evidence = evaluateKnownOperationRefreshEvidence({
    plan,
    actionResults: productionActionResults,
    apiRecords: [{ method: "POST", url: "https://admin.example.com/graphql", status: 200, graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash, attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) }, responseBodyForAnalysis: '{"data":null,"errors":[{"message":"redacted"}]}' }],
  });
  assert.equal(evidence.status, "error-observed");
  assert.equal(evidence.successfulRecordCount, 0);
  assert.equal(evidence.health.status, "error-observed");
  assert.equal(evidence.health.graphQlErrorRecordCount, 1);
  assert.equal(evidence.evidenceAxes.usage, "unknown");
  const incomplete = evaluateKnownOperationRefreshEvidence({
    plan,
    actionResults: productionActionResults,
    apiRecords: [{ method: "POST", url: "https://admin.example.com/graphql", status: 200, graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash, attribution: { actionIndex: 2 }, bodyCapture: { state: "truncated" }, responseBodySample: '{"data":{}}' }],
  });
  assert.equal(incomplete.status, "capture-incomplete");
  assert.equal(incomplete.health.unverifiedGraphQlRecordCount, 1);
});

test("a portal UI may refresh an operation on a different owned capture host", () => {
  const value = recipe();
  value.url = "https://portal.example.com/home";
  value.actions[0] = "navigate=https://portal.example.com/settings";
  value.matchHosts = ["admin.example.com", "portal.example.com"];
  const plan = buildKnownOperationRefreshPlan(value, { baselineOperations: [{ method: "GET", path: "/api/settings", hosts: ["admin.example.com"] }] });
  assert.equal(plan.entryHost, "portal.example.com");
  assert.equal(plan.host, "admin.example.com");
  value.knownOperationRefresh.host = "unowned.example.com";
  value.matchHosts.push("unowned.example.com");
  assert.throws(() => buildKnownOperationRefreshPlan(value, { baselineOperations: [{ method: "GET", path: "/api/settings", hosts: ["admin.example.com"] }] }), /not owned/);
});

test("resolved hosts match bundled server-variable ownership suffixes", () => {
  const value = recipe();
  value.knownOperationRefresh.host = "examplefixture-admin.sharepoint.com";
  value.matchHosts = ["examplefixture-admin.sharepoint.com"];
  const plan = buildKnownOperationRefreshPlan(value, {
    baselineOperations: [{ method: "GET", path: "/api/settings", hosts: ["server-variable-admin.sharepoint.com"] }],
  });
  assert.equal(plan.host, "examplefixture-admin.sharepoint.com");
});

test("known-operation evidence requires action attribution and verified complete sidecars for schema evidence", () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  const evidence = evaluateKnownOperationRefreshEvidence({
    plan,
    actionResults: productionActionResults,
    apiRecords: [{ method: "GET", url: "https://admin.example.com/api/settings", status: 200, attribution: { actionIndex: 2 }, bodyCapture: { state: "truncated" }, responseBodySample: "{\"value\":[]}" }],
  });
  assert.equal(evidence.status, "capture-incomplete");
  assert.equal(evidence.transport2xxRecordCount, 1);
  assert.equal(evidence.health.status, "incomplete");
  assert.equal(evidence.evidenceAxes.schema, "unknown");
  assert.equal(evidence.evidenceAxes.usage, "unknown");
  assert.notEqual(evidence.evidenceAxes.usage, "execution-tested");
});

test("a scoped sidecar write failure makes the refresh terminal capture incomplete", () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  const evidence = evaluateKnownOperationRefreshEvidence({
    plan,
    actionResults: productionActionResults,
    apiRecords: [{ method: "GET", url: "https://admin.example.com/api/settings", status: 200, attribution: { actionIndex: 2 }, bodyCapture: { state: "incomplete-write" } }],
  });
  assert.equal(evidence.status, "capture-incomplete");
  assert.equal(evidence.incompleteWriteRecordCount, 1);
  assert.equal(evidence.completeBodyRecordCount, 0);
  assert.equal(evidence.evidenceAxes.schema, "unknown");
});

test("fresh observed errors stay separate from API health and successful usage", () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  const evidence = evaluateKnownOperationRefreshEvidence({
    plan,
    actionResults: productionActionResults,
    apiRecords: [{ method: "GET", url: "https://admin.example.com/api/settings", status: 403, observedAt: "2026-10-03T12:00:00Z", attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) }, responseBodyForAnalysis: "{\"error\":{}}" }],
  });
  assert.equal(evidence.status, "error-observed");
  assert.equal(evidence.health.status, "error-observed");
  assert.deepEqual(evidence.health.observedStatuses, [403]);
  assert.equal(evidence.health.lastSuccessfulObservationAt, null);
  assert.equal(evidence.evidenceAxes.freshness, "observed");
  assert.equal(evidence.evidenceAxes.schema, "unknown");
  assert.equal(evidence.evidenceAxes.usage, "unknown");
});

test("representative states preserve exact evidence and never infer populated state from empty evidence", () => {
  const matrix = validateRepresentativeStateMatrix([{ id: "empty-list", kind: "empty", evidenceId: "request-abc", page: "list", target: "GET /items", prerequisite: "signed in", actionIndex: 1, emptyEvidence: true }], { actions: [{}, {}] });
  assert.equal(matrix[0].kind, "empty");
  assert.throws(() => validateRepresentativeStateMatrix([{ ...matrix[0], id: "bad", kind: "populated" }], { actions: [{}, {}] }), /cannot infer/);
});

test("evidence axes and immutable review packets keep independent gaps and stable cache keys", () => {
  const axes = evaluateEvidenceAxes({ noveltyStatus: { status: "satisfied", reason: "done", nextRequirement: "new evidence", evidenceDisposition: "capture-freshness-gap" } });
  assert.equal(axes.discovery.status, "unknown");
  assert.equal(axes.freshness.status, "gap");
  const left = buildReviewPacket({ evidence: ["b", "a"], diff: ["d"], scope: "sharepoint", policy: ["p"], model: "gpt-6-luna", reasoning: "xhigh" });
  const right = buildReviewPacket({ evidence: ["a", "b"], diff: ["d"], scope: "sharepoint", policy: ["p"], model: "gpt-6-luna", reasoning: "xhigh" });
  assert.equal(left.cacheKey, right.cacheKey);
  assert.equal(left.rawPortalDataIncluded, false);
  assert.notEqual(left.cacheKey, buildReviewPacket({ evidence: ["a", "b"], diff: ["changed"], scope: "sharepoint", policy: ["p"], model: "gpt-6-luna", reasoning: "xhigh" }).cacheKey);
});

test("blocked and unverified declarations cannot manufacture satisfied evidence axes", () => {
  const allSatisfied = Object.fromEntries(["freshness", "discovery", "schema", "usage"].map((name) => [name, { status: "satisfied", evidenceIds: ["claimed-old"] }]));
  const verifiedEvidence = [{ evidenceId: "claimed-old", artifactSha256: "a".repeat(64), reviewDigest: "b".repeat(64) }];
  const blocked = evaluateEvidenceAxes({ capturePrerequisite: { status: "blocked" }, evidenceAxes: allSatisfied }, { verifiedEvidence });
  assert.deepEqual(Object.values(blocked).map((axis) => axis.status), ["blocked", "blocked", "blocked", "blocked"]);

  const unverified = evaluateEvidenceAxes({ evidenceAxes: allSatisfied });
  assert.deepEqual(Object.values(unverified).map((axis) => axis.status), ["unknown", "unknown", "unknown", "unknown"]);
  assert.equal(unverified.freshness.verification, "unverified");

  const verified = evaluateEvidenceAxes({ evidenceAxes: allSatisfied }, { verifiedEvidence });
  assert.deepEqual(Object.values(verified).map((axis) => axis.status), ["satisfied", "satisfied", "satisfied", "satisfied"]);

  const fallbackBlocked = evaluateEvidenceAxes({
    capturePrerequisite: { status: "blocked" },
    knownOperationRefresh: { status: "satisfied" },
    noveltyStatus: { status: "satisfied" },
  });
  assert.deepEqual(Object.values(fallbackBlocked).map((axis) => axis.status), ["blocked", "blocked", "blocked", "blocked"]);
  const fallbackUnverified = evaluateEvidenceAxes({ knownOperationRefresh: { status: "satisfied" }, noveltyStatus: { status: "satisfied" } });
  assert.deepEqual(Object.values(fallbackUnverified).map((axis) => axis.status), ["unknown", "unknown", "unknown", "unknown"]);
});

for (const [body, expected] of [
  ['{"error":{"message":"x"}}', "error-observed"],
  ['{"errorMessage":"failure"}', "error-observed"],
  ['{"errorMessage":null,"errors":[],"error":{"message":null}}', "healthy-observed"],
  ['{"items":[{"error":{"code":"x"}}]}', "healthy-observed"],
  ["not-json", "incomplete"],
  ["", "incomplete"],
]) {
  test(`REST classification ${body}`, () => {
    const plan = buildKnownOperationRefreshPlan(recipe());
    const record = {
      method: "GET", url: "https://admin.example.com/api/settings", status: 200,
      attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) },
      responseBodyForAnalysis: body,
    };
    const result = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults, apiRecords: [record] });
    assert.equal(result.transport2xxRecordCount, 1);
    assert.equal(result.health.status, expected);
  });
}

test("complete HTTP 400 remains an error observation", () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  const record = {
    method: "GET", url: "https://admin.example.com/api/settings", status: 400,
    attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) },
    responseBodyForAnalysis: '{"errorMessage":"failed"}',
  };
  const result = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults, apiRecords: [record] });
  assert.equal(result.health.status, "error-observed");
  assert.equal(result.transport2xxRecordCount, 0);
});

test("mixed successful and logical-error REST records remain error evidence", () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  const record = { method: "GET", url: "https://admin.example.com/api/settings", status: 200,
    attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) } };
  const result = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults,
    apiRecords: [{ ...record, responseBodyForAnalysis: '{"value":[]}' }, { ...record, responseBodyForAnalysis: '{"errorMessage":"failure"}' }] });
  assert.equal(result.health.status, "error-observed");
  assert.equal(result.health.restLogicalErrorRecordCount, 1);
  assert.equal(result.successfulRecordCount, 1);
});

test("mixed successful and error GraphQL records remain error evidence", () => {
  const value = recipe();
  Object.assign(value.knownOperationRefresh, { method: "POST", routes: ["/graphql"], operationNames: ["KnownSettingsQuery"], operationKind: "query", persistedQuerySha256Hashes: [persistedQueryHash], operationDefinitionDigest: graphQlDefinitionDigest });
  const record = { method: "POST", url: "https://admin.example.com/graphql", status: 200,
    graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash,
    attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) } };
  const result = evaluateKnownOperationRefreshEvidence({ plan: buildKnownOperationRefreshPlan(value), actionResults: productionActionResults,
    apiRecords: [{ ...record, responseBodyForAnalysis: '{"data":{}}' }, { ...record, responseBodyForAnalysis: '{"errors":[{"message":"failure"}]}' }] });
  assert.equal(result.health.status, "error-observed");
  assert.equal(result.health.graphQlErrorRecordCount, 1);
  assert.equal(result.successfulRecordCount, 1);
});

for (const [body, expected, errorCount] of [
  ['{"ErrorData":{"ErrorMessage":"failure","ErrorType":null,"ExceptionName":null}}', "error-observed", 1],
  ['{"ErrorData":{"ErrorMessage":null,"ErrorType":"","ExceptionName":"  ","Code":0}}', "healthy-observed", 0],
  ['{"ERROR":{"message":"failure"}}', "error-observed", 1],
]) {
  test(`conventional root envelope ${body}`, () => {
    const plan = buildKnownOperationRefreshPlan(recipe());
    const record = { method: "GET", url: "https://admin.example.com/api/settings", status: 200,
      attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) }, responseBodyForAnalysis: body };
    const result = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults, apiRecords: [record] });
    assert.equal(result.health.status, expected);
    assert.equal(result.health.restLogicalErrorRecordCount, errorCount);
  });
}

test("mixed Purview ErrorData and successful records remain qualified error evidence", () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  const common = { method: "GET", url: "https://admin.example.com/api/settings", status: 200,
    attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) } };
  const result = evaluateKnownOperationRefreshEvidence({ plan, actionResults: productionActionResults,
    apiRecords: [{ ...common, responseBodyForAnalysis: '{"value":[]}' },
      { ...common, responseBodyForAnalysis: '{"ErrorData":{"ErrorMessage":"failure"}}' }] });
  assert.equal(result.status, "error-observed");
  assert.equal(result.health.status, "error-observed");
  assert.equal(result.successfulRecordCount, 1);
  assert.equal(result.health.restLogicalErrorRecordCount, 1);
});

test("GraphQL malformed populated non-array errors are incomplete even alongside data", () => {
  const value = recipe();
  Object.assign(value.knownOperationRefresh, { method: "POST", routes: ["/graphql"], operationNames: ["KnownSettingsQuery"], operationKind: "query", persistedQuerySha256Hashes: [persistedQueryHash], operationDefinitionDigest: graphQlDefinitionDigest });
  const record = { method: "POST", url: "https://admin.example.com/graphql", status: 200,
    graphQlOperationName: "KnownSettingsQuery", graphQlPersistedQuerySha256Hash: persistedQueryHash,
    attribution: { actionIndex: 2 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) } };
  const run = body => evaluateKnownOperationRefreshEvidence({ plan: buildKnownOperationRefreshPlan(value), actionResults: productionActionResults,
    apiRecords: [{ ...record, responseBodyForAnalysis: JSON.stringify(body) }] });
  const malformed = run({ data: {}, errors: { message: "failure" } });
  assert.equal(malformed.status, "capture-incomplete");
  assert.equal(malformed.health.unverifiedGraphQlRecordCount, 1);
  assert.equal(malformed.health.graphQlErrorRecordCount, 0);
  assert.equal(run({ data: {}, errors: [] }).health.status, "healthy-observed");
  assert.equal(run({ data: {}, errors: null }).health.status, "healthy-observed");
  assert.equal(run({ data: {}, errors: [{ message: "failure" }] }).health.status, "error-observed");
});

function strictIndexFixture() {
  const value = recipe();
  value.actions = ["capture=known", "wait-ms=1", "navigate=https://admin.example.com/settings"];
  const plan = buildKnownOperationRefreshPlan(value);
  const capture = { type: "capture", actionIndex: 0, result: { capturedOnly: true } };
  const navigate = { type: "navigate", actionIndex: 2, result: { resolvedUrl: "https://admin.example.com/settings", url: "https://admin.example.com/settings" } };
  const record = { method: "GET", url: "https://admin.example.com/api/settings", status: 200,
    attribution: { actionIndex: 0 }, bodyCapture: { state: "complete", sha256: "a".repeat(64) }, responseBodyForAnalysis: '{"value":[]}' };
  return { plan, capture, navigate, record };
}
const invalidRawIndexes = [["null", null], ["empty", ""], ["numeric-zero", "0"], ["numeric-two", "2"],
  ["false", false], ["true", true], ["fraction", 0.5], ["NaN", NaN]];

test("action-result attribution accepts raw integers only, independently of valid record evidence", () => {
  const f = strictIndexFixture();
  for (const [label, rawIndex] of invalidRawIndexes) {
    for (const aliases of [{ actionIndex: rawIndex, index: rawIndex }, { index: rawIndex }]) {
      const action = { type: f.capture.type, result: f.capture.result, ...aliases };
      const result = evaluateKnownOperationRefreshEvidence({ plan: f.plan, actionResults: [action, f.navigate], apiRecords: [f.record] });
      assert.deepEqual(result.missingActionIndexes, [0], label);
      assert.equal(result.status, "action-accounting-incomplete", label);
      assert.equal(result.matchedRecordCount, 1, "valid record is independent of bad action accounting");
      assert.notEqual(result.health.status, "healthy-observed", label);
    }
  }
});

test("API-record attribution accepts raw integers only, independently of complete action accounting", () => {
  const f = strictIndexFixture();
  for (const [label, rawIndex] of invalidRawIndexes) {
    for (const aliases of [{ attribution: { actionIndex: rawIndex }, actionIndex: rawIndex }, { attribution: undefined, actionIndex: rawIndex }]) {
      const result = evaluateKnownOperationRefreshEvidence({ plan: f.plan, actionResults: [f.capture, f.navigate], apiRecords: [{ ...f.record, ...aliases }] });
      assert.deepEqual(result.missingActionIndexes, [], label);
      assert.equal(result.matchedRecordCount, 0, label);
      assert.equal(result.status, "no-target-signal", label);
      assert.notEqual(result.health.status, "healthy-observed", label);
    }
  }
});

test("combined null or empty attribution cannot synthesize a successful action-zero witness", () => {
  const f = strictIndexFixture();
  for (const rawIndex of [null, ""]) {
    const result = evaluateKnownOperationRefreshEvidence({ plan: f.plan,
      actionResults: [{ ...f.capture, actionIndex: rawIndex, index: rawIndex }, f.navigate],
      apiRecords: [{ ...f.record, attribution: { actionIndex: rawIndex }, actionIndex: rawIndex }] });
    assert.deepEqual(result.missingActionIndexes, [0]);
    assert.equal(result.matchedRecordCount, 0);
    assert.notEqual(result.health.status, "healthy-observed");
  }
});

test("integer aliases zero/two and nullish fallback remain valid while bootstrap stays excluded", () => {
  const f = strictIndexFixture();
  for (const variant of [
    { actions: [f.capture, f.navigate], record: f.record },
    { actions: [{ type: f.capture.type, result: f.capture.result, index: 0 }, { type: f.navigate.type, result: f.navigate.result, index: 2 }], record: { ...f.record, attribution: undefined, actionIndex: 2 } },
    { actions: [{ ...f.capture, actionIndex: null, index: 0 }, { ...f.navigate, actionIndex: null, index: 2 }], record: { ...f.record, attribution: { actionIndex: null }, actionIndex: 0 } },
    { actions: [{ ...f.capture, index: "" }, { ...f.navigate, index: false }], record: { ...f.record, actionIndex: false } },
  ]) {
    const bootstrap = { ...variant.record, attribution: { actionIndex: -1 }, actionIndex: -1 };
    const result = evaluateKnownOperationRefreshEvidence({ plan: f.plan,
      actionResults: [{ ...f.navigate, actionIndex: -1 }, ...variant.actions], apiRecords: [bootstrap, variant.record] });
    assert.deepEqual(result.missingActionIndexes, []);
    assert.equal(result.matchedRecordCount, 1);
    assert.equal(result.health.status, "healthy-observed");
    const bootstrapOnly = evaluateKnownOperationRefreshEvidence({ plan: f.plan, actionResults: variant.actions, apiRecords: [bootstrap] });
    assert.equal(bootstrapOnly.matchedRecordCount, 0);
  }
});

test("non-nullish invalid primary attribution cannot fall through to an integer alias", () => {
  const f = strictIndexFixture();
  const badAction = evaluateKnownOperationRefreshEvidence({ plan: f.plan,
    actionResults: [{ ...f.capture, actionIndex: "", index: 0 }, f.navigate], apiRecords: [f.record] });
  assert.deepEqual(badAction.missingActionIndexes, [0]);
  const badRecord = evaluateKnownOperationRefreshEvidence({ plan: f.plan,
    actionResults: [f.capture, f.navigate], apiRecords: [{ ...f.record, attribution: { actionIndex: false }, actionIndex: 0 }] });
  assert.equal(badRecord.matchedRecordCount, 0);
  assert.notEqual(badRecord.health.status, "healthy-observed");
});