import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  claimAssignment,
  enqueueAssignment,
  getLedgerViewFromFile,
  ledgerLeaseRenewalIntervalMs,
  ledgerStaleLeaseMs,
  normalizeEndpoint,
} from "./portal-discovery-ledger.mjs";
import { canonicalRecipeDigest } from "./portal-discovery-recipe.mjs";

export async function recipeDigest(recipePath) {
  const recipe = JSON.parse(await readFile(recipePath, "utf8"));
  return canonicalRecipeDigest(recipe);
}

export function buildRecipeAssignmentId({ specId, endpoint, digest, phase = "all", priority = "normal" }) {
  return `${specId}-${createHash("sha256")
    .update(`${specId}|${endpoint}|${digest}|${phase}|${priority}`)
    .digest("hex")
    .slice(0, 16)}`;
}

export async function prepareLedgerAttempt(args, specRecord, recipePath) {
  if (args.noLedger || args.phase === "plan" || !args.endpoint) {
    return null;
  }
  const digest = await recipeDigest(recipePath);
  const endpoint = normalizeEndpoint(args.endpoint);
  const assignmentId = args.assignmentId || buildRecipeAssignmentId({
    specId: specRecord.specId,
    endpoint,
    digest,
    phase: args.phase,
    priority: args.priority,
  });
  if (!args.assignmentId) {
    await enqueueAssignment({
      ledgerPath: args.ledgerPath,
      assignmentId,
      specId: specRecord.specId,
      portal: specRecord.title,
      recipePath,
      recipeDigest: digest,
      endpoint,
      profile: args.profile,
      phase: args.phase,
      priority: args.priority,
      artifactDir: args.artifacts,
      model: args.model,
      reasoning: args.reasoning,
      workerId: args.workerId,
    });
  }
  args.assignmentId = assignmentId;
  const claimed = await claimAssignment({
    ledgerPath: args.ledgerPath,
    assignmentId,
    endpoint,
    phase: args.phase,
    profile: args.profile,
    workerId: args.workerId,
    model: args.model,
    reasoning: args.reasoning,
    leaseMs: Math.max(
      ledgerStaleLeaseMs,
      args.captureSupervisionTimeoutMs + args.supervisionTimeoutMs + ledgerLeaseRenewalIntervalMs,
    ),
  });
  if (!claimed) {
    const current = await getLedgerViewFromFile({
      ledgerPath: args.ledgerPath,
      filters: { assignmentId },
      includeAttempts: true,
    });
    const assignment = current.assignments[0];
    const attempt = assignment?.latestAttempt;
    if (
      attempt?.status === "running"
      && attempt.lease?.owner === args.workerId
      && assignment.endpoint === endpoint
      && assignment.profile === args.profile
    ) {
      args.attemptNumber = attempt.attemptNumber;
      return assignment;
    }
    throw new Error(
      `Ledger assignment ${assignmentId} is unavailable because its endpoint/profile lease is held or its state conflicts.`,
    );
  }
  args.attemptNumber = claimed.assignment.latestAttempt.attemptNumber;
  return claimed.assignment;
}
