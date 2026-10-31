import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateKnownOperationRefreshEvidence, isValidKnownOperationRefreshExpiryTimestamp } from "../portal-discovery-evidence-contract.mjs";
import { validateRecipeTargetMetadata } from "../portal-discovery-recipe.mjs";
import { captureResponseBodyEvidence, graphQlOperationMetadata } from "../cdp-deep-capture.mjs";
import { hydrateResponseBodySidecars } from "../response-body-sidecars.mjs";
import {
  inspectRecipeSafety,
  prepareRecipeForRun,
  preflightRecipeTarget,
  verifyKnownOperationRefreshApproval,
} from "../run-portal-discovery.mjs";
import { summarizeActionResults } from "../discovery-capture-policy.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const variableBindingsDigest = prepareRecipeForRun({actions: [], inspectionPolicy: {mode: "observe-only"}}, []).__resolvedVariableBindingsDigest;

test("known-refresh expiry requires a valid timezone-bearing ISO timestamp", () => {
  for (const value of [
    "2030-01-02T03:04:05Z",
    "2030-01-02T03:04:05.123Z",
    "2030-01-02T03:04:05+05:30",
    "2030-01-02T03:04:05.123-07:00",
    "2024-02-29T23:59:59Z",
  ]) assert.equal(isValidKnownOperationRefreshExpiryTimestamp(value), true, value);
  for (const value of [
    "2030-01-02",
    "2030-01-02T03:04:05",
    "January 2, 2030",
    "2026-02-29T03:04:05Z",
    "2030-13-01T03:04:05Z",
    "2030-04-31T03:04:05Z",
    "2030-01-02T24:00:00Z",
    "2030-01-02T03:04:05+25:00",
  ]) assert.equal(isValidKnownOperationRefreshExpiryTimestamp(value), false, value);
});
test("past timestamps remain structurally valid for static metadata", () => {
  const expiresAt = "2000-01-01T00:00:00.000Z";
  assert.equal(isValidKnownOperationRefreshExpiryTimestamp(expiresAt), true);
  assert.equal(isValidKnownOperationRefreshExpiryTimestamp("not-a-date"), false);
  const recipe = recipeForIntegration();
  recipe.knownOperationRefresh.approvalExpiresAt = expiresAt;
  const plan = validateRecipeTargetMetadata(recipe).knownOperationRefreshPlan;
  assert.equal(plan.approvalExpiresAt, expiresAt);
  recipe.knownOperationRefresh.approvalExpiresAt = "not-a-date";
  assert.throws(() => validateRecipeTargetMetadata(recipe), /must be an ISO date-time/u);
});

test("collector binds exact persisted and literal GraphQL request identities", () => {
  const literalQuery = "query TenantConfigurationAndRoles { tenant { id } }";
  const persistedQuerySha256Hash = "d".repeat(64);
  const metadata = graphQlOperationMetadata({
    url: "https://engage.cloud.microsoft/graphql",
    requestBody: JSON.stringify({ operationName: "TenantConfigurationAndRoles", query: literalQuery, extensions: { persistedQuery: { sha256Hash: persistedQuerySha256Hash } } }),
  });
  assert.deepEqual(metadata, {
    kind: "query",
    name: "TenantConfigurationAndRoles",
    persistedQuerySha256Hash,
    literalQuerySha256Hash: sha256(literalQuery),
  });
  assert.equal(graphQlOperationMetadata({ url: "https://engage.cloud.microsoft/graphql", requestBody: "malformed" }).name, null);
});

function installWebSocket(evaluation) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class MockWebSocket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    send(rawMessage) {
      const message = JSON.parse(rawMessage);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ id: message.id, result: { result: { value: evaluation } } }),
      })));
    }
    close() {}
  };
  return () => { globalThis.WebSocket = original; };
}

async function mockCdp(target) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version") response.end(JSON.stringify({ Browser: "Edg/154.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }));
    else if (request.url === "/json/list") response.end(JSON.stringify([target]));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("known-operation refresh fixture binds metadata through terminal evidence without granting API probes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-known-refresh-"));
  const approvalDirectory = path.join(root, "tools", "frontier-approvals");
  await mkdir(approvalDirectory, { recursive: true });
  const sourceRelative = "tools/frontier-approvals/fullpath-source.json";
  const approvalRelative = "tools/frontier-approvals/fullpath.json";
  const sourceText = `${JSON.stringify({ schemaVersion: 1, operation: "GET /api/settings", retainedEvidence: "hash-only" }, null, 2)}\n`;
  await writeFile(path.join(root, sourceRelative), sourceText, "utf8");

  const recipe = {
    url: "https://admin.example.com/settings",
    matchHosts: ["admin.example.com"],
    pageTarget: { matchHosts: ["admin.example.com"], matchPathPrefixes: ["/settings"] },
    inspectionPolicy: { mode: "observe-only", prohibitedControlPatterns: ["Save", "Delete"] },
    actions: ["navigate=https://admin.example.com/settings", "wait-ms=1", "capture=known-settings"],
    knownOperationRefresh: {
      status: "active",
      method: "GET",
      host: "admin.example.com",
      routes: ["/api/settings"],
      state: "settings page after passive navigation",
      actionIndexes: [0, 2],
      approvalArtifact: approvalRelative,
      approvalDigest: "0".repeat(64),
      approvalExpiresAt: "2099-01-01T00:00:00.000Z",
      variableBindingsDigest,
      documentationObjectives: ["response-example"],
      evidenceIds: ["retained-settings-response"],
    },
  };
  const provisional = validateRecipeTargetMetadata(recipe).knownOperationRefreshPlan;
  const approvalText = `${JSON.stringify({
    schemaVersion: 1,
    decision: "accept-bounded-known-operation-refresh",
    specId: "test-settings",
    workerModel: "gpt-6-luna",
    workerReasoning: "xhigh",
    refreshDigest: provisional.refreshDigest,
    executionDigest: provisional.executionDigest,
    expiresAt: recipe.knownOperationRefresh.approvalExpiresAt,
    source: { artifactPath: sourceRelative, artifactSha256: sha256(sourceText) },
  }, null, 2)}\n`;
  await writeFile(path.join(root, approvalRelative), approvalText, "utf8");
  recipe.knownOperationRefresh.approvalDigest = sha256(approvalText);
  const recipePath = path.join(root, "recipe.json");
  await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");

  const metadata = validateRecipeTargetMetadata(recipe);
  const safety = await inspectRecipeSafety(recipePath);
  assert.equal(safety.safe, true);
  assert.equal(recipe.actions.some((action) => action.startsWith("probe-")), false);
  const approval = await verifyKnownOperationRefreshApproval(metadata.knownOperationRefreshPlan, { root, now: Date.parse("2026-10-03T00:00:00Z") });
  assert.equal(approval.refreshDigest, metadata.knownOperationRefreshPlan.refreshDigest);
  await assert.rejects(
    verifyKnownOperationRefreshApproval(metadata.knownOperationRefreshPlan, { root, now: Date.parse("2100-01-01T00:00:00.000Z") }),
    /approval binding or expiry is invalid before browser allocation/u,
  );

  const target = { type: "page", id: "page-1", title: "Settings", url: recipe.url, webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page-1" };
  const restore = installWebSocket({ title: "Settings", url: recipe.url, bodyText: "Settings" });
  const cdp = await mockCdp(target);
  t.after(async () => { restore(); await cdp.close(); });
  const preflight = await preflightRecipeTarget({ recipe, endpoint: cdp.endpoint, expectedProduct: "Edge", stabilityMs: 2, pollMs: 1, timeoutMs: 250 });
  assert.equal(preflight.alignment.status, "already-aligned");

  const actionResults = [
    { actionIndex: 0, required: true, type: "navigate", value: recipe.url, result: { resolvedUrl: recipe.url, url: recipe.url } },
    { actionIndex: 2, required: true, type: "capture", value: "known", result: { capturedOnly: true } },
  ];
  const accounting = summarizeActionResults(actionResults);
  assert.equal(accounting.requiredActionFailureCount, 0);
  const terminal = evaluateKnownOperationRefreshEvidence({
    plan: metadata.knownOperationRefreshPlan,
    actionResults,
    apiRecords: [{
      method: "GET",
      url: "https://admin.example.com/api/settings",
      status: 200,
      attribution: { actionIndex: 2 },
      bodyCapture: { state: "complete", sha256: "a".repeat(64) },
      responseBodyForAnalysis: "{\"value\":[]}",
    }],
  });
  assert.equal(terminal.status, "observed");
  assert.equal(terminal.evidenceAxes.schema, "observed");
  assert.equal(terminal.evidenceAxes.usage, "observed");
  assert.notEqual(terminal.evidenceAxes.usage, "execution-tested");
});

test("known-operation preflight blocks an unmatched real target", async (t) => {
  const recipe = {
    url: "https://admin.example.com/settings",
    pageTarget: { matchHosts: ["admin.example.com"], matchPathPrefixes: ["/settings"] },
  };
  const target = { type: "page", id: "page-2", title: "Other", url: "https://other.example.com/", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page-2" };
  const restore = installWebSocket({ title: "Other", url: target.url, bodyText: "Other" });
  const cdp = await mockCdp(target);
  t.after(async () => { restore(); await cdp.close(); });
  await assert.rejects(
    preflightRecipeTarget({ recipe, endpoint: cdp.endpoint, expectedProduct: "Edge", stabilityMs: 1, pollMs: 1, timeoutMs: 100 }),
    /exactly one matching page target/,
  );
});

test("collector serialization hydrates a scoped sidecar into terminal accounting", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-known-collector-"));
  const evidenceId = "request-integration";
  const captured = await captureResponseBodyEvidence({
    artifactDir,
    evidenceId,
    payload: { body: '{"value":[{"name":"safe"}]}', base64Encoded: false },
    requestUrl: "https://admin.example.com/api/settings",
    matchHosts: ["admin.example.com"],
    matchPathPrefixes: ["/api/settings"],
  });
  assert.equal(captured.bodyCapture.state, "complete");
  const record = {
    evidenceId,
    method: "GET",
    url: "https://admin.example.com/api/settings",
    status: 200,
    observedAt: "2026-10-03T12:00:00.000Z",
    matchesCurrentSpec: true,
    attribution: { actionIndex: 2 },
    responseBodySample: captured.responseBody,
    bodyCapture: captured.bodyCapture,
  };
  const recordsPath = path.join(artifactDir, "api-records.json");
  await writeFile(recordsPath, `${JSON.stringify([record], null, 2)}\n`, "utf8");
  const serialized = JSON.parse(await readFile(recordsPath, "utf8"));
  await hydrateResponseBodySidecars(serialized, artifactDir);
  const plan = validateRecipeTargetMetadata({
    ...recipeForIntegration(),
    __resolvedVariableBindingsDigest: variableBindingsDigest,
  }).knownOperationRefreshPlan;
  const terminal = evaluateKnownOperationRefreshEvidence({
    plan,
    actionResults: [
      { actionIndex: 0, type: "navigate", value: "https://admin.example.com/settings", result: { resolvedUrl: "https://admin.example.com/settings", url: "https://admin.example.com/settings" } },
      { actionIndex: 2, type: "capture", value: "known", result: { capturedOnly: true } },
    ],
    apiRecords: serialized,
  });
  assert.equal(terminal.status, "observed");
  assert.equal(terminal.completeBodyRecordCount, 1);
  assert.equal(terminal.health.status, "healthy-observed");
  assert.equal(terminal.health.lastSuccessfulObservationAt, record.observedAt);

  const adjacent = await captureResponseBodyEvidence({
    artifactDir,
    evidenceId: "request-adjacent",
    payload: { body: '{"value":[{"name":"adjacent"}]}', base64Encoded: false },
    requestUrl: "https://adjacent.example.com/api/settings",
    matchHosts: ["admin.example.com"],
    matchPathPrefixes: ["/api/settings"],
  });
  assert.equal(adjacent.bodyCapture.state, "truncated");
  assert.equal(adjacent.bodyCapture.path, null);
});

function recipeForIntegration() {
  return {
    url: "https://admin.example.com/settings",
    matchHosts: ["admin.example.com"],
    pageTarget: { matchHosts: ["admin.example.com"], matchPathPrefixes: ["/settings"] },
    inspectionPolicy: { mode: "observe-only", prohibitedControlPatterns: ["Save"] },
    actions: ["navigate=https://admin.example.com/settings", "wait-ms=1", "capture=known-settings"],
    knownOperationRefresh: {
      status: "active",
      method: "GET",
      host: "admin.example.com",
      routes: ["/api/settings"],
      state: "settings after passive navigation",
      actionIndexes: [0, 2],
      approvalArtifact: "tools/frontier-approvals/test.json",
      approvalDigest: "a".repeat(64),
      approvalExpiresAt: "2099-01-01T00:00:00.000Z",
      variableBindingsDigest,
      documentationObjectives: ["response-example"],
      evidenceIds: ["retained-settings-response"],
    },
  };
}
