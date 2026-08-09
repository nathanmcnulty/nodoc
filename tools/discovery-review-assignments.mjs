import { createHash } from "node:crypto";
import { enqueueAssignment } from "./portal-discovery-ledger.mjs";
import { recommendDerivativeReuse } from "./discovery-derivative-families.mjs";

export const reviewAssignmentSchemaVersion = 1;

const cheapClasses = new Set(["confirmed-read", "successfully-probed"]);
const blockedClasses = new Set(["suppressed"]);

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function digest(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function blockersFor(partition, sharedMetadata) {
  const blockers = new Set(partition.blockers ?? []);
  if (partition.reviewClass?.includes("adjacent")) blockers.add("adjacent-ownership");
  if (partition.destinationSpec === "unassigned") blockers.add("scope-ambiguity");
  if (partition.reviewClass?.includes("safety")) blockers.add("safety-review");
  if (sharedMetadata?.interactionHealthStatus?.available === false) blockers.add("health-unavailable");
  if (sharedMetadata?.recovery?.captureComplete === false) blockers.add("capture-incomplete");
  if (sharedMetadata?.saturation?.eligibility === "unknown") blockers.add("eligibility-unknown");
  return [...blockers].sort();
}

function routeFor(partition, blockers) {
  if (blockedClasses.has(partition.reviewClass)) {
    return { route: "block", reasonCodes: ["suppressed-candidate", ...blockers] };
  }
  if (blockers.length > 0) {
    return {
      route: partition.reviewClass?.includes("adjacent") ? "manual" : "luna",
      reasonCodes: blockers,
    };
  }
  if (cheapClasses.has(partition.reviewClass)) {
    return { route: "cheap", reasonCodes: ["routine-unambiguous-read-only"] };
  }
  return { route: "luna", reasonCodes: ["review-class-requires-judgment"] };
}

function validatePartitionShape(entry, partition) {
  const partitionId = `partition-${digest({ destination: partition.destination, reviewClass: partition.reviewClass }).slice(0, 24)}`;
  if (entry.partitionId !== partitionId) throw new Error(`Assignment partition mismatch: ${entry.partitionId}.`);
  const serialized = stableJson(partition);
  const actualDigest = digest(partition);
  if (entry.stableDigest !== actualDigest) throw new Error(`Partition digest mismatch for ${entry.partitionId}.`);
  if (entry.serializedByteCount !== Buffer.byteLength(serialized, "utf8")) {
    throw new Error(`Partition byte count mismatch for ${entry.partitionId}.`);
  }
}

export function buildReviewAssignmentPlan(grouped, { derivativeFamilyIndex = null, previousDerivativeFamilyIndex = null, derivativeReviewMetadata = {} } = {}) {
  if (!grouped?.manifest || !Array.isArray(grouped.partitions)) throw new Error("A grouped handoff is required.");
  const { manifest } = grouped;
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported grouped handoff schema version.");
  if (!Array.isArray(manifest.partitions) || manifest.partitions.length !== grouped.partitions.length) {
    throw new Error("Grouped handoff manifest partition count is invalid.");
  }
  const candidateCount = grouped.partitions.reduce((sum, partition) => sum + partition.candidates.length, 0);
  const evidenceFamilyCount = new Set(grouped.partitions.flatMap((partition) => partition.candidates.map(
    (candidate) => candidate.evidenceFamilyId,
  ))).size;
  if (candidateCount !== manifest.totals.candidateCount
      || evidenceFamilyCount !== manifest.totals.evidenceFamilyCount) {
    throw new Error("Grouped handoff totals do not match partition payloads.");
  }
  const entries = manifest.partitions.map((entry) => {
    const partition = grouped.partitions.find((candidate) => candidate.partitionId === entry.partitionId)
      ?? grouped.partitions.find((candidate) => `partition-${digest({ destination: candidate.destination, reviewClass: candidate.reviewClass }).slice(0, 24)}` === entry.partitionId);
    if (!partition) throw new Error(`Missing partition payload for ${entry.partitionId}.`);
    validatePartitionShape(entry, partition);
    const blockers = blockersFor({ ...entry, blockers: entry.blockers }, manifest.sharedMetadata);
    const routing = routeFor(entry, blockers);
    const metadata = {
      schemaVersion: reviewAssignmentSchemaVersion,
      partitionId: entry.partitionId,
      partitionDigest: entry.stableDigest,
      destinationSpec: entry.destinationSpec,
      hostFamily: entry.hostFamily,
      reviewClass: entry.reviewClass,
      candidateCount: entry.candidateCount,
      evidenceFamilyCount: entry.evidenceFamilyCount,
      partitionByteCount: entry.serializedByteCount,
      blockers,
      requiredCapabilities: routing.route === "cheap"
        ? ["read-only-review", "scope-validation"]
        : ["read-only-review", "scope-validation", "evidence-ambiguity-review"],
      route: routing.route,
      reasonCodes: [...new Set(routing.reasonCodes)].sort(),
    };
    const assignment = {
      ...metadata,
      assignmentId: `review-${digest(metadata).slice(0, 24)}`,
      assignmentDigest: digest(metadata),
    };
    if (derivativeFamilyIndex) {
      assignment.derivativeReuseRecommendations = recommendDerivativeReuse(
        derivativeFamilyIndex,
        previousDerivativeFamilyIndex,
        derivativeReviewMetadata,
      ).filter((recommendation) => partition.candidates.some((candidate) =>
        derivativeFamilyIndex.candidateFamilyRefs.some((ref) => ref.candidateId === candidate.candidateId && ref.familyId === recommendation.familyId)));
    }
    return assignment;
  }).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  const totals = {
    assignmentCount: entries.length,
    candidateCount: entries.reduce((sum, entry) => sum + entry.candidateCount, 0),
    evidenceFamilyCount: entries.reduce((sum, entry) => sum + entry.evidenceFamilyCount, 0),
    assignmentPlanByteCount: Buffer.byteLength(stableJson(entries), "utf8"),
    maxWorkerPartitionByteCount: Math.max(0, ...entries.map((entry) => entry.partitionByteCount)),
  };
  return {
    schemaVersion: reviewAssignmentSchemaVersion,
    sourceManifestDigest: digest(manifest),
    assignments: entries,
    totals,
    routingCounts: Object.fromEntries(["cheap", "luna", "manual", "block"].map((route) => [
      route, entries.filter((entry) => entry.route === route).length,
    ])),
  };
}

export function validateReviewAssignmentPlan(plan) {
  if (plan?.schemaVersion !== reviewAssignmentSchemaVersion || !Array.isArray(plan.assignments)) {
    throw new Error("Invalid review assignment plan schema.");
  }
  const ids = new Set();
  for (const assignment of plan.assignments) {
    if (ids.has(assignment.assignmentId)) throw new Error("Review assignment IDs must be unique.");
    ids.add(assignment.assignmentId);
    if (assignment.route === "cheap" && assignment.blockers.length) throw new Error("Blocked work cannot use the cheap route.");
  }
  return plan;
}

export async function enqueueReviewAssignments(plan, {
  ledgerPath,
  recipePath,
  recipeDigest,
  artifactDir,
  portal,
  endpoint,
  profile = "bounded",
} = {}) {
  validateReviewAssignmentPlan(plan);
  const results = [];
  for (const assignment of plan.assignments) {
    if (assignment.route === "block" || assignment.route === "manual") continue;
    results.push(await enqueueAssignment({
      ledgerPath,
      assignmentId: assignment.assignmentId,
      specId: assignment.destinationSpec,
      portal,
      recipePath,
      recipeDigest,
      endpoint,
      profile,
      phase: "review",
      artifactDir,
      model: assignment.route === "cheap" ? "gpt-5.3-codex-spark" : "gpt-5.6-luna",
      reasoning: assignment.route === "cheap" ? "low" : "high",
      counts: { candidates: assignment.candidateCount, evidenceFamilies: assignment.evidenceFamilyCount },
      blocker: assignment.blockers.length ? { codes: assignment.blockers } : null,
    }));
  }
  return results;
}

export function measureReviewAssignmentPlan(plan) {
  validateReviewAssignmentPlan(plan);
  return { ...plan.totals, routingCounts: plan.routingCounts };
}
