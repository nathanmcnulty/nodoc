import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  crawlMetadataByTitle,
  getCaptureRecipes,
  getCoverageOverlay,
} from "./portal-discovery-metadata.mjs";
import { getLedgerViewFromFile, enqueueAssignment, normalizeEndpoint } from "./portal-discovery-ledger.mjs";
import { buildSpecInventory, loadBundledSpecification, repoRoot } from "./spec-quality-lib.mjs";
import { deriveNoveltyBaseline } from "./portal-discovery-novelty.mjs";
import { buildKnownOperationRefreshPlan, evaluateKnownOperationRefreshEvidence } from "./portal-discovery-evidence-contract.mjs";
import { aggregateInteractionHealth, summarizeActionResults, actionResultSucceeded } from "./discovery-capture-policy.mjs";
import { hydrateResponseBodySidecars, assessResponseBodySidecarCompleteness } from "./response-body-sidecars.mjs";
import { normalizeRecipeAction } from "./portal-discovery-actions.mjs";
import {
  portalDiscoveryModelPolicy,
  validateOfflineReviewReasoning,
} from "./portal-discovery-model-policy.mjs";
import { loadReviewCache, writeReviewCache } from "./portal-discovery-review-cache.mjs";
import { privateRefreshDirectory, assertNoRefreshLinks } from "./portal-refresh-paths.mjs";

export const portfolioManifestSchemaVersion = 1;
export const orchestrationPlanSchemaVersion = 1;
export const workerResultSchemaVersion = 1;
export const requiredReviewModel = portalDiscoveryModelPolicy.offlineReview.model;
export const requiredOrchestratorModel = portalDiscoveryModelPolicy.orchestrator.model;
export const defaultPortfolioManifestPath = path.join(repoRoot, "tools", "portal-discovery-portfolio.json");

const routes = new Set(["cheap", "luna", "manual", "orchestrator"]);
const assignmentTypes = new Set(["capture", "review", "promotion-preparation", "process-improvement"]);
const statuses = new Set(["planned", "queued", "running", "completed", "blocked", "failed", "rejected"]);
const decisions = new Set(["accept", "reject", "escalate", "block", "retry", "no-action"]);
const terminalReviewDecisions = new Set(["accept", "reject", "escalate", "block", "no-action"]);
const transitions = {
  planned: new Set(["queued", "running", "blocked", "failed", "rejected"]),
  queued: new Set(["running", "blocked", "failed", "rejected"]),
  running: new Set(["completed", "blocked", "failed", "rejected"]),
  completed: new Set(["completed"]),
  blocked: new Set(["blocked", "queued"]),
  failed: new Set(["failed", "queued"]),
  rejected: new Set(["rejected"]),
};

function stableJson(value) { return `${JSON.stringify(value)}\n`; }
export function digest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
async function checkedInRecipeDigest(recipePath) {
  const absolute = path.resolve(repoRoot, requiredString(recipePath, "recipe path"));
  const relative = path.relative(repoRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Capture recipe must resolve to a checked-in repository file.");
  }
  return createHash("sha256").update(await readFile(absolute)).digest("hex");
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sorted(values) { return [...values].sort((left, right) => String(left).localeCompare(String(right))); }
function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function assignmentDigest(value) {
  return digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "assignmentId" && key !== "assignmentDigest")));
}

// Reuse the driver's recipe/approval validators. This remains part of the existing
// control plane, and performs no browser, authentication or ledger operation.
export async function prepareManagedKnownRefresh(manifest, { specId, recipe, variables = [], endpoint, workerId }) {
  const portal = manifest.portals.find(entry => entry.specId === specId);
  if (!portal || !portal.enabled || portal.auth.profile !== "bounded") throw new Error("Managed capture requires an enabled bounded-profile portal.");
  const recipePath = getCaptureRecipes(portal.title).find(file => path.resolve(repoRoot, file) === path.resolve(repoRoot, recipe));
  if (!recipePath) throw new Error("Managed capture recipe is not registered to this portal.");
  if (requiredString(workerId, "Managed workerId") !== workerId || /\s|\u007f/u.test(workerId) || workerId.length > 200) throw new Error("Managed workerId must be explicit and unchanged by ledger sanitization.");
  const { prepareRecipeForRun, validateSelectedRecipeTarget, inspectRecipeSafety, verifyKnownOperationRefreshApproval, buildActionBudget } = await import("./run-portal-discovery.mjs");
  const raw = await readJson(path.join(repoRoot, recipePath));
  if (raw.capturePrerequisite?.status === "blocked") throw new Error("Managed capture recipe has an unmet capture prerequisite.");
  const resolved = prepareRecipeForRun(raw, variables);
  validateSelectedRecipeTarget(resolved);
  const safety = await inspectRecipeSafety(path.join(repoRoot, recipePath), { variables, operationCeiling: "observe-only" });
  if (!safety.safe || resolved.inspectionPolicy?.mode !== "observe-only") throw new Error("Managed known refresh must be observe-only.");
  const baseline = deriveNoveltyBaseline(await loadBundledSpecification(path.join(repoRoot, portal.source.specPath)));
  const refresh = buildKnownOperationRefreshPlan(resolved, { required: true, baselineOperations: baseline.operations });
  await verifyKnownOperationRefreshApproval(refresh);
  const callerEndpoint = normalizeEndpoint(new URL(refresh.entryUrl).origin);
  if (endpoint && normalizeEndpoint(endpoint) !== callerEndpoint) throw new Error("Managed endpoint must match the native caller origin.");
  const managedCapture = { kind: "known-operation-refresh", recipeSha256: await checkedInRecipeDigest(recipePath), endpoint: callerEndpoint,
    refreshDigest: refresh.refreshDigest, executionDigest: refresh.executionDigest, variableBindingsDigest: refresh.variableBindingsDigest,
    operationCeiling: "observe-only", actionBudget: buildActionBudget(resolved), workerId };
  return { ...manifest, portals: [{ ...portal, recipe: recipePath, managedCapture }] };
}

export function validateManagedCaptureAssignment(plan, input) {
  validateOrchestrationPlan(plan);
  const assignment = plan.assignments.find(entry => entry.assignmentId === input.assignmentId);
  const bound = assignment?.managedCapture;
  if (!bound || assignment.type !== "capture" || assignment.assignmentDigest !== input.assignmentDigest || !input.workerId
    || bound.workerId !== input.workerId || assignment.specId !== input.specId || assignment.profile !== input.profile
    || path.resolve(repoRoot, assignment.recipe) !== path.resolve(input.recipePath) || bound.recipeSha256 !== input.recipeSha256
    || bound.endpoint !== normalizeEndpoint(input.endpoint) || bound.operationCeiling !== input.operationCeiling
    || assignment.model !== input.model || assignment.reasoning !== input.reasoning
    || bound.refreshDigest !== input.refreshPlan?.refreshDigest || bound.executionDigest !== input.refreshPlan?.executionDigest
    || bound.variableBindingsDigest !== input.refreshPlan?.variableBindingsDigest || digest(bound.actionBudget) !== digest(input.actionBudget)) {
    throw new Error("Managed capture assignment does not match the validated plan and exact runtime inputs.");
  }
  return assignment;
}
export function workerResultSubjectDigest(value) {
  return digest(Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => key !== "qualityGate")));
}
function sanitize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 2000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitize);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sanitize(entry)]));
  return null;
}

async function readJson(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { throw new Error(`Unable to read JSON schema input ${filePath}: ${error.message}`); }
}

export async function loadPortfolioManifest(manifestPath = defaultPortfolioManifestPath) {
  const raw = await readJson(manifestPath);
  return validatePortfolioManifest(raw);
}

export function validatePortfolioManifest(raw, inventory = null) {
  if (!raw || raw.schemaVersion !== portfolioManifestSchemaVersion || !Array.isArray(raw.portals)) {
    throw new Error("Unsupported or corrupt portal portfolio manifest schema.");
  }
  const seen = new Set();
  for (const portal of raw.portals) {
    const specId = requiredString(portal.specId, "portal specId");
    if (seen.has(specId)) throw new Error(`Duplicate portfolio portal ${specId}.`);
    seen.add(specId);
    if (portal.enabled !== undefined && typeof portal.enabled !== "boolean") throw new Error(`${specId}: enabled must be boolean.`);
    if (portal.priority !== undefined) positiveInteger(portal.priority, `${specId}: priority`);
    if (portal.riskTier !== undefined && !new Set(["low", "medium", "high", "critical"]).has(portal.riskTier)) throw new Error(`${specId}: invalid riskTier.`);
    if (portal.outstandingGapClasses !== undefined && (!Array.isArray(portal.outstandingGapClasses) || portal.outstandingGapClasses.some((value) => typeof value !== "string"))) throw new Error(`${specId}: invalid outstandingGapClasses.`);
  }
  if (inventory) {
    const ids = new Set(inventory.map((entry) => entry.specId));
    for (const portal of raw.portals) if (!ids.has(portal.specId)) throw new Error(`Portfolio references unknown spec ${portal.specId}.`);
    for (const entry of inventory) if (!seen.has(entry.specId)) throw new Error(`Specification ${entry.specId} is missing from the durable discovery queue.`);
  }
  return clone(raw);
}

function hostFamily(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return requiredString(url, "endpoint").toLowerCase(); }
}

export function materializePortfolioManifest(raw, inventory) {
  validatePortfolioManifest(raw, inventory);
  const byId = new Map(inventory.map((entry) => [entry.specId, entry]));
  const defaults = raw.defaults ?? {};
  return {
    schemaVersion: portfolioManifestSchemaVersion,
    manifestId: requiredString(raw.manifestId, "manifestId"),
    portals: raw.portals.map((source) => {
      const spec = byId.get(source.specId);
      const metadata = crawlMetadataByTitle[spec.title];
      const recipes = getCaptureRecipes(spec.title);
      const overlay = getCoverageOverlay(spec.title);
      const endpoint = hostFamily(metadata.portalUrl);
      const captureBudget = { ...(defaults.captureBudget ?? {}), ...(source.captureBudget ?? {}) };
      const auth = { ...(defaults.auth ?? {}), ...(source.auth ?? {}) };
      return {
        specId: spec.specId,
        title: spec.title,
        enabled: source.enabled ?? defaults.enabled ?? true,
        recipe: source.recipe ?? recipes[0] ?? null,
        auth: { requiresProfile: Boolean(auth.requiresProfile), profile: requiredString(auth.profile ?? "bounded", `${spec.specId}: auth.profile`) },
        endpoint: { leaseFamily: source.endpoint?.leaseFamily ?? endpoint, hostFamily: endpoint },
        riskTier: source.riskTier ?? defaults.riskTier ?? "medium",
        destination: { specId: source.destination?.specId ?? spec.specId, hostFamilies: sorted(source.destination?.hostFamilies ?? [endpoint]) },
        captureBudget: { timeoutMs: positiveInteger(captureBudget.timeoutMs ?? 900000, `${spec.specId}: capture timeoutMs`), retryCount: positiveInteger(captureBudget.retryCount ?? 1, `${spec.specId}: capture retryCount`), actionCount: positiveInteger(captureBudget.actionCount ?? 80, `${spec.specId}: capture actionCount`) },
        priority: source.priority ?? defaults.priority ?? 20,
        compatibility: source.compatibility ?? { derivativeSchema: null, freshnessClass: "untracked" },
        outstandingGapClasses: sorted(source.outstandingGapClasses ?? overlay.openGapClasses ?? overlay.openGaps ?? []),
        source: { specPath: spec.specPath, operationCount: spec.operationCount, serverUrls: sorted(spec.serverUrls), nextPass: metadata.nextPass },
      };
    }).sort((left, right) => left.specId.localeCompare(right.specId)),
  };
}

export async function buildPortfolioManifest(manifestPath = defaultPortfolioManifestPath) {
  const raw = await loadPortfolioManifest(manifestPath);
  const manifest = materializePortfolioManifest(raw, await buildSpecInventory());
  const pinnedRecipes = new Map(raw.portals
    .filter((portal) => portal.recipe)
    .map((portal) => [portal.specId, portal.recipe]));
  const portals = await Promise.all(manifest.portals.map(async (portal) => {
    const allowedRecipePaths = getCaptureRecipes(portal.title);
    const pinnedRecipe = pinnedRecipes.get(portal.specId);
    const canonicalPinnedRecipe = pinnedRecipe
      ? allowedRecipePaths.find((recipePath) => path.resolve(repoRoot, recipePath) === path.resolve(repoRoot, pinnedRecipe))
      : null;
    if (pinnedRecipe && !canonicalPinnedRecipe) {
      throw new Error(`Recipe ${JSON.stringify(pinnedRecipe)} is not checked in for ${portal.title}.`);
    }
    const recipePaths = canonicalPinnedRecipe ? [canonicalPinnedRecipe] : allowedRecipePaths;
    if (recipePaths.length === 0) return { ...portal, recipe: null, novelty: { status: "missing" } };
    const recipes = await Promise.all(recipePaths.map(async (recipePath) => ({
      path: recipePath,
      value: await readJson(path.join(repoRoot, recipePath)),
    })));
    const selected = recipes.find((entry) => entry.value.noveltyFrontier && entry.value.noveltyStatus?.status !== "satisfied")
      ?? recipes.find((entry) => entry.value.noveltyStatus?.status === "satisfied")
      ?? recipes[0];
    const recipe = selected.value;
    if (recipe.noveltyStatus?.status === "satisfied") {
      return {
        ...portal,
        recipe: selected.path,
        novelty: {
          evidenceDisposition: sanitize(recipe.noveltyStatus.evidenceDisposition),
          nextRequirement: sanitize(recipe.noveltyStatus.nextRequirement),
          status: "satisfied",
        },
      };
    }
    if (!recipe.noveltyFrontier) return { ...portal, recipe: selected.path, novelty: { status: "missing" } };
    return {
      ...portal,
      recipe: selected.path,
      novelty: {
        approvalDigest: sanitize(recipe.noveltyFrontier.approvalDigest),
        hasControlReadiness: Boolean(recipe.frontierControlReadiness),
        reopenCondition: sanitize(recipe.noveltyFrontier.reopenCondition),
        status: "active",
      },
    };
  }));
  return { ...manifest, portals };
}

function ledgerSummary(input) {
  const assignments = input?.assignments ?? [];
  return assignments.map((entry) => ({ assignmentId: entry.assignmentId, specId: entry.specId, endpoint: entry.endpoint, profile: entry.profile, state: entry.state, priority: entry.priority })).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
}

function routeForPortal(portal, summary, options = {}) {
  if (!portal.enabled) return { route: "orchestrator", reasonCodes: ["disabled"] };
  if (portal.auth.requiresProfile && !portal.auth.profile) return { route: "orchestrator", reasonCodes: ["missing-auth-profile"] };
  if (!portal.recipe) return { route: "orchestrator", reasonCodes: ["missing-recipe"] };
  if (!portal.managedCapture && portal.novelty?.status === "satisfied") return {
    route: "orchestrator",
    reasonCodes: ["novelty-satisfied", portal.novelty.evidenceDisposition].filter(Boolean),
  };
  if (!portal.managedCapture && portal.novelty?.status !== "active") return { route: "orchestrator", reasonCodes: ["novelty-frontier-missing"] };
  if (!portal.managedCapture && (!/^[a-f0-9]{64}$/u.test(String(portal.novelty.approvalDigest || "")) || !portal.novelty.reopenCondition)) {
    return { route: "orchestrator", reasonCodes: ["novelty-frontier-unapproved"] };
  }
  const unresolvedAdjacent = options.adjacentOwnership ?? [];
  if (unresolvedAdjacent.some((entry) => entry?.status !== "resolved" && (
    entry?.specId === portal.specId || (() => {
      try { return normalizeEndpoint(entry?.hostFamily) === normalizeEndpoint(portal.endpoint.hostFamily); }
      catch { return false; }
    })()
  ))) return { route: "manual", reasonCodes: ["adjacent-ownership-unresolved"] };
  if (summary.some((entry) => entry.specId === portal.specId && entry.state === "blocked")) return { route: "manual", reasonCodes: ["ledger-blocked"] };
  if (portal.riskTier === "critical" || portal.outstandingGapClasses.some((gap) => /safety|scope|state-changing/iu.test(gap))) return { route: "luna", reasonCodes: ["risk-or-scope-review"] };
  return { route: "cheap", reasonCodes: ["routine-read-only"] };
}

export function compileOrchestrationPlan(manifest, { ledger = {}, budgets = {}, options = {} } = {}) {
  if (!manifest || manifest.schemaVersion !== portfolioManifestSchemaVersion) throw new Error("A materialized portfolio manifest is required.");
  const summary = ledgerSummary(ledger);
  const maxCaptures = budgets.maxCaptures ?? Number.POSITIVE_INFINITY;
  const maxAssignments = budgets.maxAssignments ?? Number.POSITIVE_INFINITY;
  const offlineReviewReasoning = validateOfflineReviewReasoning(
    options.offlineReviewReasoning ?? portalDiscoveryModelPolicy.offlineReview.reasoning,
  );
  positiveInteger(Number.isFinite(maxCaptures) ? maxCaptures : 0, "maxCaptures");
  const assignments = [];
  const captureByLease = new Map();
  for (const portal of manifest.portals) {
    const route = routeForPortal(portal, summary, options);
    const captureKey = `${portal.managedCapture?.endpoint ?? portal.endpoint.leaseFamily}|${portal.auth.profile}`;
    const capture = { type: "capture", specId: portal.specId, portal: portal.title, endpointLease: captureKey, profile: portal.auth.profile, recipe: portal.recipe, route: "orchestrator", model: portalDiscoveryModelPolicy.capture.model, reasoning: portalDiscoveryModelPolicy.capture.reasoning, budgets: portal.captureBudget, preconditions: portal.enabled ? ["validated-manifest", "authenticated-profile", "fresh-artifact-directory"] : ["portal-enabled"], completionGates: ["sanitized-summary", "candidate-handoff", "operation-lifecycle-accounted"], blockers: route.reasonCodes, terminal: portal.enabled ? "capture-result-required" : "disabled", nextAction: portal.enabled ? "allocate-fresh-artifacts" : "none", serializedGroup: captureKey };
    if (portal.managedCapture) capture.managedCapture = portal.managedCapture;
    capture.assignmentId = `capture-${digest(capture).slice(0, 24)}`;
    capture.assignmentDigest = assignmentDigest(capture);
    captureByLease.set(captureKey, [...(captureByLease.get(captureKey) ?? []), capture]);
  }
  const captures = [...captureByLease.values()].flat().sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  const serializedCaptures = captures;
  const captureBlockingCodes = new Set([
    "adjacent-ownership-unresolved",
    "disabled",
    "ledger-blocked",
    "missing-auth-profile",
    "missing-recipe",
    "novelty-frontier-missing",
    "novelty-frontier-unapproved",
    "novelty-satisfied",
  ]);
  const captureAllowed = captures
    .filter((entry) => entry.blockers.every((code) => !captureBlockingCodes.has(code)))
    .slice(0, maxCaptures);
  const captureIds = new Set(captureAllowed.map((entry) => entry.assignmentId));
  for (const capture of serializedCaptures) if (captureIds.has(capture.assignmentId)) assignments.push(capture);
  for (const portal of manifest.portals) {
    const route = routeForPortal(portal, summary, options);
    const review = { type: "review", specId: portal.specId, portal: portal.title, route: route.route, model: requiredReviewModel, reasoning: offlineReviewReasoning, qualityGate: { model: portalDiscoveryModelPolicy.orchestrator.model, reasoning: portalDiscoveryModelPolicy.orchestrator.reasoning, responsibility: "orchestrator-acceptance" }, budgets: { timeoutMs: budgets.reviewTimeoutMs ?? 120000, retryCount: budgets.retryCount ?? 1, maxPayloadBytes: budgets.maxPayloadBytes ?? 262144 }, preconditions: ["capture-summary-sanitized", "assignment-scope-known"], completionGates: ["exact-candidate-accounting", "exact-evidence-accounting", "legal-decision", "terminal-live-lifecycle-accounted", "process-improvement-dispositioned", "orchestrator-quality-gate"], blockers: route.reasonCodes, terminal: route.route === "orchestrator" ? "blocked" : "worker-result-required", nextAction: route.route === "orchestrator" ? "repair-preconditions" : "validate-worker-result", scope: { candidateIds: [], evidenceIds: [] } };
    review.assignmentId = `review-${digest(review).slice(0, 24)}`;
    review.assignmentDigest = assignmentDigest(review);
    assignments.push(review);
  }
  assignments.sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  const limited = assignments.slice(0, maxAssignments);
  const planCore = { schemaVersion: orchestrationPlanSchemaVersion, manifestId: manifest.manifestId, sourceManifestDigest: digest(manifest), modelPolicy: portalDiscoveryModelPolicy, options: sanitize(options), budgets: sanitize(budgets), assignments: limited };
  const plan = { ...planCore, planId: `plan-${digest(planCore).slice(0, 24)}`, planDigest: digest(planCore), mode: options.apply ? "apply-opt-in" : "report-only", completion: { terminal: limited.length < assignments.length ? "budget-exhausted" : "plan-ready", nextAction: options.apply ? "explicit-enqueue" : "review-plan" }, totals: { assignmentCount: limited.length, captureCount: limited.filter((entry) => entry.type === "capture").length, reviewCount: limited.filter((entry) => entry.type === "review").length, serializedCaptureCount: limited.filter((entry) => entry.type === "capture").length ? new Set(limited.filter((entry) => entry.type === "capture").map((entry) => entry.endpointLease)).size : 0, parallelOfflineCount: limited.filter((entry) => entry.type === "review" && entry.route !== "orchestrator").length, maxWorkerPayloadBytes: Math.max(0, ...limited.map((entry) => Buffer.byteLength(stableJson(entry), "utf8"))), rejectedResultCount: 0 } };
  return plan;
}

export function validateOrchestrationPlan(plan) {
  if (!plan || plan.schemaVersion !== orchestrationPlanSchemaVersion || !Array.isArray(plan.assignments)) throw new Error("Unsupported or corrupt orchestration plan schema.");
  const ids = new Set();
  for (const assignment of plan.assignments) {
    if (!assignmentTypes.has(assignment.type) || ids.has(assignment.assignmentId)) throw new Error("Plan assignment types and IDs must be unique and known.");
    ids.add(assignment.assignmentId);
    if (assignment.assignmentDigest !== assignmentDigest(assignment)) throw new Error(`Assignment digest mismatch for ${assignment.assignmentId}.`);
    if (assignment.managedCapture && (assignment.type !== "capture" || assignment.model !== portalDiscoveryModelPolicy.capture.model
      || assignment.reasoning !== portalDiscoveryModelPolicy.capture.reasoning || assignment.managedCapture.kind !== "known-operation-refresh"
      || !assignment.managedCapture.workerId || !plan.planDigest)) throw new Error("Invalid managed capture role or plan binding.");
  }
  if (plan.planDigest) {
    const core = Object.fromEntries(["schemaVersion", "manifestId", "sourceManifestDigest", "modelPolicy", "options", "budgets", "assignments"].map(key => [key, plan[key]]));
    if (digest(core) !== plan.planDigest) throw new Error("Orchestration plan digest mismatch.");
  }
  return plan;
}

export function projectOrchestrationPlanSummary(plan) {
  validateOrchestrationPlan(plan);
  const captures = plan.assignments.filter((assignment) => assignment.type === "capture");
  const reviews = plan.assignments.filter((assignment) => assignment.type === "review");
  const byRoute = {};
  const blockerCounts = {};
  for (const review of reviews) {
    byRoute[review.route] = (byRoute[review.route] ?? 0) + 1;
    for (const blocker of review.blockers ?? []) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }
  return {
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    planDigest: plan.planDigest,
    mode: plan.mode,
    modelPolicy: plan.modelPolicy,
    captures,
    reviews: {
      blockerCounts: Object.fromEntries(Object.entries(blockerCounts).sort(([left], [right]) => left.localeCompare(right))),
      byRoute: Object.fromEntries(Object.entries(byRoute).sort(([left], [right]) => left.localeCompare(right))),
      runnableCount: reviews.filter((review) => review.terminal === "worker-result-required").length,
      totalCount: reviews.length,
    },
    completion: plan.completion,
    totals: plan.totals,
  };
}

function capabilityViolation(result, assignment) {
  const restricted = new Set(["safety", "scope", "adjacent", "state-changing", "unknown", "incomplete"]);
  const reasons = result.reasonCodes ?? [];
  if (assignment.route === "cheap" && reasons.some((code) => [...restricted].some((part) => code.includes(part)))) return "cheap-capability-ceiling";
  if (assignment.route === "cheap" && ["accept", "approve"].includes(result.decision) && result.metrics?.complete !== true) return "cheap-incomplete-approval";
  return null;
}

export function validateWorkerResult(result, plan) {
  return validateWorkerResultAgainstPlan(result, plan);
}

function validateWorkerResultAgainstPlan(result, plan, identityEvidence) {
  validateOrchestrationPlan(plan);
  if (!result || result.schemaVersion !== workerResultSchemaVersion) throw new Error("Unsupported or corrupt worker-result schema.");
  const assignment = plan.assignments.find((entry) => entry.assignmentId === result.assignmentId);
  if (!assignment) throw new Error(`Unknown worker assignment ${result.assignmentId}.`);
  if (result.assignmentDigest !== assignment.assignmentDigest) throw new Error("Worker assignment digest mismatch.");
  if (assignment.type === "capture" && assignment.managedCapture) {
    const { packet, run, ledgerAssignment, planSha256 } = identityEvidence ?? {};
    const attempt = ledgerAssignment?.attempts?.find(entry => entry.attemptNumber === run?.ledger?.attemptNumber);
    const workerId = assignment.managedCapture.workerId;
    if (result.workerId !== workerId || result.model !== assignment.model || result.reasoning !== assignment.reasoning
      || result.runtimeRole?.model !== assignment.model || result.runtimeRole?.reasoning !== assignment.reasoning
      || packet?.bindings?.assignmentId !== assignment.assignmentId || packet?.bindings?.assignmentDigest !== assignment.assignmentDigest
      || packet?.bindings?.workerId !== workerId || packet?.bindings?.recipeSha256 !== assignment.managedCapture.recipeSha256
      || !planSha256 || packet?.bindings?.orchestrationPlanSha256 !== planSha256 || run?.identityLinkage?.planSha256 !== planSha256
      || run?.assignmentId !== assignment.assignmentId || run?.assignmentDigest !== assignment.assignmentDigest || run?.workerId !== workerId
      || run?.identityLinkage?.status !== "managed-bound" || run?.ledger?.assignmentId !== assignment.assignmentId
      || run?.ledger?.assignmentDigest !== assignment.assignmentDigest || run?.ledger?.workerId !== workerId
      || ledgerAssignment?.assignmentId !== assignment.assignmentId || ledgerAssignment?.assignmentDigest !== assignment.assignmentDigest
      || ledgerAssignment?.workerId !== workerId || attempt?.claimedBy !== workerId || attempt?.lease && attempt.lease.owner !== workerId
      || ledgerAssignment?.profile !== assignment.profile || attempt?.phase !== "all" || attempt?.model !== assignment.model || attempt?.reasoning !== assignment.reasoning
      || run?.status !== result.status || attempt?.status !== result.status || result.decision === "accept" && run?.capture?.captureComplete !== true
      || run?.knownOperationRefreshPlan?.executionDigest !== assignment.managedCapture.executionDigest
      || run?.knownOperationRefreshPlan?.refreshDigest !== assignment.managedCapture.refreshDigest
      || run?.knownOperationRefreshPlan?.variableBindingsDigest !== assignment.managedCapture.variableBindingsDigest
      || ledgerAssignment?.recipeDigest !== assignment.managedCapture.recipeSha256 || ledgerAssignment?.endpoint !== assignment.managedCapture.endpoint) {
      throw new Error("Managed capture result lacks exact packet/run/ledger/worker identity linkage.");
    }
    if (result.decision === "accept" && (result.status !== "completed" || run.blocker || attempt.blocker
      || attempt.captureComplete !== true || attempt.captureStatus !== "complete" || run.capture.captureStatus !== "complete"
      || run.knownOperationRefresh?.status !== "observed" || identityEvidence.captureVerified !== true)) {
      throw new Error("Managed acceptance requires an unblocked successful terminal capture and verified observed evidence.");
    }
    for (const argv of [packet.execution?.driverArgs, packet.execution?.verificationArgs]) {
      const arg = flag => Array.isArray(argv) && argv.filter(value => value === flag).length === 1 ? argv[argv.indexOf(flag) + 1] : null;
      if (arg("--assignment-id") !== assignment.assignmentId || arg("--assignment-digest") !== assignment.assignmentDigest
        || arg("--worker-id") !== workerId || arg("--endpoint") !== assignment.managedCapture.endpoint
        || arg("--model") !== assignment.model || arg("--reasoning") !== assignment.reasoning || arg("--operation-ceiling") !== "observe-only") {
        throw new Error("Managed packet argv identity does not match the assignment.");
      }
    }
  }
  if (assignment.type === "capture" && !assignment.managedCapture && result.decision === "accept") {
    throw new Error("Legacy capture identity is unknown; unattended acceptance requires a managed assignment.");
  }
  if (!assignmentTypes.has(result.assignmentType) || result.assignmentType !== assignment.type) throw new Error("Worker assignment type is outside the assigned scope.");
  if (!statuses.has(result.status) || !transitions["running"].has(result.status) && result.status !== "completed") throw new Error(`Illegal worker result status ${result.status}.`);
  if (!decisions.has(result.decision)) throw new Error("Worker result decision is invalid.");
  if (assignment.type === "review" && result.model !== requiredReviewModel) throw new Error(`Review result requires exact runtime model ${requiredReviewModel}.`);
  if (assignment.type === "review" && result.reasoning !== assignment.reasoning) throw new Error(`Review result requires exact reasoning ${assignment.reasoning}.`);
  if (assignment.type === "review" && !terminalReviewDecisions.has(result.decision)) throw new Error("Review result must have a terminal disposition.");
  if (!Array.isArray(result.reasonCodes) || result.reasonCodes.some((code) => typeof code !== "string")) throw new Error("Worker result reasonCodes are required.");
  for (const key of ["blockers", "metrics", "recommendedNextAction", "lessons", "lifecycleAccounting", "processImprovementDisposition"]) if (result[key] === undefined) throw new Error(`Worker result requires ${key}.`);
  if (typeof result.processImprovementDisposition !== 'string' || !result.processImprovementDisposition.trim()) throw new Error('Worker result requires an explicit processImprovementDisposition.');
  if (!Array.isArray(result.lessons)) throw new Error("Worker result lessons must be an array.");
  if (result.lifecycleAccounting?.terminalOwnerShutdown !== true || result.lifecycleAccounting?.artifactLedgerAccounting !== true) throw new Error("Worker result must account for terminal owner shutdown and artifact/ledger accounting.");
  const candidateIds = new Set(assignment.scope?.candidateIds ?? []);
  const evidenceIds = new Set(assignment.scope?.evidenceIds ?? []);
  const candidateAccounting = result.candidateAccounting ?? { accepted: [], rejected: [], escalated: [], blocked: [] };
  const evidenceAccounting = result.evidenceAccounting ?? { accepted: [], rejected: [], escalated: [], blocked: [] };
  const allIds = (accounting) => Object.values(accounting).flat();
  if (new Set(allIds(candidateAccounting)).size !== allIds(candidateAccounting).length || allIds(candidateAccounting).some((id) => !candidateIds.has(id))) throw new Error("Worker candidate accounting has unknown or duplicate IDs.");
  if (new Set(allIds(evidenceAccounting)).size !== allIds(evidenceAccounting).length || allIds(evidenceAccounting).some((id) => !evidenceIds.has(id))) throw new Error("Worker evidence accounting has unknown or duplicate IDs.");
  if (new Set(allIds(candidateAccounting)).size !== candidateIds.size || new Set(allIds(evidenceAccounting)).size !== evidenceIds.size) throw new Error("Worker result does not preserve exact candidate/evidence cardinality.");
  const violation = capabilityViolation(result, assignment);
  if (violation) throw new Error(`Worker capability violation: ${violation}.`);
  if (assignment.type === "review") {
    const gate = result.qualityGate;
    if (!gate || gate.schemaVersion !== 1) throw new Error("Review result requires a Sol orchestrator quality gate.");
    if (gate.model !== assignment.qualityGate?.model || gate.model !== requiredOrchestratorModel) throw new Error(`Quality gate requires exact runtime model ${requiredOrchestratorModel}.`);
    if (gate.reasoning !== assignment.qualityGate?.reasoning) throw new Error(`Quality gate requires exact reasoning ${assignment.qualityGate?.reasoning}.`);
    if (gate.decision !== "accept") throw new Error("Sol orchestrator quality gate did not accept the worker result.");
    if (gate.assignmentId !== assignment.assignmentId || gate.assignmentDigest !== assignment.assignmentDigest) throw new Error("Quality gate assignment binding mismatch.");
    if (gate.workerResultDigest !== workerResultSubjectDigest(result)) throw new Error("Quality gate worker-result digest mismatch.");
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(String(gate.reviewedAt || ""))) throw new Error("Quality gate reviewedAt must be an ISO timestamp.");
  }
  return { ...clone(result), sanitized: true, assignmentType: assignment.type };
}

export async function cacheValidatedReviewResult({ cacheDir, packet, result, plan }) {
  const validated = validateWorkerResult(result, plan);
  if (validated.assignmentType !== "review") throw new Error("Only validated review results may enter the review cache.");
  const assignment = plan.assignments.find((entry) => entry.assignmentId === validated.assignmentId);
  if (packet?.bindings?.model !== validated.model || packet?.bindings?.reasoning !== validated.reasoning || digest(packet?.bindings?.scope) !== digest(assignment.scope ?? {})) throw new Error("Review packet model, reasoning, or scope does not match the validated assignment.");
  const entry = await writeReviewCache({ cacheDir, packet, workerResult: validated });
  return {
    schemaVersion: 1,
    status: "cached",
    cacheKey: entry.cacheKey,
    packetDigest: entry.packetDigest,
    originalAssignmentId: validated.assignmentId,
    originalAssignmentDigest: validated.assignmentDigest,
    originalReviewDigest: entry.originalReviewDigest,
  };
}

export async function validateCachedReviewReuse({ cacheDir, packet, plan, assignmentId, qualityGate }) {
  validateOrchestrationPlan(plan);
  const assignment = plan.assignments.find((entry) => entry.assignmentId === assignmentId);
  if (!assignment || assignment.type !== "review") throw new Error("Cached review reuse requires a current review assignment.");
  const cached = await loadReviewCache({ cacheDir, packet, currentAssignment: assignment });
  if (packet?.bindings?.model !== assignment.model || packet?.bindings?.reasoning !== assignment.reasoning || digest(packet?.bindings?.scope) !== digest(assignment.scope ?? {})) throw new Error("Cached review packet model, reasoning, or scope does not match the current assignment.");
  if (!cached.reusable) throw new Error(`Cached review is not reusable${cached.criticalBlockers.length ? `: ${cached.criticalBlockers.join(", ")}` : "."}`);
  if (!qualityGate || qualityGate.schemaVersion !== 1 || qualityGate.model !== requiredOrchestratorModel || qualityGate.model !== assignment.qualityGate?.model || qualityGate.reasoning !== assignment.qualityGate?.reasoning || qualityGate.decision !== "accept-cache-reuse") throw new Error("Cached review reuse requires a current exact Sol quality gate.");
  if (qualityGate.assignmentId !== assignment.assignmentId || qualityGate.assignmentDigest !== assignment.assignmentDigest || qualityGate.cacheKey !== packet.cacheKey || qualityGate.packetDigest !== packet.packetDigest || qualityGate.originalReviewDigest !== cached.originalReview.artifactDigest) throw new Error("Cached review reuse quality-gate binding mismatch.");
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(String(qualityGate.reviewedAt ?? ""))) throw new Error("Cached review reuse quality gate reviewedAt must be an ISO timestamp.");
  return {
    schemaVersion: 1,
    kind: "cached-review-reuse",
    status: "accepted",
    originalWorkerResult: clone(cached.originalWorkerResult),
    originalReview: cached.originalReview,
    applicability: cached.applicability,
    currentQualityGate: clone(qualityGate),
    freshWorkerExecutionClaimed: false,
    freshCaptureClaimed: false,
  };
}

export async function writeAtomicJson(filePath, value) {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${digest(value).slice(0, 12)}`;
  await writeFile(temporary, stableJson(value), "utf8");
  await rename(temporary, absolute);
}

export async function compileFromFiles({ manifestPath = defaultPortfolioManifestPath, ledgerPath, budgets, options, managedKnownRefresh } = {}) {
  let manifest = await buildPortfolioManifest(manifestPath);
  if (managedKnownRefresh) manifest = await prepareManagedKnownRefresh(manifest, managedKnownRefresh);
  const ledger = ledgerPath ? await getLedgerViewFromFile({ ledgerPath, view: "all" }) : { assignments: [] };
  return compileOrchestrationPlan(manifest, { ledger, budgets, options });
}

// Do not trust identity snapshots supplied in a worker's own report. Load the
// persisted packet/run and actual ledger through the same existing validator.
export async function validateManagedCaptureResult({ result, resultPath, planPath, packetPath, runPath, ledgerPath }) {
  if (resultPath) result = await readJson(resultPath);
  if (!result || typeof result.assignmentId !== "string" || ![planPath, packetPath, runPath, ledgerPath].every(value => typeof value === "string" && value)) {
    throw new Error("Managed capture result and all evidence paths are required.");
  }
  const [planBytes, packetValue, run, ledger] = await Promise.all([readFile(planPath), readJson(packetPath), readJson(runPath),
    getLedgerViewFromFile({ ledgerPath, filters: { assignmentId: result.assignmentId }, includeAttempts: true })]);
  const packet = packetValue.workerPacket ?? packetValue;
  const plan = JSON.parse(planBytes), ledgerAssignment = ledger.assignments[0];
  await assertNoRefreshLinks(runPath);
  if (path.basename(runPath) !== "discovery-run.json" || !path.isAbsolute(run.artifacts ?? "")) throw new Error("Managed result requires the canonical capture-root discovery-run.json.");
  const root = await realpath(path.dirname(path.resolve(runPath)));
  await assertNoRefreshLinks(run.artifacts);
  const attempt = ledgerAssignment?.attempts?.find(entry => entry.attemptNumber === run.ledger?.attemptNumber);
  if (root !== await realpath(run.artifacts) || attempt?.artifactHashes?.artifactDir !== createHash("sha256").update(path.resolve(run.artifacts)).digest("hex")) {
    throw new Error("Managed run capture root does not match the recorded ledger artifact directory.");
  }
  if (result.decision === "accept" && (result.attemptNumber !== run.ledger.attemptNumber || !result.captureRoot || root !== await realpath(result.captureRoot))) {
    throw new Error("Managed worker result does not identify this exact capture root and attempt.");
  }
  if (result.decision === "accept" && (result.status !== "completed" || run.status !== "completed" || attempt.status !== "completed"
    || run.blocker || attempt.blocker || attempt.captureComplete !== true || attempt.captureStatus !== "complete"
    || run.capture?.captureComplete !== true || run.capture?.captureStatus !== "complete" || run.knownOperationRefresh?.status !== "observed")) {
    throw new Error("Managed acceptance requires an unblocked successful terminal capture and verified observed evidence.");
  }
  const { verifyCaptureWorkerPacket, prepareRecipeForRun, buildActionBudget, inspectCaptureCompleteness, readVerifiedMutationSummary } = await import("./run-portal-discovery.mjs");
  const args = verifyCaptureWorkerPacket(packet, { artifactDir: root, knownOperationRefreshPlan: run.knownOperationRefreshPlan });
  if (run.workerPacketSha256 !== packet.packetSha256 || args.phase !== "all" || !args.requireKnownRefresh
    || args.noLedger || args.seedArtifacts || args.operationApprovalDigest || args.orchestrationPlan !== run.identityLinkage?.planPath
    || args.ledgerPath !== run.ledger?.ledgerPath) throw new Error("Managed packet does not match the executed packet/plan/ledger binding.");
  const recipe = prepareRecipeForRun(await readJson(args.recipe), args.variables);
  const refresh = buildKnownOperationRefreshPlan(recipe, { required: true });
  validateManagedCaptureAssignment(plan, { ...args, specId: packet.scope.specId, recipePath: args.recipe, recipeSha256: await recipeDigestForResult(args.recipe),
    refreshPlan: refresh, actionBudget: buildActionBudget(recipe) });
  if (!isDeepStrictEqual(refresh, run.knownOperationRefreshPlan)) throw new Error("Managed run resolved execution binding changed.");
  let captureVerified = false;
  if (result.decision === "accept") {
    const [summary, actions, api, raw, storedAssessment] = await Promise.all(["summary.json", "action-results.json", "api-records.json", "raw-requests.json", "known-operation-refresh-assessment.json"].map(file => readJson(path.join(root, file))));
    if (![actions, api, raw].every(Array.isArray)) throw new Error("Managed capture artifacts must contain recorder arrays.");
    const completeness = await inspectCaptureCompleteness(root);
    const health = aggregateInteractionHealth(actions, { reported: summary.interactionHealth ?? summary.actionValidation?.interactionHealth });
    const accounting = summarizeActionResults(actions);
    const plannedActions = recipe.actions.map(normalizeRecipeAction);
    const initial = actions.filter(action => (action.actionIndex ?? action.index) === -1);
    const actionBindingsMatch = actions.length === plannedActions.length + 1 && initial.length === 1
      && initial[0].type === "navigate" && initial[0].value === recipe.url && initial[0].required === true
      && initial[0].allowCanonicalRedirect === true && actionResultSucceeded(initial[0])
      && plannedActions.every((expected, index) => {
        const matches = actions.filter(action => (action.actionIndex ?? action.index) === index);
        return matches.length === 1 && matches[0].type === expected.type && matches[0].value === expected.value
          && (matches[0].scope ?? "any") === expected.scope && Boolean(matches[0].required) === Boolean(expected.required);
      });
    const mutationSummary = await readVerifiedMutationSummary(root, { captureSummary: summary });
    if (mutationSummary && (mutationSummary.safeToContinue !== true || mutationSummary.attemptCount !== 0)
      || !isDeepStrictEqual(mutationSummary, run.activeOperations ?? null) || !isDeepStrictEqual(mutationSummary, attempt.activeOperations ?? null)) {
      throw new Error("Managed observe-only mutation safety does not match summary/events/run/ledger evidence.");
    }
    await hydrateResponseBodySidecars(api, root, recipe.responseBodyLimits);
    await hydrateResponseBodySidecars(raw, root, recipe.responseBodyLimits);
    const assessment = evaluateKnownOperationRefreshEvidence({ actionResults: actions, apiRecords: api, plan: refresh });
    const rawAssessment = evaluateKnownOperationRefreshEvidence({ actionResults: actions, apiRecords: raw, plan: refresh });
    if (!completeness.captureComplete || !assessResponseBodySidecarCompleteness(api).captureComplete || !assessResponseBodySidecarCompleteness(raw).captureComplete
      || !actionBindingsMatch || health?.accounting?.consistent !== true || health.recommendation?.recommended === true || accounting.requiredActionFailureCount !== 0
      || accounting.countedActionCount > buildActionBudget(recipe).maxActions || (summary.actionValidation?.requiredActionFailures ?? []).length
      || assessment.status !== "observed" || rawAssessment.status !== "observed" || !isDeepStrictEqual(assessment, storedAssessment)
      || !isDeepStrictEqual(assessment, run.knownOperationRefresh)) throw new Error("Managed retained capture evidence is incomplete, blocked or inconsistent.");
    captureVerified = true;
  }
  return validateWorkerResultAgainstPlan(result, plan, { packet, run, ledgerAssignment, captureVerified, planSha256: createHash("sha256").update(planBytes).digest("hex") });
}

async function recipeDigestForResult(recipePath) {
  await assertNoRefreshLinks(recipePath);
  return createHash("sha256").update(await readFile(recipePath)).digest("hex");
}

export async function enqueueOrchestrationPlan(plan, { ledgerPath, apply = false } = {}) {
  validateOrchestrationPlan(plan);
  if (!apply) throw new Error("Applying an orchestration plan requires explicit apply opt-in.");
  if (!ledgerPath) throw new Error("Applying an orchestration plan requires --ledger.");
  const results = [];
  for (const assignment of plan.assignments.filter((entry) => entry.type === "capture" && entry.route === "orchestrator")) {
    if (assignment.managedCapture && await checkedInRecipeDigest(assignment.recipe) !== assignment.managedCapture.recipeSha256) throw new Error("Managed recipe changed after planning.");
    results.push(await enqueueAssignment({ ledgerPath, assignmentId: assignment.assignmentId, assignmentDigest: assignment.managedCapture ? assignment.assignmentDigest : null, workerId: assignment.managedCapture?.workerId, specId: assignment.specId, portal: assignment.portal, recipePath: assignment.recipe, recipeDigest: await checkedInRecipeDigest(assignment.recipe), endpoint: assignment.endpointLease.split("|")[0], profile: assignment.profile, phase: "all", model: portalDiscoveryModelPolicy.capture.model, reasoning: portalDiscoveryModelPolicy.capture.reasoning, priority: 20 }));
  }
  return results;
}

export function projectPortfolioStatus(manifest, ledger = { assignments: [] }) {
  const latestBySpec = new Map();
  for (const assignment of ledger.assignments ?? []) {
    const current = latestBySpec.get(assignment.specId);
    const assignmentTime = Date.parse(assignment.updatedAt ?? assignment.createdAt ?? "") || 0;
    const currentTime = Date.parse(current?.updatedAt ?? current?.createdAt ?? "") || 0;
    if (!current || assignmentTime > currentTime || (
      assignmentTime === currentTime
      && String(assignment.assignmentId).localeCompare(String(current.assignmentId)) > 0
    )) latestBySpec.set(assignment.specId, assignment);
  }
  return {
    schemaVersion: portfolioManifestSchemaVersion,
    manifestId: manifest.manifestId,
    portals: manifest.portals.map((portal) => {
      const assignment = latestBySpec.get(portal.specId);
      const attempt = assignment?.latestAttempt;
      return {
        specId: portal.specId,
        enabled: portal.enabled,
        state: assignment?.state ?? (portal.enabled ? "unallocated" : "disabled"),
        latestAssignmentId: assignment?.assignmentId ?? null,
        latestAssignmentUpdatedAt: assignment?.updatedAt ?? null,
        captureComplete: attempt?.captureComplete ?? null,
        captureStatus: attempt?.captureStatus ?? null,
        blockerCode: attempt?.blocker?.code ?? assignment?.blocked?.code ?? null,
      };
    }).sort((a, b) => a.specId.localeCompare(b.specId)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const value = (flag, fallback = null) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
  const json = async () => {
    if (command === "validate-portfolio") return buildPortfolioManifest(value("--manifest", defaultPortfolioManifestPath));
    if (command === "compile-plan") {
      const ledgerPath = value("--ledger");
      const apply = args.includes("--apply");
      const managedKnownRefresh = args.includes("--managed-known-refresh") ? {
        specId: requiredString(value("--portal"), "--portal"), recipe: requiredString(value("--recipe"), "--recipe"),
        workerId: requiredString(value("--worker-id"), "--worker-id"), endpoint: value("--endpoint"),
        variables: args.flatMap((argument, index) => argument === "--var" ? [requiredString(args[index + 1], "--var")] : []),
      } : null;
      const plan = await compileFromFiles({ manifestPath: value("--manifest", defaultPortfolioManifestPath), ledgerPath, budgets: {}, options: { apply }, managedKnownRefresh });
      if (managedKnownRefresh) {
        const output = path.resolve(requiredString(value("--output"), "Managed plan --output"));
        await privateRefreshDirectory(path.dirname(output), { create: true });
        await writeFile(output, stableJson(plan), { flag: "wx" });
      }
      const projection = args.includes("--summary") ? projectOrchestrationPlanSummary(plan) : plan;
      if (!apply) return projection;
      const enqueued = await enqueueOrchestrationPlan(plan, { ledgerPath, apply: true });
      return {
        schemaVersion: 1,
        mode: "applied",
        plan: projection,
        enqueue: {
          count: enqueued.length,
          assignments: enqueued.map((result) => ({
            assignmentId: result.assignment.assignmentId,
            attempt: result.assignment.latestAttempt?.attempt ?? null,
            specId: result.assignment.specId,
            state: result.assignment.state,
          })),
        },
      };
    }
    if (command === "validate-capture-result") return validateManagedCaptureResult({ resultPath: requiredString(value("--result"), "--result"), planPath: requiredString(value("--plan"), "--plan"), packetPath: requiredString(value("--packet"), "--packet"), runPath: requiredString(value("--run"), "--run"), ledgerPath: requiredString(value("--ledger"), "--ledger") });
    if (command === "status") { const manifest = await buildPortfolioManifest(value("--manifest", defaultPortfolioManifestPath)); const ledger = value("--ledger") ? await getLedgerViewFromFile({ ledgerPath: value("--ledger"), view: "all" }) : { assignments: [] }; return projectPortfolioStatus(manifest, ledger); }
    if (command === "cache-review") return cacheValidatedReviewResult({ cacheDir: requiredString(value("--cache-dir"), "--cache-dir"), packet: await readJson(requiredString(value("--packet"), "--packet")), result: await readJson(requiredString(value("--result"), "--result")), plan: await readJson(requiredString(value("--plan"), "--plan")) });
    if (command === "reuse-review") return validateCachedReviewReuse({ cacheDir: requiredString(value("--cache-dir"), "--cache-dir"), packet: await readJson(requiredString(value("--packet"), "--packet")), plan: await readJson(requiredString(value("--plan"), "--plan")), assignmentId: requiredString(value("--assignment-id"), "--assignment-id"), qualityGate: await readJson(requiredString(value("--quality-gate"), "--quality-gate")) });
    throw new Error("Use validate-portfolio, compile-plan, validate-capture-result, status, cache-review, or reuse-review.");
  };
  json().then((result) => console.log(stableJson(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
