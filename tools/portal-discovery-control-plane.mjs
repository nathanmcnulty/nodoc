import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  crawlMetadataByTitle,
  getCaptureRecipes,
  getCoverageOverlay,
} from "./portal-discovery-metadata.mjs";
import { getLedgerViewFromFile, enqueueAssignment, normalizeEndpoint } from "./portal-discovery-ledger.mjs";
import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";

export const portfolioManifestSchemaVersion = 1;
export const orchestrationPlanSchemaVersion = 1;
export const workerResultSchemaVersion = 1;
export const requiredReviewModel = "gpt-5.6-luna";
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
  const manifest = materializePortfolioManifest(await loadPortfolioManifest(manifestPath), await buildSpecInventory());
  const portals = await Promise.all(manifest.portals.map(async (portal) => {
    if (!portal.recipe) return { ...portal, novelty: { status: "missing" } };
    const recipe = await readJson(path.join(repoRoot, portal.recipe));
    if (recipe.noveltyStatus?.status === "satisfied") {
      return {
        ...portal,
        novelty: {
          nextRequirement: sanitize(recipe.noveltyStatus.nextRequirement),
          status: "satisfied",
        },
      };
    }
    if (!recipe.noveltyFrontier) return { ...portal, novelty: { status: "missing" } };
    return {
      ...portal,
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
  if (portal.novelty?.status === "satisfied") return { route: "orchestrator", reasonCodes: ["novelty-satisfied"] };
  if (portal.novelty?.status !== "active") return { route: "orchestrator", reasonCodes: ["novelty-frontier-missing"] };
  if (!/^[a-f0-9]{64}$/u.test(String(portal.novelty.approvalDigest || "")) || !portal.novelty.reopenCondition) {
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
  positiveInteger(Number.isFinite(maxCaptures) ? maxCaptures : 0, "maxCaptures");
  const assignments = [];
  const captureByLease = new Map();
  for (const portal of manifest.portals) {
    const route = routeForPortal(portal, summary, options);
    const captureKey = `${portal.endpoint.leaseFamily}|${portal.auth.profile}`;
    const capture = { type: "capture", specId: portal.specId, portal: portal.title, endpointLease: captureKey, profile: portal.auth.profile, recipe: portal.recipe, route: "orchestrator", model: "deterministic", reasoning: "none", budgets: portal.captureBudget, preconditions: portal.enabled ? ["validated-manifest", "authenticated-profile", "fresh-artifact-directory"] : ["portal-enabled"], completionGates: ["sanitized-summary", "candidate-handoff", "no-authoritative-mutation"], blockers: route.reasonCodes, terminal: portal.enabled ? "capture-result-required" : "disabled", nextAction: portal.enabled ? "allocate-fresh-artifacts" : "none", serializedGroup: captureKey };
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
    const review = { type: "review", specId: portal.specId, portal: portal.title, route: route.route, model: requiredReviewModel, reasoning: "high", budgets: { timeoutMs: budgets.reviewTimeoutMs ?? 120000, retryCount: budgets.retryCount ?? 1, maxPayloadBytes: budgets.maxPayloadBytes ?? 262144 }, preconditions: ["capture-summary-sanitized", "assignment-scope-known"], completionGates: ["exact-candidate-accounting", "exact-evidence-accounting", "legal-decision", "terminal-live-lifecycle-accounted", "process-improvement-dispositioned"], blockers: route.reasonCodes, terminal: route.route === "orchestrator" ? "blocked" : "worker-result-required", nextAction: route.route === "orchestrator" ? "repair-preconditions" : "validate-worker-result", scope: { candidateIds: [], evidenceIds: [] } };
    review.assignmentId = `review-${digest(review).slice(0, 24)}`;
    review.assignmentDigest = assignmentDigest(review);
    assignments.push(review);
  }
  assignments.sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  const limited = assignments.slice(0, maxAssignments);
  const planCore = { schemaVersion: orchestrationPlanSchemaVersion, manifestId: manifest.manifestId, sourceManifestDigest: digest(manifest), options: sanitize(options), budgets: sanitize(budgets), assignments: limited };
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
  }
  return plan;
}

function capabilityViolation(result, assignment) {
  const restricted = new Set(["safety", "scope", "adjacent", "state-changing", "unknown", "incomplete"]);
  const reasons = result.reasonCodes ?? [];
  if (assignment.route === "cheap" && reasons.some((code) => [...restricted].some((part) => code.includes(part)))) return "cheap-capability-ceiling";
  if (assignment.route === "cheap" && ["accept", "approve"].includes(result.decision) && result.metrics?.complete !== true) return "cheap-incomplete-approval";
  return null;
}

export function validateWorkerResult(result, plan) {
  validateOrchestrationPlan(plan);
  if (!result || result.schemaVersion !== workerResultSchemaVersion) throw new Error("Unsupported or corrupt worker-result schema.");
  const assignment = plan.assignments.find((entry) => entry.assignmentId === result.assignmentId);
  if (!assignment) throw new Error(`Unknown worker assignment ${result.assignmentId}.`);
  if (result.assignmentDigest !== assignment.assignmentDigest) throw new Error("Worker assignment digest mismatch.");
  if (!assignmentTypes.has(result.assignmentType) || result.assignmentType !== assignment.type) throw new Error("Worker assignment type is outside the assigned scope.");
  if (!statuses.has(result.status) || !transitions["running"].has(result.status) && result.status !== "completed") throw new Error(`Illegal worker result status ${result.status}.`);
  if (!decisions.has(result.decision)) throw new Error("Worker result decision is invalid.");
  if (assignment.type === "review" && result.model !== requiredReviewModel) throw new Error(`Review result requires exact runtime model ${requiredReviewModel}.`);
  if (assignment.type === "review" && !terminalReviewDecisions.has(result.decision)) throw new Error("Review result must have a terminal disposition.");
  if (!Array.isArray(result.reasonCodes) || result.reasonCodes.some((code) => typeof code !== "string")) throw new Error("Worker result reasonCodes are required.");
  for (const key of ["blockers", "metrics", "recommendedNextAction", "lessons", "lifecycleAccounting", "processImprovementDisposition"]) if (result[key] === undefined) throw new Error(`Worker result requires ${key}.`);
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
  return { ...clone(result), sanitized: true, assignmentType: assignment.type };
}

export async function writeAtomicJson(filePath, value) {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${digest(value).slice(0, 12)}`;
  await writeFile(temporary, stableJson(value), "utf8");
  await rename(temporary, absolute);
}

export async function compileFromFiles({ manifestPath = defaultPortfolioManifestPath, ledgerPath, budgets, options } = {}) {
  const manifest = await buildPortfolioManifest(manifestPath);
  const ledger = ledgerPath ? await getLedgerViewFromFile({ ledgerPath, view: "all" }) : { assignments: [] };
  return compileOrchestrationPlan(manifest, { ledger, budgets, options });
}

export async function enqueueOrchestrationPlan(plan, { ledgerPath, apply = false } = {}) {
  validateOrchestrationPlan(plan);
  if (!apply) throw new Error("Applying an orchestration plan requires explicit apply opt-in.");
  const results = [];
  for (const assignment of plan.assignments.filter((entry) => entry.type === "capture" && entry.route === "orchestrator")) {
    results.push(await enqueueAssignment({ ledgerPath, assignmentId: assignment.assignmentId, specId: assignment.specId, portal: assignment.portal, recipePath: assignment.recipe, recipeDigest: digest(assignment.recipe), endpoint: assignment.endpointLease.split("|")[0], profile: assignment.profile, phase: "all", model: "deterministic", reasoning: "none", priority: 20 }));
  }
  return results;
}

export function projectPortfolioStatus(manifest, ledger = { assignments: [] }) {
  return { schemaVersion: portfolioManifestSchemaVersion, manifestId: manifest.manifestId, portals: manifest.portals.map((portal) => ({ specId: portal.specId, enabled: portal.enabled, state: ledger.assignments.find((entry) => entry.specId === portal.specId)?.state ?? (portal.enabled ? "unallocated" : "disabled") })).sort((a, b) => a.specId.localeCompare(b.specId)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const value = (flag, fallback = null) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
  const json = async () => {
    if (command === "validate-portfolio") return buildPortfolioManifest(value("--manifest", defaultPortfolioManifestPath));
    if (command === "compile-plan") return compileFromFiles({ manifestPath: value("--manifest", defaultPortfolioManifestPath), ledgerPath: value("--ledger"), budgets: {}, options: { apply: args.includes("--apply") } });
    if (command === "status") { const manifest = await buildPortfolioManifest(value("--manifest", defaultPortfolioManifestPath)); const ledger = value("--ledger") ? await getLedgerViewFromFile({ ledgerPath: value("--ledger"), view: "all" }) : { assignments: [] }; return projectPortfolioStatus(manifest, ledger); }
    throw new Error("Use validate-portfolio, compile-plan, or status.");
  };
  json().then((result) => console.log(stableJson(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
