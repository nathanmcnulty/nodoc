import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPortfolioManifest,
  compileOrchestrationPlan,
  validateOrchestrationPlan,
} from "./portal-discovery-control-plane.mjs";
import { buildReviewAssignmentPlan, validateReviewAssignmentPlan } from "./discovery-review-assignments.mjs";
import { compilePromotionPlan, validatePromotionPlan } from "./portal-discovery-promotion-planner.mjs";
import { compileRetrospective, validateRetrospective } from "./portal-discovery-retrospective.mjs";
import { calculateUnresolvedFrontier, scheduleFrontier, validateFrontier } from "./portal-discovery-frontier.mjs";
import { loadBenchmarkCorpus, runOfflineBenchmark, validateBenchmarkScorecard } from "./portal-discovery-benchmark.mjs";

export const controllerSchemaVersion = 1;
export const controllerStates = ["planned", "blocked", "awaiting-auth", "awaiting-capture-lease", "capture-recommended", "awaiting-artifacts", "offline-ready", "review-ready", "promotion-ready", "awaiting-PR", "awaiting-CI", "awaiting-review", "merge-ready", "merged", "retrospective-ready", "saturated-complete", "failed"];
export const controllerReasonCodes = ["portfolio-invalid", "dependency-blocked", "budget-exhausted", "capture-recommended", "artifacts-required", "offline-analysis-ready", "review-required", "promotion-required", "benchmark-regression", "frontier-unresolved", "canonical-health-incomplete", "saturation-gates-passed", "explicit-apply-required", "input-tampered", "schema-incompatible"];

const stableJson = (value) => `${JSON.stringify(value)}\n`;
const digest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
const unsafe = /tenant|bearer|cookie|authorization|password|secret|credential|https?:\/\/|[A-Za-z]:\\/iu;
function assertSafe(value, label) { if (unsafe.test(JSON.stringify(value))) throw new Error(`${label} contains prohibited sensitive data.`); }
function clean(value) { if (value === undefined) return null; if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value; if (Array.isArray(value)) return value.map(clean); return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, clean(entry)])); }

const transitions = {
  planned: new Set(["blocked", "capture-recommended", "offline-ready", "failed"]),
  blocked: new Set(["planned", "failed"]),
  "capture-recommended": new Set(["awaiting-auth", "awaiting-capture-lease", "awaiting-artifacts", "offline-ready"]),
  "awaiting-auth": new Set(["capture-recommended", "failed"]),
  "awaiting-capture-lease": new Set(["capture-recommended", "failed"]),
  "awaiting-artifacts": new Set(["offline-ready", "failed"]),
  "offline-ready": new Set(["review-ready", "promotion-ready", "retrospective-ready", "blocked"]),
  "review-ready": new Set(["promotion-ready", "awaiting-review", "blocked"]),
  "promotion-ready": new Set(["awaiting-PR", "merge-ready", "blocked"]),
  "awaiting-PR": new Set(["awaiting-CI", "failed"]),
  "awaiting-CI": new Set(["awaiting-review", "merge-ready", "failed"]),
  "awaiting-review": new Set(["merge-ready", "failed"]),
  "merge-ready": new Set(["merged", "failed"]),
  merged: new Set(["retrospective-ready", "saturated-complete"]),
  "retrospective-ready": new Set(["saturated-complete", "planned"]),
  "saturated-complete": new Set(["saturated-complete"]),
  failed: new Set(["planned", "failed"]),
};

export function transitionControllerState(state, next, reasonCode) {
  if (!controllerStates.includes(state) || !controllerStates.includes(next) || !transitions[state]?.has(next)) throw new Error(`Invalid controller state transition ${state} -> ${next}.`);
  if (!controllerReasonCodes.includes(reasonCode)) throw new Error(`Unknown controller reason code ${reasonCode}.`);
  return { state: next, reasonCode };
}

export function compileIntegratedController({ manifest, groupedHandoff = null, specInventory = [], discovery = {}, retrospectiveInput = null, benchmarkCorpus, options = {}, budgets = {}, stageInputs = {} } = {}) {
  assertSafe({ groupedHandoff, discovery, retrospectiveInput, benchmarkCorpus, options, budgets, stageInputs }, "controller input");
  if (!manifest || manifest.schemaVersion !== 1) throw new Error("A validated materialized portfolio manifest is required.");
  const plan = compileOrchestrationPlan(manifest, { budgets, options: { ...options, apply: false } });
  validateOrchestrationPlan(plan);
  const reviewPlan = groupedHandoff ? buildReviewAssignmentPlan(groupedHandoff, stageInputs.derivatives ?? {}) : null;
  if (reviewPlan) validateReviewAssignmentPlan(reviewPlan);
  const promotionPlan = groupedHandoff ? compilePromotionPlan({ groupedHandoff, reviewPlan, workerResults: stageInputs.workerResults ?? [], derivativeRecommendations: stageInputs.derivativeRecommendations ?? [], specInventory, options: { apply: false }, budgets: budgets.promotion ?? {} }) : null;
  if (promotionPlan) validatePromotionPlan(promotionPlan);
  const retrospective = retrospectiveInput ? compileRetrospective(retrospectiveInput) : null;
  if (retrospective) validateRetrospective(retrospective);
  const benchmark = runOfflineBenchmark(benchmarkCorpus, { inputs: stageInputs.benchmarkInputs ?? {} });
  validateBenchmarkScorecard(benchmark);
  const frontier = calculateUnresolvedFrontier({ discovery, portfolio: manifest, benchmark, metadata: stageInputs.metadata ?? {} });
  validateFrontier(frontier);
  const frontierSchedule = scheduleFrontier(frontier, { budgets: budgets.frontier ?? {}, saturation: discovery.saturation ?? "unknown" });
  const benchmarkBlocked = benchmark.measurements.failCount > 0;
  const state = benchmarkBlocked ? "blocked" : frontier.items.length ? "capture-recommended" : (discovery.saturation === "reached" ? "saturated-complete" : "offline-ready");
  const reasonCode = benchmarkBlocked ? "benchmark-regression" : frontier.items.length ? "frontier-unresolved" : (state === "saturated-complete" ? "saturation-gates-passed" : "offline-analysis-ready");
  const core = { schemaVersion: controllerSchemaVersion, mode: "report-only", state, reasonCode, portfolio: { manifestId: manifest.manifestId, planId: plan.planId, planDigest: plan.planDigest }, execution: { preflight: { dependencies: "validated", budgets: clean(budgets), apply: false }, captureQueue: plan.assignments.filter((entry) => entry.type === "capture"), offlineParallelUnits: plan.totals.parallelOfflineCount }, reviewPlan, promotionPlan, retrospective, benchmark, frontier, frontierSchedule, nextActions: state === "saturated-complete" ? ["retain protected landing and begin retrospective"] : state === "blocked" ? ["repair blockers before any apply"] : ["review report and authorize capture separately"], measurements: { synthetic: true, serializedCaptureCount: plan.totals.serializedCaptureCount, parallelOfflineCount: plan.totals.parallelOfflineCount, maxControllerPayloadBytes: Buffer.byteLength(stableJson({ plan, reviewPlan, promotionPlan, retrospective, benchmark, frontier }), "utf8") } };
  return { ...core, executionId: `controller-${digest(core).slice(0, 24)}`, executionDigest: digest(core) };
}

export async function compileIntegratedControllerFromFiles({ manifestPath, benchmarkPath, stageInputPath, ...options } = {}) {
  const manifest = await buildPortfolioManifest(manifestPath);
  const benchmarkCorpus = await loadBenchmarkCorpus(benchmarkPath);
  const stageInputs = stageInputPath ? JSON.parse(await readFile(path.resolve(stageInputPath), "utf8")) : {};
  return compileIntegratedController({ ...options, manifest, benchmarkCorpus, stageInputs });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Use node tools/portal-discovery-controller.mjs <stage-input.json>.");
  compileIntegratedControllerFromFiles(JSON.parse(await readFile(path.resolve(inputPath), "utf8"))).then((report) => process.stdout.write(stableJson(report))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
