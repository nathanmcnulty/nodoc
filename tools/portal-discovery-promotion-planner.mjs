import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePartitionedCandidateHandoff } from "./discovery-candidate-handoff.mjs";
import { validateReviewAssignmentPlan } from "./discovery-review-assignments.mjs";
import { buildSpecRouteInventory } from "./spec-quality-lib.mjs";

export const promotionPlanSchemaVersion = 1;
export const promotionResultSchemaVersion = 1;

const stableJson = (value) => `${JSON.stringify(value)}\n`;
export const promotionDigest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const sorted = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const routeClasses = new Set(["confirmed-read", "successfully-probed"]);
const unsafeWords = /tenant|bearer|cookie|authorization|password|secret|https?:\/\/|[A-Za-z]:\\/iu;

function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(clean);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, clean(entry)]));
  return null;
}

function assertSafe(value, label = "input") {
  const text = JSON.stringify(value);
  if (unsafeWords.test(text)) throw new Error(`${label} contains tenant, raw URL, auth, or absolute-path data.`);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function candidateEvidenceIds(candidate) {
  const ids = Array.isArray(candidate.evidenceIds) ? candidate.evidenceIds : [candidate.evidenceFamilyId];
  if (!ids.length || ids.some((id) => typeof id !== "string" || !id.trim())) throw new Error(`Candidate ${candidate.candidateId} has no valid evidence IDs.`);
  return sorted([...new Set(ids.map((id) => id.trim()))]);
}

function allCandidateRecords(grouped) {
  const records = grouped.partitions.flatMap((partition) => {
    if (!partition || !Array.isArray(partition.candidates) || !partition.destination) throw new Error("Corrupt grouped handoff partition.");
    return partition.candidates.map((candidate) => ({ candidate, partition }));
  });
  if (records.length !== grouped.manifest.totals.candidateCount) throw new Error("Grouped handoff candidate cardinality mismatch.");
  const evidenceCount = new Set(records.flatMap(({ candidate }) => candidateEvidenceIds(candidate))).size;
  if (evidenceCount < grouped.manifest.totals.evidenceFamilyCount) throw new Error("Grouped handoff evidence cardinality mismatch.");
  return records;
}

function healthGate(metadata) {
  if (!metadata || metadata.recovery?.captureComplete !== true) return "incomplete-health";
  if (metadata.interactionHealthStatus?.available !== true || metadata.interactionHealthStatus?.accounting?.consistent === false) return "unknown-health";
  if (metadata.saturation?.eligibility === "unknown") return "unknown-health";
  return null;
}

function findExisting(inventory, destinationSpec, candidate) {
  const spec = inventory.find((entry) => entry.specId === destinationSpec);
  if (!spec) return { kind: "ambiguous-destination", reasonCodes: ["ambiguous-destination"] };
  const method = String(candidate.method || "GET").toUpperCase();
  const route = String(candidate.normalizedPath || "");
  const exact = (spec.operations || []).find((operation) => operation.method === method && operation.path === route);
  if (exact) {
    if (candidate.responseShapeFingerprint && exact.responseShapeFingerprint && candidate.responseShapeFingerprint !== exact.responseShapeFingerprint) {
      return { kind: "conflict", reasonCodes: ["architecture-schema-conflict"] };
    }
    return { kind: "exact", operation: exact, reasonCodes: ["already-documented"] };
  }
  const samePath = (spec.operations || []).some((operation) => operation.path === route);
  if (samePath) return { kind: "extension", reasonCodes: ["extend-existing"] };
  return { kind: "novel", reasonCodes: ["add-new"] };
}

function mapCandidate(record, inventory, metadata) {
  const { candidate, partition } = record;
  const destinationSpec = partition.destination?.specId;
  const evidenceIds = candidateEvidenceIds(candidate);
  const base = { candidateId: nonEmpty(candidate.candidateId, "candidateId"), evidenceIds, destinationSpec, hostFamily: partition.destination?.hostFamily ?? null };
  const healthReason = healthGate(metadata);
  if (healthReason) return { ...base, outcome: "blocked", reasonCodes: [healthReason] };
  if (!routeClasses.has(partition.reviewClass) || partition.reviewClass.includes("adjacent")) return { ...base, outcome: "rejected", reasonCodes: [partition.reviewClass.includes("adjacent") ? "adjacent-scope" : `${partition.reviewClass}-candidate`] };
  if (candidate.evidence === "bundle-discovered") return { ...base, outcome: "rejected", reasonCodes: ["bundle-only-candidate"] };
  if (candidate.documentationStatus === "documented") return { ...base, outcome: "already-documented", reasonCodes: ["already-documented"] };
  if (!destinationSpec || destinationSpec === "unassigned" || !candidate.normalizedPath?.startsWith("/")) return { ...base, outcome: "blocked", reasonCodes: ["ambiguous-destination"] };
  const mapping = findExisting(inventory, destinationSpec, candidate);
  return { ...base, method: String(candidate.method || "GET").toUpperCase(), normalizedPath: candidate.normalizedPath, outcome: mapping.kind === "exact" ? "already-documented" : mapping.kind === "conflict" || mapping.kind === "ambiguous-destination" ? "blocked" : "proposed", mapping: mapping.kind, reasonCodes: mapping.reasonCodes };
}

function assignmentFor(destinationSpec, mappings, options) {
  const candidateIds = sorted(mappings.map((mapping) => mapping.candidateId));
  const evidenceIds = sorted([...new Set(mappings.flatMap((mapping) => mapping.evidenceIds))]);
  const route = mappings.some((mapping) => mapping.outcome === "blocked") ? "manual" : "cheap";
  const metadata = {
    schemaVersion: promotionPlanSchemaVersion,
    assignmentType: "promotion-preparation",
    destinationSpec,
    candidateIds,
    evidenceIds,
    route,
    requiredCapabilities: route === "cheap" ? ["promotion-preparation", "scope-validation"] : ["promotion-preparation", "architecture-schema-review"],
    reasonCodes: sorted([...new Set(mappings.flatMap((mapping) => mapping.reasonCodes))]),
    budgets: clean(options.budgets ?? {}),
  };
  return { ...metadata, assignmentId: `promotion-${promotionDigest(metadata).slice(0, 24)}`, assignmentDigest: promotionDigest(metadata) };
}

export function compilePromotionPlan({ groupedHandoff, reviewPlan = null, workerResults = [], derivativeRecommendations = [], specInventory = [], options = {}, budgets = {} } = {}) {
  if (!groupedHandoff?.manifest || !Array.isArray(groupedHandoff.partitions)) throw new Error("A grouped candidate handoff is required.");
  assertSafe(groupedHandoff, "grouped handoff");
  if (reviewPlan) validateReviewAssignmentPlan(reviewPlan);
  if (!Array.isArray(specInventory)) throw new Error("A checked-in spec inventory is required.");
  const records = allCandidateRecords(groupedHandoff);
  const metadata = groupedHandoff.manifest.sharedMetadata;
  const mappings = records.map((record) => mapCandidate(record, specInventory, metadata)).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const approved = new Set(workerResults.filter((result) => result?.decision === "accept" && result.status === "completed").flatMap((result) => result.candidateAccounting?.accepted ?? []));
  const proposals = mappings.map((mapping) => {
    if (mapping.outcome === "proposed" && !approved.has(mapping.candidateId)) return { ...mapping, outcome: "blocked", reasonCodes: ["manual-approval-required"] };
    return mapping;
  });
  const maxFiles = Number.isInteger(budgets.maxFiles) ? budgets.maxFiles : null;
  const maxChanges = Number.isInteger(budgets.maxChanges) ? budgets.maxChanges : null;
  const maxPrs = Number.isInteger(budgets.maxPrs) ? budgets.maxPrs : null;
  const proposedBySpec = new Map();
  for (const proposal of proposals.filter((entry) => entry.outcome === "proposed")) proposedBySpec.set(proposal.destinationSpec, [...(proposedBySpec.get(proposal.destinationSpec) ?? []), proposal]);
  const budgetBlocked = new Set();
  const budgetSpecs = sorted([...proposedBySpec.keys()]);
  let usedFiles = 0;
  let usedChanges = 0;
  for (const destinationSpec of budgetSpecs) {
    const entries = proposedBySpec.get(destinationSpec);
    const expectedFile = specInventory.find((entry) => entry.specId === destinationSpec)?.specPath ?? null;
    const fileCost = expectedFile ? 1 : 0;
    if ((maxPrs !== null && usedChanges > 0 && usedChanges >= maxPrs) || (maxFiles !== null && usedFiles + fileCost > maxFiles) || (maxChanges !== null && usedChanges + entries.length > maxChanges)) {
      for (const entry of entries) budgetBlocked.add(entry.candidateId);
      continue;
    }
    usedFiles += fileCost;
    usedChanges += entries.length;
  }
  const budgetedProposals = proposals.map((proposal) => budgetBlocked.has(proposal.candidateId) ? { ...proposal, outcome: "blocked", reasonCodes: ["promotion-budget-exhausted"] } : proposal);
  const bySpec = new Map();
  for (const proposal of budgetedProposals.filter((entry) => entry.outcome === "proposed" || entry.outcome === "blocked")) bySpec.set(proposal.destinationSpec, [...(bySpec.get(proposal.destinationSpec) ?? []), proposal]);
  const assignments = [...bySpec.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([destinationSpec, entries]) => assignmentFor(destinationSpec, entries, { budgets }));
  const changes = budgetedProposals.filter((entry) => entry.outcome === "proposed");
  const planCore = {
    schemaVersion: promotionPlanSchemaVersion,
    mode: options.apply === true ? "report-only-apply-opt-in" : "report-only",
    sourceManifestDigest: promotionDigest(groupedHandoff.manifest),
    sourceReviewDigest: reviewPlan ? promotionDigest(reviewPlan) : null,
    derivativeRecommendations: clean(derivativeRecommendations),
    mappings: budgetedProposals,
    assignments,
    changeGroups: assignments.map((assignment) => ({ changeGroupId: `change-${promotionDigest(assignment).slice(0, 24)}`, assignmentId: assignment.assignmentId, destinationSpec: assignment.destinationSpec, candidateIds: assignment.candidateIds, expectedFiles: specInventory.find((entry) => entry.specId === assignment.destinationSpec)?.specPath ? [specInventory.find((entry) => entry.specId === assignment.destinationSpec).specPath] : [], validationCommands: ["npm run validate:spec-quality", "npm run validate:portal-discovery"], route: assignment.route })),
    budgets: clean(budgets),
    nextActions: changes.length ? ["review promotion-preparation result", "create one focused PR per destination spec", "run deterministic validation commands"] : ["repair blocked evidence or resolve manual approval"],
    measurements: {
      inputBytes: Buffer.byteLength(stableJson(groupedHandoff), "utf8"),
      outputBytes: 0,
      approvedCount: mappings.filter((entry) => approved.has(entry.candidateId)).length,
      rejectedCount: budgetedProposals.filter((entry) => entry.outcome === "rejected").length,
      alreadyDocumentedCount: budgetedProposals.filter((entry) => entry.outcome === "already-documented").length,
      proposedCount: changes.length,
      changeGroupCount: assignments.length,
      expectedPrCount: assignments.length,
      exactTraceabilityCount: proposals.filter((entry) => entry.candidateId && entry.evidenceIds.length).length,
      maxPromotionWorkerPayload: Math.max(0, ...assignments.map((entry) => Buffer.byteLength(stableJson(entry), "utf8"))),
      escalationOrBlockCount: budgetedProposals.filter((entry) => entry.outcome === "blocked").length,
    },
  };
  planCore.measurements.outputBytes = Buffer.byteLength(stableJson(planCore), "utf8");
  const plan = { ...planCore, planId: `promotion-plan-${promotionDigest(planCore).slice(0, 24)}`, planDigest: promotionDigest(planCore) };
  return plan;
}

export function validatePromotionPlan(plan) {
  if (!plan || plan.schemaVersion !== promotionPlanSchemaVersion || !Array.isArray(plan.mappings) || !Array.isArray(plan.assignments)) throw new Error("Unsupported or corrupt promotion plan schema.");
  if (plan.planDigest !== promotionDigest(Object.fromEntries(Object.entries(plan).filter(([key]) => !["planId", "planDigest"].includes(key))))) throw new Error("Promotion plan digest mismatch.");
  const ids = new Set();
  for (const assignment of plan.assignments) {
    if (assignment.assignmentType !== "promotion-preparation" || ids.has(assignment.assignmentId) || assignment.assignmentDigest !== promotionDigest(Object.fromEntries(Object.entries(assignment).filter(([key]) => !["assignmentId", "assignmentDigest"].includes(key))))) throw new Error("Invalid promotion-preparation assignment.");
    ids.add(assignment.assignmentId);
  }
  return plan;
}

export function validatePromotionResult(result, plan) {
  validatePromotionPlan(plan);
  if (!result || result.schemaVersion !== promotionResultSchemaVersion) throw new Error("Unsupported promotion result schema.");
  const assignment = plan.assignments.find((entry) => entry.assignmentId === result.assignmentId);
  if (!assignment || result.assignmentType !== "promotion-preparation" || result.assignmentDigest !== assignment.assignmentDigest) throw new Error("Promotion result assignment mismatch.");
  if (result.status !== "completed" || !["accept", "reject", "escalate", "block"].includes(result.decision)) throw new Error("Promotion result status or decision is invalid.");
  const accounting = result.candidateAccounting ?? {};
  const ids = Object.values(accounting).flat();
  if (new Set(ids).size !== ids.length || ids.some((id) => !assignment.candidateIds.includes(id)) || new Set(ids).size !== assignment.candidateIds.length) throw new Error("Promotion result candidate accounting is not exact.");
  if (assignment.route === "cheap" && ["escalate", "block"].includes(result.decision) === false && (result.reasonCodes ?? []).some((code) => /safety|scope|schema|conflict|unsafe/iu.test(code))) throw new Error("Cheap promotion capability cannot override safety, scope, or schema conflicts.");
  return { ...clone(result), sanitized: true };
}

export async function loadSpecRouteInventory() { return buildSpecRouteInventory(); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, inputPath] = process.argv.slice(2);
  if (command !== "compile" || !inputPath) throw new Error("Use compile <input.json>.");
  readFile(path.resolve(inputPath), "utf8").then((text) => {
    const input = JSON.parse(text);
    const plan = compilePromotionPlan(input);
    console.log(stableJson(plan));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
