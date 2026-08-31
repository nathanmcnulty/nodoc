export const passiveOperationReceiptSchemaVersion = 1;

const ignoredMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const sideEffectPattern = /(?:^|[^a-z0-9])(activate|add|assign|create|delete|disable|enable|provision|purchase|remove|save|set|start|submit|trial|update)(?:$|[^a-z0-9])/iu;
const readLikePattern = /(?:^|[^a-z0-9])(calculate|check|count|estimate|fetch|get|list|query|report|search|status|validate)(?:$|[^a-z0-9])/iu;

function normalizedUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return {
      origin: parsed.origin,
      path: parsed.pathname,
      queryParameterNames: Array.from(new Set(parsed.searchParams.keys())).sort(),
    };
  } catch {
    return {
      origin: null,
      path: String(value || ""),
      queryParameterNames: [],
    };
  }
}

function bodyHint(request) {
  const body = String(request?.requestBody || "").slice(0, 8192);
  return `${request?.url || ""} ${body}`;
}

function classifySemantics(request) {
  const method = String(request?.method || "").toUpperCase();
  if (["DELETE", "PATCH", "PUT"].includes(method)) return "potential-side-effect";
  const hint = bodyHint(request);
  if (sideEffectPattern.test(hint)) return "potential-side-effect";
  if (readLikePattern.test(hint)) return "likely-read-like";
  return "unknown";
}

function receiptEvidenceIds(receipts = []) {
  const ids = new Map();
  for (const receipt of receipts ?? []) {
    for (const evidence of Object.values(receipt?.evidence ?? {})) {
      if (evidence?.evidenceId) ids.set(evidence.evidenceId, receipt);
    }
  }
  return ids;
}

function sameContext(left, right) {
  return left?.attribution?.actionIndex === right?.attribution?.actionIndex
    && (left?.attribution?.sessionId ?? "root") === (right?.attribution?.sessionId ?? "root")
    && (left?.attribution?.targetId ?? null) === (right?.attribution?.targetId ?? null);
}

function adjacentReadIds(requests, operation, direction) {
  return requests
    .filter((candidate) => String(candidate?.method || "").toUpperCase() === "GET")
    .filter((candidate) => sameContext(candidate, operation))
    .filter((candidate) => direction === "before"
      ? Number(candidate?.startedAt ?? 0) < Number(operation?.startedAt ?? 0)
      : Number(candidate?.startedAt ?? 0) > Number(operation?.startedAt ?? 0))
    .sort((left, right) => direction === "before"
      ? Number(right?.startedAt ?? 0) - Number(left?.startedAt ?? 0)
      : Number(left?.startedAt ?? 0) - Number(right?.startedAt ?? 0))
    .slice(0, 5)
    .map((candidate) => candidate.evidenceId)
    .filter(Boolean);
}

function actionTrigger(actionResults, operation) {
  const actionIndex = operation?.attribution?.actionIndex;
  const action = Number.isInteger(actionIndex) ? actionResults?.[actionIndex] : null;
  const actionType = action?.type ?? null;
  return {
    actionIndex: Number.isInteger(actionIndex) ? actionIndex : null,
    actionType,
    checkpoint: operation?.attribution?.checkpoint ?? operation?.pageLabel ?? null,
    initiation: actionType?.startsWith("click")
      ? "runner-ui-action"
      : ["navigate", "reload"].includes(actionType)
        ? "portal-hydration"
        : "passive-or-unattributed",
    sessionId: operation?.attribution?.sessionId ?? operation?.sessionId ?? "root",
    targetId: operation?.attribution?.targetId ?? operation?.targetId ?? null,
  };
}

function summarize(operations) {
  return {
    count: operations.length,
    likelyReadLikeCount: operations.filter((entry) => entry.safety.semantics === "likely-read-like").length,
    potentialSideEffectCount: operations.filter((entry) => entry.safety.semantics === "potential-side-effect").length,
    safetyReviewCount: operations.filter((entry) => entry.safety.requiresSafetyReview).length,
    successfulUnverifiedCount: operations.filter((entry) => (
      entry.safety.successfulResponse
      && entry.safety.verification === "unverified"
      && entry.safety.semantics !== "likely-read-like"
    )).length,
    unknownCount: operations.filter((entry) => entry.safety.semantics === "unknown").length,
  };
}

export function validatePassiveOperationReceiptArtifact(artifact, expectedSummary = null) {
  if (artifact?.schemaVersion !== passiveOperationReceiptSchemaVersion || !Array.isArray(artifact.operations)) {
    throw new Error("passive-operation-receipts.json schema is unsupported.");
  }
  for (const operation of artifact.operations) {
    if (!operation?.evidenceId || !operation?.method || !operation?.path || !operation?.safety) {
      throw new Error("passive-operation-receipts.json contains an incomplete operation.");
    }
    if (ignoredMethods.has(String(operation.method).toUpperCase())) {
      throw new Error("passive-operation-receipts.json must contain only non-GET/HEAD/OPTIONS operations.");
    }
  }
  const actualSummary = summarize(artifact.operations);
  if (JSON.stringify(artifact.summary) !== JSON.stringify(actualSummary)) {
    throw new Error("passive-operation-receipts.json summary does not match its operations.");
  }
  if (expectedSummary && JSON.stringify(expectedSummary) !== JSON.stringify(actualSummary)) {
    throw new Error("summary.json passive operation summary does not match passive-operation-receipts.json.");
  }
  return actualSummary;
}

export function buildPassiveOperationReceipts({
  actionResults = [],
  operationReceipts = [],
  requests = [],
} = {}) {
  const plannedEvidence = receiptEvidenceIds(operationReceipts);
  const operations = (requests ?? [])
    .filter((request) => !ignoredMethods.has(String(request?.method || "").toUpperCase()))
    .map((request) => {
      const method = String(request.method || "").toUpperCase();
      const url = normalizedUrl(request.url);
      const plannedReceipt = plannedEvidence.get(request.evidenceId) ?? null;
      const semantics = classifySemantics(request);
      const beforeReadEvidenceIds = adjacentReadIds(requests, request, "before");
      const afterReadEvidenceIds = adjacentReadIds(requests, request, "after");
      const sent = request.abortedBeforeSend !== true;
      const responseObserved = Number.isFinite(request.status) || Boolean(request.failureText);
      const successfulResponse = Number(request.status) >= 200 && Number(request.status) < 300;
      return {
        schemaVersion: passiveOperationReceiptSchemaVersion,
        evidenceId: request.evidenceId ?? null,
        operationKey: `${method} ${url.path}`,
        method,
        origin: url.origin,
        path: url.path,
        queryParameterNames: url.queryParameterNames,
        source: plannedReceipt ? "planned-active-operation" : "passive-browser-traffic",
        trigger: actionTrigger(actionResults, request),
        request: {
          shapeFingerprint: request.requestShapeFingerprint ?? null,
          shapeSummary: request.requestShapeSummary ?? null,
        },
        response: {
          failureText: request.failureText ?? null,
          mimeType: request.mimeType ?? null,
          observed: responseObserved,
          shapeFingerprint: request.responseShapeFingerprint ?? null,
          shapeSummary: request.responseShapeSummary ?? null,
          status: request.status ?? null,
        },
        safety: {
          semantics,
          sent,
          successfulResponse,
          verification: plannedReceipt?.executionState
            ?? (sent ? "unverified" : "aborted-before-send"),
          requiresSafetyReview: !plannedReceipt && sent && semantics !== "likely-read-like",
        },
        contextReads: {
          afterEvidenceIds: afterReadEvidenceIds,
          beforeEvidenceIds: beforeReadEvidenceIds,
          coverage: beforeReadEvidenceIds.length > 0 && afterReadEvidenceIds.length > 0
            ? "before-and-after-observed"
            : beforeReadEvidenceIds.length > 0
              ? "before-only"
              : afterReadEvidenceIds.length > 0
                ? "after-only"
                : "none",
          caveat: "Context reads are temporal references in the same action/session/target, not proof that they verify the changed resource.",
        },
      };
    });

  return {
    schemaVersion: passiveOperationReceiptSchemaVersion,
    operations,
    summary: summarize(operations),
  };
}
