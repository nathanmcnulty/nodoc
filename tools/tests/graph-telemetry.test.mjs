import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGraphResearchQueue,
  buildGraphTelemetry,
  validateGraphResearchQueue,
  validateGraphTelemetry,
} from "../graph-telemetry.mjs";

test("Graph telemetry expands batch members, parameterizes identifiers, and compares official contracts", () => {
  const telemetry = buildGraphTelemetry({
    apiRecords: [{
      attribution: { actionIndex: 2, checkpoint: "devices" },
      method: "POST",
      mimeType: "application/json",
      path: "/beta/$batch",
      requestBodySamples: [JSON.stringify({ requests: [
        { id: "1", method: "GET", url: "/deviceManagement/managedDevices/847b5907-ca15-40f4-b171-eb18619dbfab?$select=id,userPrincipalName" },
        { id: "2", method: "GET", url: "/deviceManagement/undocumentedFunction(scope='all')" },
      ] })],
      responseBodySample: JSON.stringify({ responses: [
        { id: "1", status: 200, headers: { "Content-Type": "application/json" }, body: { id: "847b5907-ca15-40f4-b171-eb18619dbfab", userPrincipalName: "person@example.test" } },
        { id: "2", status: 403, body: { error: { code: "Forbidden", message: "tenant-specific text" } } },
      ] }),
      status: 200,
      url: "https://graph.microsoft.com/beta/$batch",
    }, {
      attribution: { actionIndex: 3, checkpoint: "retry" },
      method: "POST",
      requestBodySamples: [JSON.stringify({ requests: [{ id: "bad", method: "LIST", url: "/users" }] })],
      responseBodySample: JSON.stringify({ error: { code: "BadRequest", message: "tenant-specific text" } }),
      status: 400,
      url: "https://graph.microsoft.com/beta/$batch",
    }],
    betaContract: {
      paths: {
        "/deviceManagement/managedDevices/{managedDevice-id}": { get: { responses: { 200: { description: "ok" } } } },
      },
    },
  });
  validateGraphTelemetry(telemetry);
  assert.equal(telemetry.measurements.operationCount, 2);
  assert.equal(telemetry.measurements.batchMemberCount, 2);
  assert.equal(telemetry.measurements.documentedCount, 1);
  assert.equal(telemetry.measurements.undocumentedCandidateCount, 1);
  assert.equal(telemetry.measurements.errorOperationCount, 1);
  assert.equal(telemetry.measurements.batchRequestCount, 2);
  assert.equal(telemetry.measurements.batchErrorCount, 1);
  assert.equal(telemetry.measurements.malformedBatchMemberCount, 1);
  assert.equal(telemetry.batches[1].status, 400);
  assert.equal(telemetry.batches[1].malformedMemberCount, 1);
  const queue = buildGraphResearchQueue(telemetry);
  validateGraphResearchQueue(queue);
  assert.equal(queue.undocumentedCandidates.length, 1);
  assert.equal(queue.errorOperations.length, 1);
  assert.equal(queue.batchIssues.length, 1);
  assert.equal(queue.documentedEnrichment.length, 1);
  assert.equal(telemetry.operations[0].path, "/deviceManagement/managedDevices/{id}");
  assert.deepEqual(telemetry.operations[0].queryParameterNames, ["$select"]);
  assert.equal(telemetry.operations[0].contractDisposition, "documented-current-version");
  assert.equal(telemetry.operations[1].contractDisposition, "undocumented-candidate");
  assert.doesNotMatch(JSON.stringify(telemetry), /847b5907|person@example|tenant-specific/iu);
});

test("Graph telemetry keeps direct observations useful without claiming an undocumented contract delta", () => {
  const telemetry = buildGraphTelemetry({ apiRecords: [{
    attribution: { actionIndex: 1, checkpoint: "tenant-admin" },
    method: "GET",
    mimeType: "application/json",
    path: "/beta/deviceManagement/subscriptionState",
    queryParameterNames: [],
    responseBodySample: "{\"state\":\"active\"}",
    status: 200,
    url: "https://graph.microsoft.com/beta/deviceManagement/subscriptionState",
  }] });
  validateGraphTelemetry(telemetry);
  assert.equal(telemetry.operations[0].contractDisposition, "official-contract-not-supplied");
  assert.equal(telemetry.operations[0].responseShapeDigests.length, 1);
});

test("Graph research queue keeps documented error-only operations out of enrichment", () => {
  const telemetry = buildGraphTelemetry({
    apiRecords: [{
      method: "GET",
      responseBodySample: '{"error":{"code":"NotFound"}}',
      status: 404,
      url: "https://graph.microsoft.com/v1.0/users/example/extensions/preference",
    }],
    v1Contract: { paths: { "/users/{user-id}/extensions/{extension-id}": { get: {} } } },
  });
  const queue = buildGraphResearchQueue(telemetry);
  assert.equal(queue.errorOperations.length, 1);
  assert.equal(queue.documentedEnrichment.length, 0);
});

test("Graph telemetry recognizes portal and OpenAPI spellings of Graph functions and entity keys", () => {
  const telemetry = buildGraphTelemetry({
    apiRecords: [
      { method: "GET", url: "https://graph.microsoft.com/beta/deviceManagement/getEffectivePermissions" },
      { method: "GET", url: "https://graph.microsoft.com/beta/organization('847b5907-ca15-40f4-b171-eb18619dbfab')" },
    ],
    betaContract: { paths: {
      "/deviceManagement/getEffectivePermissions()": { get: {} },
      "/organization/{organization-id}": { get: {} },
    } },
  });
  validateGraphTelemetry(telemetry);
  assert.deepEqual(telemetry.operations.map((entry) => entry.contractDisposition), [
    "documented-current-version",
    "documented-current-version",
  ]);
});

test("Graph telemetry recovers member evidence from a truncated batch body", () => {
  const telemetry = buildGraphTelemetry({ apiRecords: [{
    attribution: { actionIndex: 1, checkpoint: "users" },
    method: "POST",
    status: 200,
    url: "https://graph.microsoft.com/beta/$batch",
    requestBodySamples: ["{truncated"],
    responseBodySample: "{truncated",
    graphBatch: {
      requestParsed: true,
      responseParsed: true,
      requests: [{ idDigest: "request-one", method: "GET", url: "/users", bodyShapeFingerprint: null }],
      responses: [{ idDigest: "request-one", status: 200, mimeType: "application/json", bodyShapeFingerprint: "shape-digest" }],
    },
  }] });
  validateGraphTelemetry(telemetry);
  assert.equal(telemetry.operations[0].path, "/users");
  assert.deepEqual(telemetry.operations[0].statuses, [200]);
  assert.deepEqual(telemetry.operations[0].responseShapeDigests, ["shape-digest"]);
  assert.equal(telemetry.batches[0].responseParsed, true);
});

test("Graph telemetry recognizes Defender, Purview, and M365 Admin Graph proxies", () => {
  const telemetry = buildGraphTelemetry({
    apiRecords: [
      {
        attribution: { actionIndex: 1, checkpoint: "defender-users" },
        method: "GET",
        status: 200,
        url: "https://security.microsoft.com/apiproxy/msgraph/v1.0/users?$select=id",
      },
      {
        attribution: { actionIndex: 2, checkpoint: "purview-roles" },
        method: "GET",
        status: 200,
        url: "https://purview.microsoft.com/apiproxy/msgraph/beta/roleManagement/directory/transitiveRoleAssignments",
      },
      {
        attribution: { actionIndex: 3, checkpoint: "m365-batch" },
        method: "POST",
        status: 200,
        url: "https://admin.microsoft.com/fd/msgraph/beta/$batch",
        requestBodySamples: [JSON.stringify({ requests: [{ id: "1", method: "GET", url: "/deviceManagement/subscriptionState" }] })],
        responseBodySample: JSON.stringify({ responses: [{ id: "1", status: 200, body: { value: "enabled" } }] }),
      },
    ],
    v1Contract: { paths: { "/users": { get: {} } } },
    betaContract: { paths: { "/roleManagement/directory/transitiveRoleAssignments": { get: {} } } },
  });
  validateGraphTelemetry(telemetry);
  assert.equal(telemetry.measurements.operationCount, 3);
  assert.equal(telemetry.measurements.proxyTransportOperationCount, 3);
  assert.equal(telemetry.measurements.directTransportOperationCount, 0);
  assert.deepEqual(telemetry.operations.map((entry) => entry.path), [
    "/deviceManagement/subscriptionState",
    "/roleManagement/directory/transitiveRoleAssignments",
    "/users",
  ]);
  assert.deepEqual(telemetry.operations[0].transportKinds, ["m365-admin-msgraph-proxy"]);
  assert.deepEqual(telemetry.operations[1].transportHosts, ["purview.microsoft.com"]);
  assert.deepEqual(telemetry.operations[2].queryParameterNames, ["$select"]);
  assert.equal(telemetry.batches[0].transportKind, "m365-admin-msgraph-proxy");
});

test("Graph telemetry does not infer Graph from lookalike proxy paths", () => {
  const telemetry = buildGraphTelemetry({ apiRecords: [
    { method: "GET", status: 200, url: "https://security.microsoft.com/apiproxy/arm/providers/Microsoft.ResourceGraph/resources" },
    { method: "GET", status: 200, url: "https://admin.microsoft.com/fd/msgraphical/v1.0/users" },
    { method: "GET", status: 200, url: "https://example.test/apiproxy/msgraph/v1.0/users" },
  ] });
  validateGraphTelemetry(telemetry);
  assert.equal(telemetry.measurements.operationCount, 0);
});

test("Graph telemetry redacts UPN and opaque entity-key path segments while retaining header names", () => {
  const telemetry = buildGraphTelemetry({ apiRecords: [{
    method: "GET",
    portalName: "Teams",
    requestHeaderNames: ["Authorization", "client-request-id"],
    responseHeaderNames: ["request-id", "Content-Type"],
    status: 404,
    url: "https://graph.microsoft.com/v1.0/users/person@example.test/messages/AAMkAD1234567890",
  }] });
  validateGraphTelemetry(telemetry);
  assert.equal(telemetry.operations[0].path, "/users/{id}/messages/{id}");
  assert.deepEqual(telemetry.operations[0].portalOwners, ["Teams"]);
  assert.deepEqual(telemetry.operations[0].requestHeaderNames, ["authorization", "client-request-id"]);
  assert.deepEqual(telemetry.operations[0].responseHeaderNames, ["content-type", "request-id"]);
  assert.doesNotMatch(JSON.stringify(telemetry), /person@example|AAMkAD123/iu);
});

test("Graph telemetry sanitizes attribution labels and dynamic shape-summary properties", () => {
  const telemetry = buildGraphTelemetry({ apiRecords: [{
    attribution: {
      actionIndex: 0,
      checkpoint: "01-user-aad-11111111-1111-4111-8111-111111111111-person@example.test",
    },
    method: "GET",
    responseShapeFingerprint: "a".repeat(64),
    responseShapeSummary: {
      "11111111-1111-4111-8111-111111111111": "object",
      account: "person@example.test",
      value: [{ id: "string" }],
    },
    seenOnPages: ["user-person%40example.test-11111111-1111-4111-8111-111111111111"],
    status: 200,
    url: "https://security.microsoft.com/apiproxy/msgraph/v1.0/users/11111111-1111-4111-8111-111111111111",
  }] });
  validateGraphTelemetry(telemetry);
  assert.deepEqual(telemetry.operations[0].responseShapeSummaries, [{
    "{dynamicProperty}": "unknown",
    account: "redacted",
    value: [{ id: "string" }],
  }]);
  assert.doesNotMatch(JSON.stringify(telemetry), /11111111-1111-4111-8111-111111111111|person@example/iu);
});
