import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioManifest,
  compileOrchestrationPlan,
  validateOrchestrationPlan,
  validateWorkerResult,
  projectPortfolioStatus,
} from "../portal-discovery-control-plane.mjs";

test("materialized portfolio and plan are stable and serialize shared capture leases", async () => {
  const manifest = await buildPortfolioManifest();
  const plan = compileOrchestrationPlan(manifest, { budgets: { maxCaptures: 3 } });
  assert.deepEqual(plan, compileOrchestrationPlan(manifest, { budgets: { maxCaptures: 3 } }));
  assert.equal(plan.mode, "report-only");
  assert.equal(plan.completion.terminal, "plan-ready");
  assert.equal(plan.totals.serializedCaptureCount <= plan.totals.captureCount, true);
  validateOrchestrationPlan(plan);
});

test("filtered Intune Autopatch controller plans select the exact deep recipe", async () => {
  const manifest = await buildPortfolioManifest();
  const intune = manifest.portals.find((portal) => portal.specId === "intune-autopatch");
  assert.equal(intune?.recipe, "tools/capture-recipes/intune-autopatch-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [intune] }, { budgets: { maxCaptures: 1 } });
  assert.equal(
    plan.assignments.find((entry) => entry.type === "capture")?.recipe,
    "tools/capture-recipes/intune-autopatch-deep.json",
  );
});

test("filtered M365 Apps Services controller plans select the exact deep recipe", async () => {
  const manifest = await buildPortfolioManifest();
  const services = manifest.portals.find((portal) => portal.specId === "m365-apps-services");
  assert.equal(services?.recipe, "tools/capture-recipes/m365-apps-services-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [services] }, { budgets: { maxCaptures: 1 } });
  assert.equal(
    plan.assignments.find((entry) => entry.type === "capture")?.recipe,
    "tools/capture-recipes/m365-apps-services-deep.json",
  );
});

test("filtered M365 Apps Config controller plans select the exact deep recipe", async () => {
  const manifest = await buildPortfolioManifest();
  const config = manifest.portals.find((portal) => portal.specId === "m365-apps-config");
  assert.equal(config?.recipe, "tools/capture-recipes/m365-apps-config-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [config] }, { budgets: { maxCaptures: 1 } });
  assert.equal(
    plan.assignments.find((entry) => entry.type === "capture")?.recipe,
    "tools/capture-recipes/m365-apps-config-deep.json",
  );
});

test("filtered M365 Apps Inventory controller plans select the exact deep recipe", async () => {
  const manifest = await buildPortfolioManifest();
  const inventory = manifest.portals.find((portal) => portal.specId === "m365-apps-inventory");
  assert.equal(inventory?.recipe, "tools/capture-recipes/m365-apps-inventory-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [inventory] }, { budgets: { maxCaptures: 1 } });
  assert.equal(
    plan.assignments.find((entry) => entry.type === "capture")?.recipe,
    "tools/capture-recipes/m365-apps-inventory-deep.json",
  );
});

test("disabled and missing recipe portals are blocked without live allocation", async () => {
  const manifest = await buildPortfolioManifest();
  const changed = { ...manifest, portals: [{ ...manifest.portals[0], enabled: false, recipe: null }] };
  const plan = compileOrchestrationPlan(changed);
  assert.equal(plan.assignments.some((entry) => entry.type === "capture" && entry.blockers.includes("disabled")), false);
  assert.equal(plan.assignments.some((entry) => entry.type === "review" && entry.route === "orchestrator"), true);
});

test("worker result preserves exact accounting and rejects cheap capability violations", async () => {
  const manifest = await buildPortfolioManifest();
  const plan = compileOrchestrationPlan({ ...manifest, portals: [{ ...manifest.portals[0], riskTier: "low", outstandingGapClasses: [] }] });
  const assignment = plan.assignments.find((entry) => entry.type === "review" && entry.route === "cheap");
  const result = { schemaVersion: 1, assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, assignmentType: "review", status: "completed", decision: "no-action", reasonCodes: ["routine-read-only"], blockers: [], metrics: { complete: true }, recommendedNextAction: "none", candidateAccounting: { accepted: [], rejected: [], escalated: [], blocked: [] }, evidenceAccounting: { accepted: [], rejected: [], escalated: [], blocked: [] } };
  assert.equal(validateWorkerResult(result, plan).sanitized, true);
  assert.throws(() => validateWorkerResult({ ...result, reasonCodes: ["state-changing"] }, plan), /capability violation/);
  assert.deepEqual(projectPortfolioStatus(manifest).portals.length, manifest.portals.length);
});
