import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioManifest,
  compileOrchestrationPlan,
  validateOrchestrationPlan,
  validateWorkerResult,
  workerResultSubjectDigest,
  projectPortfolioStatus,
} from "../portal-discovery-control-plane.mjs";

test("materialized portfolio and plan are stable and serialize shared capture leases", async () => {
  const manifest = await buildPortfolioManifest();
  const plan = compileOrchestrationPlan(manifest, { budgets: { maxCaptures: 3 } });
  assert.deepEqual(plan, compileOrchestrationPlan(manifest, { budgets: { maxCaptures: 3 } }));
  assert.equal(plan.mode, "report-only");
  assert.equal(plan.completion.terminal, "plan-ready");
  assert.equal(plan.totals.serializedCaptureCount <= plan.totals.captureCount, true);
  assert.deepEqual(plan.modelPolicy.capture, { model: "gpt-5.6-luna", reasoning: "low" });
  assert.deepEqual(plan.modelPolicy.orchestrator, { model: "gpt-5.6-sol", reasoning: "high" });
  assert.equal(plan.assignments.find((entry) => entry.type === "review")?.reasoning, "xhigh");
  assert.equal(plan.assignments.find((entry) => entry.type === "review")?.qualityGate.model, "gpt-5.6-sol");
  const maxReviewPlan = compileOrchestrationPlan(manifest, { budgets: { maxCaptures: 1 }, options: { offlineReviewReasoning: "max" } });
  assert.equal(maxReviewPlan.assignments.find((entry) => entry.type === "review")?.reasoning, "max");
  assert.throws(() => compileOrchestrationPlan(manifest, { options: { offlineReviewReasoning: "high" } }), /xhigh or max/);
  validateOrchestrationPlan(plan);
});

test("Purview Portal derives its outstanding freshness gap from coverage metadata", async () => {
  const manifest = await buildPortfolioManifest();
  const portal = manifest.portals.find((entry) => entry.specId === "purview-portal");
  assert.deepEqual(portal?.outstandingGapClasses, ["fresh-capture"]);
  assert.equal(portal?.source.nextPass, "full-layered-crawl");
});

test("filtered Intune Autopatch controller blocks its satisfied deep recipe before capture", async () => {
  const manifest = await buildPortfolioManifest();
  const intune = manifest.portals.find((portal) => portal.specId === "intune-autopatch");
  assert.equal(intune?.recipe, "tools/capture-recipes/intune-autopatch-deep.json");
  assert.equal(intune?.novelty.evidenceDisposition, "capture-freshness-gap");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [intune] }, { budgets: { maxCaptures: 1 } });
  assert.equal(plan.assignments.some((entry) => entry.type === "capture"), false);
  assert.ok(plan.assignments.find((entry) => entry.type === "review")?.blockers.includes("novelty-satisfied"));
  assert.ok(plan.assignments.find((entry) => entry.type === "review")?.blockers.includes("capture-freshness-gap"));
});

test("Entra PIM exposes missing immutable state provenance as its prebrowser blocker", async () => {
  const manifest = await buildPortfolioManifest();
  const pim = manifest.portals.find((portal) => portal.specId === "entra-pim");
  assert.equal(pim?.novelty.evidenceDisposition, "missing-immutable-state-provenance");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [pim] }, { budgets: { maxCaptures: 1 } });
  assert.equal(plan.assignments.some((entry) => entry.type === "capture"), false);
  assert.ok(plan.assignments.find((entry) => entry.type === "review")?.blockers.includes("missing-immutable-state-provenance"));
});

test("filtered M365 Apps Services controller blocks its satisfied deep recipe before capture", async () => {
  const manifest = await buildPortfolioManifest();
  const services = manifest.portals.find((portal) => portal.specId === "m365-apps-services");
  assert.equal(services?.recipe, "tools/capture-recipes/m365-apps-services-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [services] }, { budgets: { maxCaptures: 1 } });
  assert.equal(plan.assignments.some((entry) => entry.type === "capture"), false);
  assert.ok(plan.assignments.find((entry) => entry.type === "review")?.blockers.includes("novelty-satisfied"));
});

test("filtered M365 Apps Config controller blocks its satisfied deep recipe before capture", async () => {
  const manifest = await buildPortfolioManifest();
  const config = manifest.portals.find((portal) => portal.specId === "m365-apps-config");
  assert.equal(config?.recipe, "tools/capture-recipes/m365-apps-config-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [config] }, { budgets: { maxCaptures: 1 } });
  assert.equal(plan.assignments.some((entry) => entry.type === "capture"), false);
  assert.ok(plan.assignments.find((entry) => entry.type === "review")?.blockers.includes("novelty-satisfied"));
});

test("filtered M365 Apps Inventory controller blocks its satisfied deep recipe before capture", async () => {
  const manifest = await buildPortfolioManifest();
  const inventory = manifest.portals.find((portal) => portal.specId === "m365-apps-inventory");
  assert.equal(inventory?.recipe, "tools/capture-recipes/m365-apps-inventory-deep.json");

  const plan = compileOrchestrationPlan({ ...manifest, portals: [inventory] }, { budgets: { maxCaptures: 1 } });
  assert.equal(plan.assignments.some((entry) => entry.type === "capture"), false);
  assert.ok(plan.assignments.find((entry) => entry.type === "review")?.blockers.includes("novelty-satisfied"));
});

test("unresolved adjacent ownership blocks only its related active frontier", async () => {
  const manifest = await buildPortfolioManifest();
  const portals = manifest.portals.slice(0, 2).map((portal) => ({
    ...portal,
    enabled: true,
    novelty: { approvalDigest: "e".repeat(64), reopenCondition: "Exact new read-only state.", status: "active" },
    outstandingGapClasses: [],
    riskTier: "low",
  }));
  const affected = portals[0];
  const plan = compileOrchestrationPlan({ ...manifest, portals }, {
    options: { adjacentOwnership: [{ hostFamily: `HTTPS://${affected.endpoint.hostFamily.toUpperCase()}:443`, specId: "different-spec", status: "unresolved" }] },
  });
  assert.equal(plan.assignments.some((entry) => entry.type === "capture" && entry.specId === affected.specId), false);
  assert.equal(plan.assignments.some((entry) => entry.type === "capture" && entry.specId === portals[1].specId), true);
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
  const plan = compileOrchestrationPlan({ ...manifest, portals: [{ ...manifest.portals[0], novelty: { approvalDigest: "f".repeat(64), reopenCondition: "Exact new read-only state.", status: "active" }, riskTier: "low", outstandingGapClasses: [] }] });
  const assignment = plan.assignments.find((entry) => entry.type === "review" && entry.route === "cheap");
  const workerResult = { schemaVersion: 1, assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, assignmentType: "review", status: "completed", model: "gpt-5.6-luna", reasoning: "xhigh", decision: "no-action", reasonCodes: ["routine-read-only"], blockers: [], metrics: { complete: true }, recommendedNextAction: "none", lessons: ["reviewed immutable evidence"], lifecycleAccounting: { terminalOwnerShutdown: true, artifactLedgerAccounting: true }, processImprovementDisposition: "none", candidateAccounting: { accepted: [], rejected: [], escalated: [], blocked: [] }, evidenceAccounting: { accepted: [], rejected: [], escalated: [], blocked: [] } };
  const result = {
    ...workerResult,
    qualityGate: {
      schemaVersion: 1,
      assignmentId: assignment.assignmentId,
      assignmentDigest: assignment.assignmentDigest,
      decision: "accept",
      model: "gpt-5.6-sol",
      reasoning: "high",
      reviewedAt: "2026-08-27T00:00:00.000Z",
      workerResultDigest: workerResultSubjectDigest(workerResult),
    },
  };
  assert.equal(validateWorkerResult(result, plan).sanitized, true);
  assert.throws(() => validateWorkerResult({ ...result, model: "gpt-5.6-terra" }, plan), /exact runtime model/);
  assert.throws(() => validateWorkerResult({ ...result, reasoning: "high" }, plan), /exact reasoning/);
  assert.throws(() => validateWorkerResult({ ...result, reasonCodes: ["state-changing"] }, plan), /capability violation/);
  assert.throws(() => validateWorkerResult({ ...result, qualityGate: undefined }, plan), /requires a Sol orchestrator quality gate/);
  assert.throws(() => validateWorkerResult({ ...result, qualityGate: { ...result.qualityGate, model: "gpt-5.6-luna" } }, plan), /exact runtime model gpt-5.6-sol/);
  assert.throws(() => validateWorkerResult({ ...result, qualityGate: { ...result.qualityGate, decision: "reject" } }, plan), /did not accept/);
  assert.throws(() => validateWorkerResult({ ...result, qualityGate: { ...result.qualityGate, workerResultDigest: "0".repeat(64) } }, plan), /digest mismatch/);
  assert.deepEqual(projectPortfolioStatus(manifest).portals.length, manifest.portals.length);
});

test("portfolio status reports the newest assignment and its capture quality", async () => {
  const manifest = await buildPortfolioManifest();
  const specId = manifest.portals[0].specId;
  const status = projectPortfolioStatus(manifest, {
    assignments: [
      {
        assignmentId: "older-blocked",
        specId,
        state: "blocked",
        updatedAt: "2026-08-29T10:00:00.000Z",
        latestAttempt: { captureComplete: true, captureStatus: "complete", blocker: { code: "objective-incomplete" } },
      },
      {
        assignmentId: "newer-completed",
        specId,
        state: "completed",
        updatedAt: "2026-08-29T11:00:00.000Z",
        latestAttempt: { captureComplete: false, captureStatus: "interrupted", blocker: null },
      },
    ],
  }).portals.find((entry) => entry.specId === specId);
  assert.deepEqual(status, {
    specId,
    enabled: true,
    state: "completed",
    latestAssignmentId: "newer-completed",
    latestAssignmentUpdatedAt: "2026-08-29T11:00:00.000Z",
    captureComplete: false,
    captureStatus: "interrupted",
    blockerCode: null,
  });
});
