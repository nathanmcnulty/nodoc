import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateManagedCaptureAssignment } from "./portal-discovery-control-plane.mjs";

import {
  claimAssignment,
  enqueueAssignment,
  getLedgerViewFromFile,
  ledgerLeaseRenewalIntervalMs,
  ledgerStaleLeaseMs,
  normalizeEndpoint,
  resumeAttempt,
} from "./portal-discovery-ledger.mjs";

async function recipeDigest(recipePath) {
  return createHash("sha256").update(await readFile(recipePath, "utf8")).digest("hex");
}

export async function validateCaptureHandoff({ args, specRecord, recipePath, knownOperationRefreshPlan, actionBudget }) {
  if (!args.orchestrationPlan) {
    if (args.assignmentDigest) throw new Error("An assignment digest requires its persisted orchestration plan; legacy direct identity remains unknown.");
    if (args.assignmentId && !args.noLedger) {
      const view = await getLedgerViewFromFile({ ledgerPath: args.ledgerPath, filters: { assignmentId: args.assignmentId } });
      if (view.assignments[0]?.assignmentDigest) throw new Error("Managed ledger assignment requires its persisted orchestration plan.");
    }
    return { status: "legacy-identity-unknown", unattendedPromotionEligible: false };
  }
  if (args.noLedger || args.seedArtifacts || args.operationApprovalDigest || !["plan", "all"].includes(args.phase) || !args.assignmentId || !args.assignmentDigest || !args.workerId || !args.requireKnownRefresh) {
    throw new Error("Managed handoff requires plan, assignment ID/digest, worker ID, ledger and known-refresh all/plan mode.");
  }
  const bytes = await readFile(args.orchestrationPlan);
  const plan = JSON.parse(bytes);
  const assignment = validateManagedCaptureAssignment(plan, { ...args, specId: specRecord.specId, recipePath,
    recipeSha256: await recipeDigest(recipePath), refreshPlan: knownOperationRefreshPlan, actionBudget });
  const view = await getLedgerViewFromFile({ ledgerPath: args.ledgerPath, filters: { assignmentId: args.assignmentId } });
  if (args.phase !== "plan" || view.assignments.length) {
    assertManagedLedgerAssignment(view.assignments[0], args, assignment.managedCapture.recipeSha256);
  }
  return { status: "managed-bound", unattendedPromotionEligible: false, requiresManagedResultValidation: true, planPath: args.orchestrationPlan, planSha256: createHash("sha256").update(bytes).digest("hex") };
}

function assertManagedLedgerAssignment(assignment, args, digest) {
  if (!assignment || assignment.assignmentDigest !== args.assignmentDigest || assignment.workerId !== args.workerId
    || assignment.recipeDigest !== digest || assignment.endpoint !== normalizeEndpoint(args.endpoint) || assignment.profile !== args.profile
    || assignment.latestAttempt.model !== args.model || assignment.latestAttempt.reasoning !== args.reasoning
    || assignment.phase !== "all" || !["queued", "running"].includes(assignment.latestAttempt.status)
    || (assignment.latestAttempt.status === "running" && assignment.latestAttempt.lease?.owner !== args.workerId)) {
    throw new Error("Managed ledger assignment/worker/lease does not match the planned handoff.");
  }
}

export async function prepareLedgerAttempt(args, specRecord, recipePath) {
  if (args.noLedger || args.phase === "plan" || !args.endpoint) {
    return null;
  }
  const digest = await recipeDigest(recipePath);
  const endpoint = normalizeEndpoint(args.endpoint);
  const assignmentId = args.assignmentId || `${specRecord.specId}-${createHash("sha256")
      .update(`${specRecord.specId}|${endpoint}|${digest}|${args.phase}|${args.priority}`)
      .digest("hex")
      .slice(0, 16)}`;
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
  if (args.orchestrationPlan) {
    if (createHash("sha256").update(await readFile(args.orchestrationPlan)).digest("hex") !== args.identityLinkage?.planSha256) throw new Error("Orchestration plan changed after preflight validation.");
    const view = await getLedgerViewFromFile({ ledgerPath: args.ledgerPath, filters: { assignmentId } });
    assertManagedLedgerAssignment(view.assignments[0], args, digest);
  }
  const claimInput = {
    ledgerPath: args.ledgerPath,
    assignmentId,
    assignmentDigest: args.assignmentDigest,
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
  };
  let claimed = await claimAssignment(claimInput);
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
    const retryCompletedAnalysis = args.phase === "analyze"
      && ["blocked", "failed"].includes(attempt?.status)
      && attempt.captureComplete === true
      && attempt.artifactHashes?.artifactDir === createHash("sha256").update(path.resolve(args.artifacts)).digest("hex");
    const retryIncompleteCapture = args.seedArtifacts
      && ["blocked", "failed", "stale"].includes(attempt?.status)
      && attempt.captureComplete !== true;
    if (
      (retryCompletedAnalysis || retryIncompleteCapture)
      && assignment.endpoint === endpoint
      && assignment.profile === args.profile
      && assignment.phase === args.phase
      && assignment.recipeDigest === digest
    ) {
      if (retryIncompleteCapture) {
        const seedRun = JSON.parse(await readFile(path.join(args.seedArtifacts, "discovery-run.json"), "utf8"));
        if (
          seedRun?.ledger?.assignmentId !== assignmentId
          || Number(seedRun?.ledger?.attemptNumber) !== attempt.attemptNumber
        ) {
          throw new Error(`Seed artifacts do not identify terminal attempt ${attempt.attemptNumber} for ${assignmentId}.`);
        }
      }
      await resumeAttempt({
        ledgerPath: args.ledgerPath,
        assignmentId,
        assignmentDigest: args.assignmentDigest,
        artifactDir: args.artifacts,
        phase: args.phase,
        workerId: args.workerId,
        model: args.model,
        reasoning: args.reasoning,
        expectedAttemptNumber: attempt.attemptNumber,
        expectedStatus: attempt.status,
      });
      claimed = await claimAssignment(claimInput);
      if (claimed) {
        args.attemptNumber = claimed.assignment.latestAttempt.attemptNumber;
        return claimed.assignment;
      }
    }
    throw new Error(
      `Ledger assignment ${assignmentId} is unavailable because its endpoint/profile lease is held or its state conflicts.`,
    );
  }
  args.attemptNumber = claimed.assignment.latestAttempt.attemptNumber;
  return claimed.assignment;
}
