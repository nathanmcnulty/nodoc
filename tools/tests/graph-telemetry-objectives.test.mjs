import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGraphTelemetryObjectives } from "../graph-telemetry-objectives.mjs";

test("Graph telemetry objectives require pinned contracts and count new enriched batch operations", () => {
  const result = evaluateGraphTelemetryObjectives({
    objectives: {
      baselineOperationKeys: ["beta GET /me"],
      contractRequired: true,
      minimumBatchMemberCount: 1,
      minimumCheckpointCount: 1,
      minimumEnrichedOperationCount: 1,
      minimumNewOperationCount: 1,
      minimumNewEnrichedProductOperationCount: 1,
      minimumOperationCount: 2,
    },
    telemetry: {
      contractSnapshot: { commitSha: "a".repeat(40) },
      contractVersions: ["beta", "v1.0"],
      measurements: { batchMemberCount: 1, undocumentedCandidateCount: 1 },
      operations: [
        { version: "beta", method: "GET", path: "/me", checkpoints: ["landing"], statuses: [200], requestShapeDigests: [], responseShapeDigests: [] },
        { version: "beta", method: "GET", path: "/new", checkpoints: ["users"], statuses: [200], requestShapeDigests: [], responseShapeDigests: ["shape"] },
      ],
    },
  });
  assert.equal(result.status, "productive");
  assert.equal(result.measurements.newOperationCount, 1);
  assert.deepEqual(result.newOperationKeys, ["beta GET /new"]);
  assert.deepEqual(result.newEnrichedProductOperationKeys, ["beta GET /new"]);
});

test("Graph telemetry objectives fail closed when the official contract is unavailable", () => {
  const result = evaluateGraphTelemetryObjectives({
    objectives: { contractRequired: true, minimumOperationCount: 1 },
    telemetry: { contractVersions: [], measurements: {}, operations: [] },
  });
  assert.equal(result.status, "contract-unavailable");
  assert.deepEqual(result.failedChecks, ["contract", "operations"]);
});

test("Graph proxy objectives require an observed recognized proxy transport", () => {
  const result = evaluateGraphTelemetryObjectives({
    objectives: { minimumOperationCount: 1, minimumProxyOperationCount: 1 },
    telemetry: {
      contractVersions: [],
      measurements: { proxyTransportOperationCount: 0 },
      operations: [{ version: "v1.0", method: "GET", path: "/users", checkpoints: [], statuses: [200] }],
    },
  });
  assert.equal(result.status, "objective-incomplete");
  assert.deepEqual(result.failedChecks, ["proxy-operations"]);
});

test("Graph product objectives exclude shell traffic and require a successful response shape", () => {
  const result = evaluateGraphTelemetryObjectives({
    objectives: {
      minimumNewEnrichedProductOperationCount: 1,
      productExcludeOperationKeys: ["v1.0 GET /admin/serviceAnnouncement/messages"],
      productProxyOnly: true,
    },
    telemetry: {
      operations: [
        { version: "v1.0", method: "GET", path: "/admin/serviceAnnouncement/messages", statuses: [200], responseShapeDigests: ["shape"], transportKinds: ["defender-graph-proxy"] },
        { version: "v1.0", method: "GET", path: "/users/{id}/photo/$value", statuses: [200], responseShapeDigests: ["shape"], transportKinds: ["direct-graph"] },
        { version: "beta", method: "GET", path: "/product", statuses: [200], responseShapeDigests: [], transportKinds: ["defender-graph-proxy"] },
      ],
    },
  });
  assert.equal(result.status, "objective-incomplete");
  assert.deepEqual(result.failedChecks, ["new-enriched-product-operations"]);
});
