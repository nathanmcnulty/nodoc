import assert from "node:assert/strict";
import test from "node:test";

import { validateGraphResearchSpecification } from "../validate-graph-research.mjs";

const manifest = {
  commitSha: "a".repeat(40),
  manifestDigest: "b".repeat(64),
  contracts: [
    { version: "beta", sha256: "1".repeat(64), operationCount: 2 },
    { version: "v1.0", sha256: "2".repeat(64), operationCount: 1 },
  ],
};

function operation(overrides = {}) {
  return {
    operationId: "GraphResearch.Test",
    servers: [{ url: "https://graph.microsoft.com/beta" }],
    "x-nodoc-operation-safety": { class: "read-only" },
    "x-nodoc-graph-evidence": {
      contractCommit: manifest.commitSha,
      contractManifestDigest: manifest.manifestDigest,
      evidenceCount: 2,
      corroboratingCaptureCount: 2,
      captureComplete: true,
      interactionHealth: "healthy",
      unresolvedMutation: false,
      successfulStatuses: [200],
      transports: ["direct", "proxy-correlated"],
      corroboratingRequestTransports: [],
      evidenceRecord: "evidence/test.json",
      artifactIds: ["artifact-one", "artifact-two"],
      telemetryDigests: ["c".repeat(64), "d".repeat(64)],
      operationIds: ["operation-one", "operation-two"],
      responseShapeDigests: ["e".repeat(64)],
    },
    responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
    ...overrides,
  };
}

const evidenceRecords = {
  "evidence/test.json": {
    operationKey: "beta GET /undocumented",
    contractCommit: manifest.commitSha,
    contractManifestDigest: manifest.manifestDigest,
    artifacts: ["one", "two"].map((suffix, index) => ({
      artifactId: `artifact-${suffix}`,
      captureComplete: true,
      interactionAccountingConsistent: true,
      unresolvedMutation: false,
      graphTelemetryFileSha256: `${index + 3}`.repeat(64),
      telemetryDigest: index === 0 ? "c".repeat(64) : "d".repeat(64),
      operationId: `operation-${suffix}`,
      statuses: [200],
      successfulTransports: ["direct"],
      requestShapeDigests: [],
      responseShapeDigests: ["e".repeat(64)],
    })),
  },
};

function specification(pathname = "/undocumented", method = "get", value = operation()) {
  return {
    openapi: "3.0.1",
    info: { title: "Microsoft Graph Research" },
    "x-nodoc-graph-contract": {
      repository: "microsoftgraph/msgraph-metadata",
      commitSha: manifest.commitSha,
      manifestDigest: manifest.manifestDigest,
      sources: {
        beta: { sha256: "1".repeat(64), operationCount: 2 },
        "v1.0": { sha256: "2".repeat(64), operationCount: 1 },
      },
    },
    servers: [
      { url: "https://graph.microsoft.com/beta" },
      { url: "https://graph.microsoft.com/v1.0" },
    ],
    paths: { [pathname]: { [method]: value } },
  };
}

test("Graph research validator admits only corroborated successful contract deltas", () => {
  const result = validateGraphResearchSpecification({
    specification: specification(),
    betaContract: { paths: {} },
    v1Contract: { paths: {} },
    manifest,
    evidenceRecords,
  });
  assert.equal(result.operationCount, 1);
});

test("Graph research validator rejects documented, batch, and error-only operations", () => {
  assert.throws(() => validateGraphResearchSpecification({
    specification: specification("/documented"),
    betaContract: { paths: { "/documented": { get: {} } } },
    v1Contract: { paths: {} },
    manifest,
    evidenceRecords,
  }), /present in an official pinned Graph contract/u);

  const rejected = specification("/$batch", "get", operation({
    "x-nodoc-graph-evidence": {
      ...operation()["x-nodoc-graph-evidence"],
      successfulStatuses: [404],
    },
    responses: { 404: { description: "not found" } },
  }));
  assert.throws(() => validateGraphResearchSpecification({
    specification: rejected,
    betaContract: { paths: {} },
    v1Contract: { paths: {} },
    manifest,
    evidenceRecords,
  }), /batch wrapper cannot be promoted|successful live status is required/u);
});

test("Graph research validator binds cited artifacts and rejects portal proxy paths", () => {
  const fakeEvidence = structuredClone(evidenceRecords);
  fakeEvidence["evidence/test.json"].artifacts[0].artifactId = "fabricated";
  assert.throws(() => validateGraphResearchSpecification({
    specification: specification(), betaContract: { paths: {} }, v1Contract: { paths: {} }, manifest, evidenceRecords: fakeEvidence,
  }), /artifact identifiers do not match/u);

  const proxyRecords = structuredClone(evidenceRecords);
  proxyRecords["evidence/test.json"].operationKey = "beta GET /apiproxy/msgraph/beta/undocumented";
  assert.throws(() => validateGraphResearchSpecification({
    specification: specification("/apiproxy/msgraph/beta/undocumented"), betaContract: { paths: {} }, v1Contract: { paths: {} }, manifest, evidenceRecords: proxyRecords,
  }), /proxy paths cannot be promoted/u);
});
