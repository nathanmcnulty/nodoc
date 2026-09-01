import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateOperationSummary } from "./portal-discovery-operation-safety.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultLedgerPath = path.join(repoRoot, ".portal-discovery-ledger.jsonl");
export const ledgerSchemaVersion = 1;
export const ledgerStaleLeaseMs = 5 * 60 * 1000;
export const ledgerLeaseRenewalIntervalMs = 60 * 1000;
export const globalLiveLifecycleKey = "global-browser-cdp";
const liveLifecyclePhases = new Set(["all", "capture", "preflight", "alignment", "finalization", "shutdown"]);

const lockStaleMs = 30_000;
const lockWaitMs = 10_000;
const statuses = new Set([
  "queued",
  "running",
  "captured",
  "analyzed",
  "completed",
  "blocked",
  "failed",
  "stale",
]);
const terminalStatuses = new Set(["completed", "blocked", "failed", "stale"]);
const transitions = {
  queued: new Set(["running", "captured", "blocked", "failed", "stale"]),
  running: new Set(["captured", "analyzed", "completed", "blocked", "failed", "stale"]),
  captured: new Set(["analyzed", "completed", "blocked", "failed"]),
  analyzed: new Set(["completed", "blocked", "failed"]),
  completed: new Set(["completed"]),
  blocked: new Set(["blocked"]),
  failed: new Set(["failed"]),
  stale: new Set(["queued", "running", "stale"]),
};
const priorities = {
  high: 30,
  medium: 20,
  normal: 20,
  low: 10,
  unknown: 0,
};
const safeObjectKeys = new Set([
  "code",
  "detail",
  "remediation",
  "source",
  "inconsistency",
  "recommended",
  "reason",
  "category",
  "counts",
  "captureComplete",
  "captureStatus",
  "captureReason",
  "accounting",
  "recommendation",
  "schemaVersion",
  "enabled",
  "applied",
  "thresholds",
  "recipeComplete",
  "windowsEvaluated",
  "consecutiveLowGainWindows",
  "lowGainWindowCount",
  "gains",
  "remainingEligibleWork",
  "blockers",
  "windows",
  "actionCount",
  "eligibleActionCount",
  "gain",
  "candidateFamilies",
  "requestFamilies",
  "successfulTransitions",
  "total",
  "newCandidateFamilies",
  "newRequestFamilies",
  "eligibleActions",
  "highValuePending",
  "scopeAmbiguity",
  "unknownEligibility",
  "attemptCount",
  "byState",
  "unresolvedOperationIds",
  "safeToContinue",
  "receipts",
  "operationId",
  "mode",
  "approvalDigest",
  "executionState",
  "unresolvedReason",
  "applySent",
  "rollbackSent",
  "duplicateSteps",
  "missingSteps",
  "abortAcknowledged",
  "matchedRequestCount",
  "matchedSessionId",
  "matchedTargetId",
  "boundSessionId",
  "boundTargetId",
  "setupFailureCount",
  "uniqueControl",
  "unexpectedActiveRequestCount",
  "documentInvalidated",
  "targetTerminated",
  "interceptionHeldOnContainmentFailure",
  "artifactValidationFailed",
  "interception",
  "approvedRequestCount",
  "duplicateApprovedRequestCount",
  "stepCount",
  "expectedStepCount",
  "unexpectedSteps",
  "aborted-before-send",
  "sent-no-confirmed-change",
  "committed-and-restored",
  "unresolved-change",
]);

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function normalizeEndpoint(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("endpoint must be a non-empty string.");
  }
  const trimmed = value.trim();
  if (/^https?:\/\//iu.test(trimmed)) {
    const parsed = new URL(trimmed);
    if (
      parsed.username
      || parsed.password
      || (parsed.pathname !== "/" && parsed.pathname !== "")
      || parsed.search
      || parsed.hash
    ) {
      throw new Error("endpoint URL must contain only an HTTP(S) origin.");
    }
    return `${parsed.hostname.toLowerCase()}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  }
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/iu.test(trimmed)) {
    throw new Error("endpoint must be a hostname with an optional port.");
  }
  return trimmed.includes(":")
    ? trimmed.toLowerCase()
    : `${trimmed.toLowerCase()}:443`;
}

function normalizePriority(value) {
  if (Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return priorities[String(value || "unknown").trim().toLowerCase()] ?? priorities.unknown;
}

function portablePath(value) {
  if (!value) {
    return null;
  }
  const resolved = path.resolve(value);
  const relative = path.relative(repoRoot, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }
  return `[external]/${path.basename(resolved)}`;
}

function artifactHash(value) {
  return value ? { artifactDir: sha256(path.resolve(value)) } : {};
}

function sanitizeText(value, maxLength = 2_000) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeStructured(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) {
    return null;
  }
  if (typeof value === "boolean" || Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeStructured(entry, depth + 1));
  }
  if (typeof value !== "object") {
    return null;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => safeObjectKeys.has(key))
      .map(([key, entry]) => [key, sanitizeStructured(entry, depth + 1)]),
  );
}

function attemptShell(assignmentId, input = {}) {
  const attemptNumber = Number(input.attemptNumber);
  return {
    attemptId: sha256(`${assignmentId}|${attemptNumber}|${input.phase || "all"}`),
    attemptNumber,
    phase: input.phase || "all",
    status: input.status || "queued",
    artifactDir: portablePath(input.artifactDir),
    model: sanitizeText(input.model, 100),
    reasoning: sanitizeText(input.reasoning, 100),
    checkpointCursor: sanitizeText(input.checkpointCursor, 500),
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    updatedAt: input.updatedAt ?? nowIso(),
    counts: input.counts ?? null,
    captureComplete: input.captureComplete ?? null,
    captureStatus: sanitizeText(input.captureStatus, 100),
    captureReason: sanitizeText(input.captureReason, 200),
    interactionHealth: sanitizeStructured(input.interactionHealth),
    activeOperations: sanitizeStructured(input.activeOperations),
    saturation: sanitizeStructured(input.saturation),
    nextAction: sanitizeStructured(input.nextAction),
    blocker: sanitizeStructured(input.blocker),
    artifactHashes: input.artifactHashes ?? artifactHash(input.artifactDir),
    promotionRef: sanitizeText(input.promotionRef, 500),
    reviewRef: sanitizeText(input.reviewRef, 500),
    mergeRef: sanitizeText(input.mergeRef, 500),
    lease: input.lease ?? null,
  };
}

function assignmentState(assignment) {
  const status = assignment.latestAttempt?.status;
  return status === "running" ? "capturing" : status || "queued";
}

function compareAssignments(left, right) {
  return right.priority - left.priority
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.assignmentId.localeCompare(right.assignmentId);
}

function applyPatch(attempt, patch, now = Date.now()) {
  const status = patch.status ?? attempt.status;
  if (!statuses.has(status)) {
    throw new Error(`Unsupported status ${status}.`);
  }
  if (status !== attempt.status && !transitions[attempt.status]?.has(status)) {
    throw new Error(`Cannot transition status from ${attempt.status} to ${status}.`);
  }
  const next = {
    ...attempt,
    ...patch,
    status,
    interactionHealth: patch.interactionHealth === undefined
      ? attempt.interactionHealth
      : sanitizeStructured(patch.interactionHealth),
    activeOperations: patch.activeOperations === undefined
      ? attempt.activeOperations
      : sanitizeStructured(patch.activeOperations),
    saturation: patch.saturation === undefined
      ? attempt.saturation
      : sanitizeStructured(patch.saturation),
    nextAction: patch.nextAction === undefined
      ? attempt.nextAction
      : sanitizeStructured(patch.nextAction),
    blocker: patch.blocker === undefined ? attempt.blocker : sanitizeStructured(patch.blocker),
    model: patch.model === undefined ? attempt.model : sanitizeText(patch.model, 100),
    reasoning: patch.reasoning === undefined ? attempt.reasoning : sanitizeText(patch.reasoning, 100),
    checkpointCursor: patch.checkpointCursor === undefined
      ? attempt.checkpointCursor
      : sanitizeText(patch.checkpointCursor, 500),
    promotionRef: patch.promotionRef === undefined
      ? attempt.promotionRef
      : sanitizeText(patch.promotionRef, 500),
    reviewRef: patch.reviewRef === undefined
      ? attempt.reviewRef
      : sanitizeText(patch.reviewRef, 500),
    mergeRef: patch.mergeRef === undefined
      ? attempt.mergeRef
      : sanitizeText(patch.mergeRef, 500),
    updatedAt: nowIso(now),
  };
  if (patch.artifactDir) {
    next.artifactDir = portablePath(patch.artifactDir);
  }
  if (status === "running" && !next.startedAt) {
    next.startedAt = nowIso(now);
  }
  if (terminalStatuses.has(status) && !next.completedAt) {
    next.completedAt = nowIso(now);
  }
  if (status !== "running") {
    next.lease = null;
  }
  return next;
}

function equivalent(left, right) {
  const ignored = new Set(["updatedAt"]);
  const project = (value) => Object.fromEntries(
    Object.entries(value).filter(([key]) => !ignored.has(key)),
  );
  return JSON.stringify(project(left)) === JSON.stringify(project(right));
}

export async function readLedgerRecords(ledgerPath = defaultLedgerPath) {
  let content;
  try {
    content = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines = content.split(/\r?\n/u);
  const hasPartialTail = lines.at(-1) !== "";
  const records = lines.flatMap((line, index) => {
    if (hasPartialTail && index === lines.length - 1) {
      return [];
    }
    if (!line.trim()) {
      return [];
    }
    try {
      return [{ line: index + 1, value: JSON.parse(line) }];
    } catch (error) {
      return [{
        line: index + 1,
        parseError: error instanceof Error ? error.message : String(error),
      }];
    }
  });
  if (hasPartialTail) {
    records.partialTail = { line: lines.length, policy: "ignored-until-next-complete-record" };
  }
  return records;
}

async function appendRecord(ledgerPath, record, recordedAt = nowIso()) {
  const payload = {
    recordedAt,
    recordVersion: ledgerSchemaVersion,
    ...record,
  };
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    flush: true,
  });
  return payload;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLedgerLock(ledgerPath, callback) {
  const lockPath = `${ledgerPath}.lock`;
  const startedAt = Date.now();
  const owner = randomUUID();
  await mkdir(path.dirname(ledgerPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ owner, pid: process.pid, createdAt: nowIso() })}\n`,
        "utf8",
      );
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > lockStaleMs) {
          const reclaimPath = `${lockPath}.reclaim-${randomUUID()}`;
          try {
            await rename(lockPath, reclaimPath);
          } catch (reclaimError) {
            if (reclaimError?.code === "ENOENT") {
              continue;
            }
            throw reclaimError;
          }
          await rm(reclaimPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") {
          continue;
        }
        throw statError;
      }
      if (Date.now() - startedAt >= lockWaitMs) {
        throw new Error(`Timed out waiting for ledger lock ${path.basename(lockPath)}.`);
      }
      await sleep(20);
    }
  }

  try {
    return await callback();
  } finally {
    let lockOwner = null;
    try {
      lockOwner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")).owner;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    if (lockOwner === owner) {
      await rm(lockPath, { recursive: true, force: true });
    }
  }
}

export function buildLedgerState(records, now = Date.now()) {
  const state = {
    generatedAt: nowIso(now),
    schemaVersion: ledgerSchemaVersion,
    assignments: new Map(),
    corruptLines: [],
    partialTail: records.partialTail ?? null,
  };

  for (const raw of records) {
    const record = raw?.value;
    if (!record) {
      state.corruptLines.push({
        line: raw?.line ?? -1,
        parseError: raw?.parseError || "Unreadable record.",
      });
      continue;
    }
    if (
      record.recordVersion !== ledgerSchemaVersion
      || !["assignment-created", "attempt-created", "attempt-updated"].includes(record.eventType)
      || typeof record.assignmentId !== "string"
    ) {
      state.corruptLines.push({ line: raw.line, parseError: "Invalid ledger record." });
      continue;
    }

    const payload = record.payload || {};
    const existing = state.assignments.get(record.assignmentId);
    if (record.eventType === "assignment-created") {
      if (existing) {
        continue;
      }
      if (!payload.specId || !payload.portal || !payload.recipePath || !payload.endpoint || !payload.recipeDigest) {
        state.corruptLines.push({
          line: raw.line,
          parseError: `Assignment ${record.assignmentId} is missing creation fields.`,
        });
        continue;
      }
      const attempt = attemptShell(record.assignmentId, {
        attemptNumber: 1,
        phase: payload.phase,
        artifactDir: payload.artifactDir,
        artifactHashes: payload.artifactHashes,
        model: payload.model,
        reasoning: payload.reasoning,
        checkpointCursor: payload.checkpointCursor,
      });
      const assignment = {
        assignmentId: record.assignmentId,
        createdAt: record.createdAt || record.recordedAt,
        updatedAt: record.createdAt || record.recordedAt,
        specId: sanitizeText(payload.specId, 200),
        portal: sanitizeText(payload.portal, 500),
        recipePath: portablePath(payload.recipePath),
        recipeDigest: sanitizeText(payload.recipeDigest, 128),
        endpoint: normalizeEndpoint(payload.endpoint),
        profile: sanitizeText(payload.profile || "bounded", 50),
        phase: payload.phase || "all",
        priority: normalizePriority(payload.priority),
        attempts: [attempt],
        latestAttempt: attempt,
      };
      assignment.state = assignmentState(assignment);
      state.assignments.set(record.assignmentId, assignment);
      continue;
    }

    if (!existing) {
      state.corruptLines.push({
        line: raw.line,
        parseError: `Attempt event for unknown assignment ${record.assignmentId}.`,
      });
      continue;
    }
    const attemptNumber = Number(record.attemptNumber);
    if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
      state.corruptLines.push({ line: raw.line, parseError: "Invalid attempt number." });
      continue;
    }
    const attempt = existing.attempts.find((entry) => entry.attemptNumber === attemptNumber);
    if (record.eventType === "attempt-created") {
      if (attempt) {
        continue;
      }
      existing.attempts.push(attemptShell(record.assignmentId, {
        ...payload,
        attemptNumber,
      }));
      existing.attempts.sort((left, right) => left.attemptNumber - right.attemptNumber);
    } else {
      if (!attempt) {
        state.corruptLines.push({
          line: raw.line,
          parseError: `Unknown attempt ${attemptNumber} for ${record.assignmentId}.`,
        });
        continue;
      }
      try {
        Object.assign(attempt, applyPatch(attempt, payload, Date.parse(record.recordedAt) || now));
      } catch (error) {
        state.corruptLines.push({
          line: raw.line,
          parseError: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    existing.latestAttempt = existing.attempts.at(-1);
    existing.phase = existing.latestAttempt.phase;
    existing.updatedAt = existing.latestAttempt.updatedAt;
    existing.state = assignmentState(existing);
  }

  for (const assignment of state.assignments.values()) {
    const attempt = assignment.latestAttempt;
    if (
      attempt?.status === "running"
      && Number.isFinite(Date.parse(attempt.lease?.expiresAt))
      && Date.parse(attempt.lease.expiresAt) <= now
    ) {
      Object.assign(attempt, applyPatch(attempt, {
        status: "stale",
        blocker: {
          code: "stale-endpoint-lease",
          detail: "Capture lease expired before the attempt completed.",
          remediation: "Resume with a fresh artifact directory.",
        },
      }, now));
      assignment.updatedAt = attempt.updatedAt;
      assignment.state = "stale";
    }
  }
  return state;
}

function assignmentView(assignment, includeAttempts = true) {
  if (!assignment) {
    return null;
  }
  const latest = structuredClone(assignment.latestAttempt);
  return {
    assignmentId: assignment.assignmentId,
    state: assignment.state,
    specId: assignment.specId,
    portal: assignment.portal,
    recipePath: assignment.recipePath,
    recipeDigest: assignment.recipeDigest,
    endpoint: assignment.endpoint,
    profile: assignment.profile,
    phase: assignment.phase,
    priority: assignment.priority,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
    blocked: assignment.state === "blocked" ? latest?.blocker ?? null : null,
    latestAttempt: latest,
    attempts: includeAttempts
      ? assignment.attempts.map((attempt) => structuredClone(attempt))
      : null,
  };
}

export function assertValidAssignmentId(value) {
  const normalized = sanitizeText(value, 200);
  if (!normalized || !/^[a-z0-9][a-z0-9._-]*$/iu.test(normalized)) {
    throw new Error("assignmentId must use only letters, numbers, dots, underscores, or hyphens.");
  }
  return normalized;
}

function sameAssignment(assignment, input) {
  return assignment.specId === sanitizeText(input.specId, 200)
    && assignment.portal === sanitizeText(input.portal, 500)
    && assignment.recipePath === portablePath(input.recipePath)
    && assignment.recipeDigest === sanitizeText(input.recipeDigest, 128)
    && assignment.endpoint === normalizeEndpoint(input.endpoint)
    && assignment.profile === sanitizeText(input.profile || "bounded", 50)
    && assignment.phase === (input.phase || "all");
}

export async function enqueueAssignment(input) {
  const ledgerPath = input.ledgerPath || defaultLedgerPath;
  return withLedgerLock(ledgerPath, async () => {
    const assignmentId = assertValidAssignmentId(
      input.assignmentId || `${input.specId}-${sha256(`${input.specId}|${input.endpoint}|${input.recipeDigest}|${input.phase || "all"}`).slice(0, 16)}`,
    );
    if (!input.specId || !input.portal || !input.recipePath || !input.recipeDigest || !input.endpoint) {
      throw new Error("Assignment creation requires specId, portal, recipePath, recipeDigest, and endpoint.");
    }
    const records = await readLedgerRecords(ledgerPath);
    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    if (!Number.isFinite(nowMs)) throw new Error("Invalid now timestamp.");
    const state = buildLedgerState(records, nowMs);
    const existing = state.assignments.get(assignmentId);
    if (existing) {
      if (!sameAssignment(existing, input)) {
        throw new Error(`Assignment ${assignmentId} already exists with different immutable fields.`);
      }
      return { assignment: assignmentView(existing), event: null, noop: true };
    }
    const createdAt = input.createdAt || nowIso();
    const event = {
      eventType: "assignment-created",
      assignmentId,
      actor: sanitizeText(input.workerId || "orchestrator", 200),
      createdAt,
      payload: {
        specId: sanitizeText(input.specId, 200),
        portal: sanitizeText(input.portal, 500),
        recipePath: portablePath(input.recipePath),
        recipeDigest: sanitizeText(input.recipeDigest, 128),
        endpoint: normalizeEndpoint(input.endpoint),
        profile: sanitizeText(input.profile || "bounded", 50),
        phase: input.phase || "all",
        priority: normalizePriority(input.priority),
        model: sanitizeText(input.model, 100),
        reasoning: sanitizeText(input.reasoning, 100),
        artifactDir: portablePath(input.artifactDir),
        artifactHashes: artifactHash(input.artifactDir),
        checkpointCursor: sanitizeText(input.checkpointCursor, 500),
      },
    };
    const record = await appendRecord(ledgerPath, event, createdAt);
    const updated = buildLedgerState(
      [...records, { line: records.length + 1, value: record }],
      nowMs,
    );
    return { assignment: assignmentView(updated.assignments.get(assignmentId)), event, noop: false };
  });
}

export async function claimAssignment(input) {
  const ledgerPath = input.ledgerPath || defaultLedgerPath;
  return withLedgerLock(ledgerPath, async () => {
    const now = input.now || nowIso();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      throw new Error("Invalid now timestamp.");
    }
    const records = await readLedgerRecords(ledgerPath);
    const state = buildLedgerState(records, nowMs);
    const endpoint = input.endpoint ? normalizeEndpoint(input.endpoint) : null;
    const profile = input.profile ? sanitizeText(input.profile, 50) : null;
    const activeKeys = new Set(
      [...state.assignments.values()]
        .filter((assignment) => assignment.latestAttempt?.status === "running")
        .map((assignment) => `${assignment.endpoint}|${assignment.profile}`),
    );
    const activeLiveLifecycle = [...state.assignments.values()]
      .some((assignment) => assignment.latestAttempt?.status === "running" && liveLifecyclePhases.has(assignment.phase));
    const chosen = [...state.assignments.values()]
      .filter((assignment) => assignment.state === "queued")
      .filter((assignment) => !input.assignmentId || assignment.assignmentId === input.assignmentId)
      .filter((assignment) => !endpoint || assignment.endpoint === endpoint)
      .filter((assignment) => !profile || assignment.profile === profile)
      .filter((assignment) => !input.phase || input.phase === "all" || assignment.phase === input.phase)
      .filter((assignment) => (
        !liveLifecyclePhases.has(assignment.phase)
        || !activeLiveLifecycle
      ))
      .filter((assignment) => (
        !liveLifecyclePhases.has(assignment.phase)
        || !activeKeys.has(`${assignment.endpoint}|${assignment.profile}`)
      ))
      .sort(compareAssignments)[0];
    if (!chosen) {
      return null;
    }
    const attempt = chosen.latestAttempt;
    const next = applyPatch(attempt, {
      status: "running",
      model: input.model ?? attempt.model,
      reasoning: input.reasoning ?? attempt.reasoning,
      lease: {
        owner: sanitizeText(input.workerId || "worker", 200),
        endpoint: chosen.endpoint,
        profile: chosen.profile,
        startedAt: now,
        expiresAt: nowIso(nowMs + (input.leaseMs || ledgerStaleLeaseMs)),
      },
    }, nowMs);
    const event = {
      eventType: "attempt-updated",
      assignmentId: chosen.assignmentId,
      attemptNumber: attempt.attemptNumber,
      actor: sanitizeText(input.workerId || "worker", 200),
      payload: next,
    };
    const record = await appendRecord(ledgerPath, event, now);
    const updated = buildLedgerState(
      [...records, { line: records.length + 1, value: record }],
      nowMs,
    );
    return { assignment: assignmentView(updated.assignments.get(chosen.assignmentId)), event };
  });
}

export async function renewAttemptLease(input) {
  const ledgerPath = input.ledgerPath || defaultLedgerPath;
  return withLedgerLock(ledgerPath, async () => {
    const now = input.now || nowIso();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error("Invalid now timestamp.");
    const records = await readLedgerRecords(ledgerPath);
    const state = buildLedgerState(records, nowMs);
    const assignment = state.assignments.get(assertValidAssignmentId(input.assignmentId));
    const attempt = assignment?.attempts.find((entry) => entry.attemptNumber === Number(input.attemptNumber));
    if (!attempt) throw new Error("Unknown attempt for lease renewal.");
    if (attempt.status !== "running" || attempt.lease?.owner !== sanitizeText(input.workerId || "worker", 200)) {
      throw new Error("Cannot renew a lease not owned by this worker.");
    }
    const leaseMs = Number(input.leaseMs || ledgerStaleLeaseMs);
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive.");
    const next = applyPatch(attempt, {
      lease: { ...attempt.lease, expiresAt: nowIso(nowMs + leaseMs) },
    }, nowMs);
    const event = {
      eventType: "attempt-updated",
      assignmentId: assignment.assignmentId,
      attemptNumber: attempt.attemptNumber,
      actor: sanitizeText(input.workerId || "worker", 200),
      payload: next,
    };
    const record = await appendRecord(ledgerPath, event, now);
    const updated = buildLedgerState([...records, { line: records.length + 1, value: record }], nowMs);
    return { assignment: assignmentView(updated.assignments.get(assignment.assignmentId)), event };
  });
}

export async function resumeAttempt(input) {
  const ledgerPath = input.ledgerPath || defaultLedgerPath;
  return withLedgerLock(ledgerPath, async () => {
    const assignmentId = assertValidAssignmentId(input.assignmentId);
    const records = await readLedgerRecords(ledgerPath);
    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    if (!Number.isFinite(nowMs)) throw new Error("Invalid now timestamp.");
    const state = buildLedgerState(records, nowMs);
    const assignment = state.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Unknown assignment ${assignmentId}.`);
    }
    if (
      input.expectedAttemptNumber !== undefined
      && assignment.latestAttempt?.attemptNumber !== Number(input.expectedAttemptNumber)
    ) {
      throw new Error(`Cannot resume ${assignmentId}; the latest attempt changed.`);
    }
    if (
      input.expectedStatus !== undefined
      && assignment.latestAttempt?.status !== input.expectedStatus
    ) {
      throw new Error(`Cannot resume ${assignmentId}; the latest attempt status changed.`);
    }
    if (assignment.latestAttempt?.status === "running") {
      throw new Error(`Cannot resume a running attempt for ${assignmentId}.`);
    }
    const attemptNumber = assignment.attempts.at(-1).attemptNumber + 1;
    const artifactDir = input.artifactDir
      || `${assignment.latestAttempt.artifactDir || `artifacts/${assignmentId}`}-retry-${attemptNumber}`;
    const attempt = attemptShell(assignmentId, {
      attemptNumber,
      phase: input.phase || assignment.latestAttempt.phase,
      artifactDir,
      model: input.model ?? assignment.latestAttempt.model,
      reasoning: input.reasoning ?? assignment.latestAttempt.reasoning,
      checkpointCursor: input.checkpointCursor ?? assignment.latestAttempt.checkpointCursor,
    });
    const event = {
      eventType: "attempt-created",
      assignmentId,
      attemptNumber,
      actor: sanitizeText(input.workerId || "orchestrator", 200),
      payload: attempt,
    };
    const record = await appendRecord(ledgerPath, event);
    const updated = buildLedgerState([...records, { line: records.length + 1, value: record }]);
    const updatedAssignment = updated.assignments.get(assignmentId);
    return {
      assignment: assignmentView(updatedAssignment),
      attempt: structuredClone(updatedAssignment.latestAttempt),
      event,
    };
  });
}

export async function updateAttempt(input) {
  if (input.activeOperations !== undefined && input.activeOperations !== null) {
    input = { ...input, activeOperations: validateOperationSummary(input.activeOperations) };
    if (
      input.activeOperations.safeToContinue === false
      && ["captured", "analyzed", "completed"].includes(input.status)
    ) {
      input.status = "blocked";
      input.blocker = input.blocker ?? {
        code: "mutation-state-unresolved",
        operationIds: input.activeOperations.unresolvedOperationIds,
        remediation: "Resolve the active operation before another live lifecycle.",
      };
    }
  }
  const ledgerPath = input.ledgerPath || defaultLedgerPath;
  return withLedgerLock(ledgerPath, async () => {
    const assignmentId = assertValidAssignmentId(input.assignmentId);
    const attemptNumber = Number(input.attemptNumber);
    if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
      throw new Error("attemptNumber must be a positive integer.");
    }
    const records = await readLedgerRecords(ledgerPath);
    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    if (!Number.isFinite(nowMs)) throw new Error("Invalid now timestamp.");
    const state = buildLedgerState(records, nowMs);
    const assignment = state.assignments.get(assignmentId);
    const attempt = assignment?.attempts.find((entry) => entry.attemptNumber === attemptNumber);
    if (!attempt) {
      throw new Error(`Unknown attempt ${attemptNumber} for assignment ${assignmentId}.`);
    }
    if (attempt.status === "stale" && terminalStatuses.has(input.status)) {
      return { assignment: assignmentView(assignment), event: null, noop: true };
    }
    const patch = Object.fromEntries(
      [
        "status",
        "checkpointCursor",
        "counts",
        "captureComplete",
        "captureStatus",
        "captureReason",
        "interactionHealth",
        "activeOperations",
        "saturation",
        "nextAction",
        "blocker",
        "artifactDir",
        "artifactHashes",
        "promotionRef",
        "reviewRef",
        "mergeRef",
        "model",
        "reasoning",
      ].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
    );
    const next = applyPatch(attempt, patch, nowMs);
    if (equivalent(attempt, next)) {
      return { assignment: assignmentView(assignment), event: null, noop: true };
    }
    const event = {
      eventType: "attempt-updated",
      assignmentId,
      attemptNumber,
      actor: sanitizeText(input.actor || "orchestrator", 200),
      payload: next,
    };
    const record = await appendRecord(ledgerPath, event, nowIso(nowMs));
    const updated = buildLedgerState([...records, { line: records.length + 1, value: record }]);
    return { assignment: assignmentView(updated.assignments.get(assignmentId)), event, noop: false };
  });
}

export function buildAttemptCountsFromRunState(runState = {}) {
  const candidate = runState.candidateCounts || {};
  const interaction = runState.interactionHealth?.counts || {};
  const promotionFields = [
    "confirmedRead",
    "confirmedSafetyReview",
    "successfullyProbed",
    "adjacentConfirmedRead",
    "adjacentConfirmedSafetyReview",
    "adjacentSuccessfullyProbed",
  ];
  return {
    action: Number(interaction.attempted) || 0,
    request: Number(interaction.attempted) || 0,
    bundle: (Number(candidate.bundleOnly) || 0) + (Number(candidate.adjacentBundleOnly) || 0),
    parse: Number(candidate.parseCandidateCount) || 0,
    candidate: [
      "adjacentBundleOnly",
      "bundleOnly",
      ...promotionFields,
    ].reduce((sum, key) => sum + (Number(candidate[key]) || 0), 0),
    noise: Number(candidate.suppressed) || 0,
    promotion: promotionFields.reduce((sum, key) => sum + (Number(candidate[key]) || 0), 0),
  };
}

export async function updateAttemptFromDiscoveryRun(input) {
  if (!input.discoveryRun || typeof input.discoveryRun !== "object") {
    throw new Error("discoveryRun is required for updateAttemptFromDiscoveryRun.");
  }
  const run = input.discoveryRun;
  const activeOperations = run.activeOperations == null
    ? null
    : validateOperationSummary(run.activeOperations);
  const unsafeActiveOperation = activeOperations?.safeToContinue === false;
  const requestedStatus = run.status || "completed";
  const status = unsafeActiveOperation
    && ["captured", "analyzed", "completed"].includes(requestedStatus)
    ? "blocked"
    : requestedStatus;
  const blocker = unsafeActiveOperation && !run.blocker
    ? {
        code: "mutation-state-unresolved",
        operationIds: activeOperations.unresolvedOperationIds,
        remediation: "Resolve the active operation before another live lifecycle.",
      }
    : run.blocker ?? null;
  return updateAttempt({
    ...input,
    status,
    counts: buildAttemptCountsFromRunState(run),
    captureComplete: run.capture?.captureComplete ?? null,
    captureStatus: run.capture?.captureStatus ?? null,
    captureReason: run.capture?.reason ?? null,
    interactionHealth: run.interactionHealth ?? null,
    activeOperations,
    saturation: run.saturation ?? null,
    nextAction: run.recommendedNextAction ?? null,
    blocker,
    artifactDir: input.artifactDir || run.artifacts || run.artifactDir || undefined,
    artifactHashes: artifactHash(input.artifactDir || run.artifacts || run.artifactDir),
  });
}

export async function getLedgerViewFromFile(input = {}) {
  const records = await readLedgerRecords(input.ledgerPath || defaultLedgerPath);
  const state = buildLedgerState(records, input.now ?? Date.now());
  const assignments = [...state.assignments.values()]
    .filter((assignment) => !input.filters?.assignmentId || assignment.assignmentId === input.filters.assignmentId)
    .filter((assignment) => !input.filters?.specId || assignment.specId === input.filters.specId)
    .filter((assignment) => !input.filters?.portal || assignment.portal === input.filters.portal)
    .filter((assignment) => !input.filters?.state || assignment.state === input.filters.state)
    .sort(compareAssignments);
  const ready = assignments.filter((assignment) => assignment.state === "queued");
  const blocked = assignments.filter((assignment) => assignment.state === "blocked");
  const completed = assignments.filter((assignment) => assignment.state === "completed");
  const view = input.view || "all";
  const selected = view === "ready"
    ? ready
    : view === "blocked"
      ? blocked
      : view === "completed"
        ? completed
        : assignments;
  return {
    generatedAt: state.generatedAt,
    view: view === "all" ? "all" : view,
    assignments: selected.map((assignment) => assignmentView(assignment, input.includeAttempts)),
    counts: {
      ready: ready.length,
      blocked: blocked.length,
      completed: completed.length,
      ...(view === "all" ? {
        total: assignments.length,
        corruptLines: state.corruptLines.length,
        partialTail: state.partialTail,
      } : {}),
    },
  };
}

export async function ensureLedgerFileReady(ledgerPath = defaultLedgerPath) {
  await withLedgerLock(ledgerPath, async () => {
    await appendFile(ledgerPath, "", "utf8");
  });
}
