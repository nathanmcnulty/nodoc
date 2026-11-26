import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildAcceptanceEvidence,
  createOfflineReadOnlyClient,
  findOperation,
  inspectIncident,
} from "../clients/defender-incident-readonly/client.mjs";
import { startSyntheticMockServer } from "../clients/defender-incident-readonly/mock-server.mjs";
import {
  buildSpecInventory,
  loadBundledSpecification,
  repoRoot,
} from "../spec-quality-lib.mjs";

const exampleDirectory = path.join(repoRoot, "tools", "clients", "defender-incident-readonly");
const examples = JSON.parse(await readFile(path.join(exampleDirectory, "synthetic-examples.json"), "utf8"));
const inventory = await buildSpecInventory();
const specEntry = inventory.find((entry) => entry.specId === "defender-xdr");
assert.ok(specEntry, "Defender XDR must be present in the published spec inventory.");
const specification = await loadBundledSpecification(path.resolve(repoRoot, specEntry.specPath));

test("offline incident workflow fetches details then associated alerts from synthetic examples", async () => {
  const requests = [];
  const server = await startSyntheticMockServer({
    specification,
    examples,
    onRequest: (request) => requests.push({
      operationId: request.operationId,
      method: request.method,
      pathname: request.url.pathname,
      incidentId: request.url.searchParams.get("incidentId"),
    }),
  });
  try {
    const client = createOfflineReadOnlyClient({ specification, baseUrl: server.baseUrl });
    const result = await inspectIncident(client, "SYNTHETIC-INCIDENT-001");
    assert.deepEqual(result.incident, examples.responses["Incidents.Get"].body);
    assert.deepEqual(result.alerts, examples.responses["Incidents.GetAssociatedAlerts"].body);
    assert.deepEqual(requests, [
      {
        operationId: "Incidents.Get",
        method: "GET",
        pathname: "/mtp/incidentQueue/incidents/SYNTHETIC-INCIDENT-001",
        incidentId: null,
      },
      {
        operationId: "Incidents.GetAssociatedAlerts",
        method: "GET",
        pathname: "/mtp/incidentQueue/incidents/alerts",
        incidentId: "SYNTHETIC-INCIDENT-001",
      },
    ]);
  } finally {
    await server.close();
  }
});

test("client refuses non-GET operations before making a request and blocks remote hosts", async () => {
  let fetchCalls = 0;
  const client = createOfflineReadOnlyClient({
    specification,
    baseUrl: "http://127.0.0.1:1/",
    fetchImplementation: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    },
  });
  assert.equal(findOperation(specification, "Alerts.List").method, "POST");
  await assert.rejects(client.get("Alerts.List"), /refuses POST operation/u);
  assert.equal(fetchCalls, 0);
  assert.throws(() => createOfflineReadOnlyClient({
    specification,
    baseUrl: "https://security.microsoft.com/apiproxy/",
  }), /loopback mock server/u);
});

test("evidence report separates documented contract, typed observations, and unknowns", async () => {
  assert.match(examples.label, /^Synthetic example only/u);
  const report = await buildAcceptanceEvidence(specification, [
    "Incidents.Get",
    "Incidents.GetAssociatedAlerts",
  ]);
  assert.equal(report.observedEvidenceSource, "published typed behavior evidence only; synthetic replay is not observation evidence");
  assert.equal(report.operations.length, 2);
  for (const operation of report.operations) {
    assert.equal(operation.method, "GET");
    assert.equal(operation.documented.auth.state, "documented");
    assert.deepEqual(operation.documented.auth.schemes, [
      { name: "PortalSession", type: "apiKey", in: "cookie", parameterName: "sccauth" },
    ]);
    assert.ok(operation.documented.statusMediaTypes.some((response) => response.status === "200" && response.mediaType === "application/json"));
    assert.ok(operation.documented.errors.some((response) => response.status === "401"));
    assert.equal(operation.observed.auth.state, "unknown");
    assert.equal(operation.observed.statusMediaTypes.state, "unknown");
    assert.equal(operation.observed.errors.state, "unknown");
    assert.equal(operation.observed.pagination.state, "unknown");
    assert.equal(operation.observed.concurrency.state, "unknown");
    assert.equal(operation.observed.async.state, "unknown");
    assert.ok(operation.unknown.includes("observed.statusMediaTypes"));
    assert.ok(operation.unknown.includes("observed.errors"));
  }
});
