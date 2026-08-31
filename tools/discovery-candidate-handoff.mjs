import { sanitizeInteractionHealth } from "./discovery-capture-policy.mjs";
import { sanitizeDiscoverySaturation } from "./discovery-saturation.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { portalDiscoveryModelPolicy } from "./portal-discovery-model-policy.mjs";
import { validateOperationSummary } from "./portal-discovery-operation-safety.mjs";

const supportedEvidence = new Set([
  "bundle-discovered",
  "confirmed",
  "probed",
]);
const supportedDocumentationStatuses = new Set([
  "documented",
  "path-documented-missing-method",
  "undocumented",
]);
const supportedScopeReasons = new Set([
  "host-and-path-out-of-scope",
  "host-out-of-scope",
  "path-out-of-scope",
]);

function compareCandidates(left, right) {
  return `${left.hostFamily ?? ""} ${left.method ?? ""} ${left.normalizedPath} ${left.candidateId ?? ""}`.localeCompare(
    `${right.hostFamily ?? ""} ${right.method ?? ""} ${right.normalizedPath} ${right.candidateId ?? ""}`,
  );
}

const partitionSchemaVersion = 1;
const partitionClasses = new Set([
  "confirmed-read",
  "safety-review",
  "successfully-probed",
  "bundle-only",
  "suppressed",
  "adjacent-confirmed-read",
  "adjacent-safety-review",
  "adjacent-successfully-probed",
  "adjacent-bundle-only",
]);

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function digest(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function candidateId(candidate, reviewClass) {
  if (typeof candidate.candidateId === "string" && candidate.candidateId.trim()) {
    return candidate.candidateId.trim();
  }
  return `candidate-${digest({
    reviewClass,
    hostFamily: candidate.hostFamily ?? null,
    method: candidate.method ?? null,
    normalizedPath: candidate.normalizedPath,
  }).slice(0, 24)}`;
}

function evidenceFamilyId(candidate) {
  if (typeof candidate.evidenceFamilyId === "string" && candidate.evidenceFamilyId.trim()) {
    return candidate.evidenceFamilyId.trim();
  }
  return `evidence-${digest({
    evidence: candidate.evidence,
    featureFamily: candidate.featureFamily ?? null,
    method: candidate.method ?? null,
    normalizedPath: candidate.normalizedPath,
  }).slice(0, 24)}`;
}

function reviewClassForCandidate(candidate, adjacent = false) {
  const suffix = candidate.evidence === "confirmed"
    ? candidate.method === "GET" ? "confirmed-read" : "safety-review"
    : candidate.evidence === "probed" ? "successfully-probed" : "bundle-only";
  return adjacent ? `adjacent-${suffix}` : suffix;
}

function normalizedHostFamily(candidate, specId) {
  if (candidate.hostFamily) return candidate.hostFamily;
  const baseUrl = candidate.baseUrls?.[0];
  try {
    const hostname = baseUrl ? new URL(baseUrl).hostname.toLowerCase() : "";
    return hostname || `${specId}-default-host`;
  } catch {
    return `${specId}-default-host`;
  }
}

function partitionDestination(candidate, specId, adjacent = false) {
  const hostFamily = normalizedHostFamily(candidate, specId);
  const destinationSpec = adjacent ? "unassigned" : specId;
  return { destinationSpec, hostFamily };
}

function recommendedPolicy() {
  return {
    model: portalDiscoveryModelPolicy.offlineReview.model,
    reasoning: portalDiscoveryModelPolicy.offlineReview.reasoning,
  };
}

function compactCandidate(candidate, reviewClass) {
  const matchingSpecIds = candidate.matchingSpecIds ?? [];
  const adjacent = reviewClass.includes("adjacent");
  return {
    candidateId: candidateId(candidate, reviewClass),
    evidenceFamilyId: evidenceFamilyId(candidate),
    method: candidate.method,
    normalizedPath: candidate.normalizedPath,
    documentationStatus: candidate.documentationStatus,
    evidence: candidate.evidence,
    featureFamily: candidate.featureFamily,
    confidenceScore: candidate.confidenceScore,
    provenance: candidate.provenance,
    reasons: candidate.reasons,
    ...(candidate.operation ? { operation: candidate.operation } : {}),
    sourceCounts: {
      baseUrls: candidate.baseUrls?.length ?? 0,
      provenance: candidate.provenance?.length ?? 0,
      reasons: candidate.reasons?.length ?? 0,
    },
    ...(candidate.suppressionNote !== undefined ? { suppressionNote: candidate.suppressionNote } : {}),
    ...(candidate.hostFamily ? { hostFamily: candidate.hostFamily } : {}),
    ...(candidate.matchingSpecIds ? { matchingSpecIds: candidate.matchingSpecIds } : {}),
    ...(adjacent ? {
      ownershipDisposition: matchingSpecIds.length === 1
        ? {
            status: "suggested-single-match",
            suggestedHostFamily: normalizedHostFamily(candidate, "unassigned"),
            suggestedSpecId: matchingSpecIds[0],
          }
        : {
            status: "explicit-assignment-required",
            suggestedHostFamily: normalizedHostFamily(candidate, "unassigned"),
            suggestedSpecId: null,
          },
    } : {}),
    ...(candidate.scopeReasons ? { scopeReasons: candidate.scopeReasons } : {}),
    ...(candidate.requiresSpecAssignment ? { requiresSpecAssignment: true } : {}),
  };
}

export function buildPartitionedCandidateHandoff(handoff, { outputDir = null } = {}) {
  const groups = new Map();
  const add = (candidate, reviewClass, adjacent = false) => {
    const { destinationSpec, hostFamily } = partitionDestination(candidate, handoff.spec.id, adjacent);
    const key = `${destinationSpec}|${hostFamily}|${reviewClass}`;
    if (!groups.has(key)) groups.set(key, { destinationSpec, hostFamily, reviewClass, candidates: [] });
    groups.get(key).candidates.push(compactCandidate(candidate, reviewClass));
  };
  const lists = [
    [handoff.confirmedReadCandidates, "confirmed-read", false],
    [handoff.confirmedSafetyReviewCandidates, "safety-review", false],
    [handoff.successfullyProbedCandidates, "successfully-probed", false],
    [handoff.bundleOnlyCandidates, "bundle-only", false],
    [handoff.suppressedCandidates, "suppressed", false],
    [handoff.adjacentConfirmedReadCandidates, "adjacent-confirmed-read", true],
    [handoff.adjacentConfirmedSafetyReviewCandidates, "adjacent-safety-review", true],
    [handoff.adjacentSuccessfullyProbedCandidates, "adjacent-successfully-probed", true],
    [handoff.adjacentBundleOnlyCandidates, "adjacent-bundle-only", true],
  ];
  for (const [candidates, reviewClass, adjacent] of lists) {
    for (const candidate of candidates) add(candidate, reviewClass, adjacent);
  }

  const shared = {
    schemaVersion: 1,
    spec: handoff.spec,
    interactionHealth: handoff.interactionHealth,
    interactionHealthStatus: handoff.interactionHealthStatus,
    activeOperations: handoff.activeOperations,
    saturation: handoff.saturation,
    recovery: handoff.recovery,
    graphTelemetry: handoff.graphTelemetry,
    liveGraphqlTelemetry: handoff.liveGraphqlTelemetry ?? null,
    recommendedNextAction: handoff.recommendedNextAction,
  };
  const sharedMetadataId = `shared-${digest(shared).slice(0, 24)}`;
  const sharedMetadataSerialized = stableJson(shared);
  const partitions = Array.from(groups.values()).sort((a, b) =>
    `${a.destinationSpec}|${a.hostFamily}|${a.reviewClass}`.localeCompare(
      `${b.destinationSpec}|${b.hostFamily}|${b.reviewClass}`,
    )).map((group) => {
    group.candidates.sort((a, b) => `${a.normalizedPath}|${a.method ?? ""}|${a.candidateId}`
      .localeCompare(`${b.normalizedPath}|${b.method ?? ""}|${b.candidateId}`));
    const payload = {
      schemaVersion: partitionSchemaVersion,
      sharedMetadataId,
      destination: { specId: group.destinationSpec, hostFamily: group.hostFamily },
      reviewClass: group.reviewClass,
      candidates: group.candidates,
    };
    const serialized = stableJson(payload);
    const recommended = recommendedPolicy();
    return {
      partitionId: `partition-${digest({ destination: payload.destination, reviewClass: payload.reviewClass }).slice(0, 24)}`,
      payload,
      serialized,
      manifest: {
        partitionId: `partition-${digest({ destination: payload.destination, reviewClass: payload.reviewClass }).slice(0, 24)}`,
        destinationSpec: group.destinationSpec,
        hostFamily: group.hostFamily,
        reviewClass: group.reviewClass,
        candidateCount: group.candidates.length,
        evidenceFamilyCount: new Set(group.candidates.map(({ evidenceFamilyId }) => evidenceFamilyId)).size,
        serializedByteCount: Buffer.byteLength(serialized, "utf8"),
        stableDigest: createHash("sha256").update(serialized, "utf8").digest("hex"),
        recommendedModel: recommended.model,
        recommendedReasoning: recommended.reasoning,
        blockers: [
          ...(group.reviewClass.includes("adjacent") ? ["explicit-spec-and-host-assignment-required"] : []),
          ...(handoff.recovery?.captureComplete === false ? ["capture-incomplete"] : []),
          ...(handoff.interactionHealthStatus?.available === false ? ["canonical-health-unavailable"] : []),
        ],
      },
    };
  });
  const manifest = {
    schemaVersion: partitionSchemaVersion,
    sharedMetadataId,
    sharedMetadataDigest: createHash("sha256").update(sharedMetadataSerialized, "utf8").digest("hex"),
    sharedMetadataByteCount: Buffer.byteLength(sharedMetadataSerialized, "utf8"),
    sharedMetadata: shared,
    monolithicSchemaVersion: handoff.schemaVersion,
    partitions: partitions.map(({ manifest: entry }) => entry),
    ownershipReview: {
      ambiguousCount: partitions.flatMap(({ payload }) => payload.candidates)
        .filter((candidate) => candidate.ownershipDisposition?.status === "explicit-assignment-required").length,
      suggestedCount: partitions.flatMap(({ payload }) => payload.candidates)
        .filter((candidate) => candidate.ownershipDisposition?.status === "suggested-single-match").length,
      status: partitions.some(({ payload }) => payload.candidates.some((candidate) => candidate.ownershipDisposition))
        ? "explicit-disposition-required-before-related-capture"
        : "clear",
    },
    totals: {
      candidateCount: partitions.reduce((sum, entry) => sum + entry.manifest.candidateCount, 0),
      evidenceFamilyCount: new Set(partitions.flatMap((entry) => entry.payload.candidates.map(({ evidenceFamilyId }) => evidenceFamilyId))).size,
      partitionPayloadByteCount: partitions.reduce((sum, entry) => sum + entry.manifest.serializedByteCount, 0),
    },
  };
  const result = { manifest, partitions: partitions.map(({ payload }) => payload) };
  if (outputDir) result.outputDir = outputDir;
  return result;
}

export function validatePartitionedCandidateHandoff(handoff, grouped) {
  const expectedShared = {
    schemaVersion: 1,
    spec: handoff.spec,
    interactionHealth: handoff.interactionHealth,
    interactionHealthStatus: handoff.interactionHealthStatus,
    activeOperations: handoff.activeOperations,
    saturation: handoff.saturation,
    recovery: handoff.recovery,
    graphTelemetry: handoff.graphTelemetry,
    liveGraphqlTelemetry: handoff.liveGraphqlTelemetry ?? null,
    recommendedNextAction: handoff.recommendedNextAction,
  };
  if (JSON.stringify(grouped.manifest?.sharedMetadata) !== JSON.stringify(expectedShared)
    || grouped.manifest?.sharedMetadataId !== `shared-${digest(expectedShared).slice(0, 24)}`) {
    throw new Error("Partition reassembly failed: shared metadata does not match the monolithic handoff.");
  }
  if (expectedShared.activeOperations) validateOperationSummary(expectedShared.activeOperations);
  const expected = [];
  for (const [key, candidates] of [
    ["confirmed-read", handoff.confirmedReadCandidates], ["safety-review", handoff.confirmedSafetyReviewCandidates],
    ["successfully-probed", handoff.successfullyProbedCandidates], ["bundle-only", handoff.bundleOnlyCandidates],
    ["suppressed", handoff.suppressedCandidates], ["adjacent-confirmed-read", handoff.adjacentConfirmedReadCandidates],
    ["adjacent-safety-review", handoff.adjacentConfirmedSafetyReviewCandidates],
    ["adjacent-successfully-probed", handoff.adjacentSuccessfullyProbedCandidates],
    ["adjacent-bundle-only", handoff.adjacentBundleOnlyCandidates],
  ]) for (const candidate of candidates) expected.push(candidateId(candidate, key));
  const actual = grouped.partitions.flatMap(({ candidates }) => candidates.map(({ candidateId: id }) => id));
  const unique = new Set(actual);
  if (actual.length !== expected.length || unique.size !== actual.length || [...expected].some((id) => !unique.has(id))) {
    throw new Error("Partition reassembly failed: candidates were duplicated or dropped.");
  }
  return { candidateCount: actual.length, evidenceFamilyCount: new Set(grouped.partitions.flatMap(({ candidates }) => candidates.map(({ evidenceFamilyId }) => evidenceFamilyId))).size };
}

export async function writePartitionedCandidateHandoff(handoff, outputDir) {
  const grouped = buildPartitionedCandidateHandoff(handoff, { outputDir });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "shared-metadata.json"), stableJson(grouped.manifest.sharedMetadata), "utf8");
  for (const partition of grouped.partitions) {
    const entry = grouped.manifest.partitions.find(({ partitionId }) => partitionId === `partition-${digest({ destination: partition.destination, reviewClass: partition.reviewClass }).slice(0, 24)}`);
    await writeFile(path.join(outputDir, `${entry.partitionId}.json`), stableJson(partition), "utf8");
  }
  await writeFile(path.join(outputDir, "manifest.json"), stableJson(grouped.manifest), "utf8");
  return grouped;
}

export async function validatePartitionFiles(outputDir) {
  const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
  const sharedText = await readFile(path.join(outputDir, "shared-metadata.json"), "utf8");
  const sharedDigest = createHash("sha256").update(sharedText, "utf8").digest("hex");
  if (sharedDigest !== manifest.sharedMetadataDigest) {
    throw new Error("Shared metadata digest mismatch.");
  }
  if (Buffer.byteLength(sharedText, "utf8") !== manifest.sharedMetadataByteCount) {
    throw new Error("Shared metadata byte count mismatch.");
  }
  const sharedMetadata = JSON.parse(sharedText);
  if (manifest.sharedMetadataId !== `shared-${digest(sharedMetadata).slice(0, 24)}`
    || JSON.stringify(sharedMetadata) !== JSON.stringify(manifest.sharedMetadata)) {
    throw new Error("Shared metadata identity mismatch.");
  }
  if (sharedMetadata.activeOperations) validateOperationSummary(sharedMetadata.activeOperations);
  const partitions = [];
  for (const entry of manifest.partitions) {
    const text = await readFile(path.join(outputDir, `${entry.partitionId}.json`), "utf8");
    const actualDigest = createHash("sha256").update(text, "utf8").digest("hex");
    if (actualDigest !== entry.stableDigest) {
      throw new Error(`Partition digest mismatch for ${entry.partitionId}.`);
    }
    if (Buffer.byteLength(text, "utf8") !== entry.serializedByteCount) {
      throw new Error(`Partition byte count mismatch for ${entry.partitionId}.`);
    }
    partitions.push(JSON.parse(text));
  }
  const actualCandidateCount = partitions.reduce((sum, partition) => sum + partition.candidates.length, 0);
  if (actualCandidateCount !== manifest.totals.candidateCount) {
    throw new Error("Partition manifest candidate count does not match partition payloads.");
  }
  const actualEvidenceFamilyCount = new Set(
    partitions.flatMap((partition) => partition.candidates.map(({ evidenceFamilyId }) => evidenceFamilyId)),
  ).size;
  if (actualEvidenceFamilyCount !== manifest.totals.evidenceFamilyCount) {
    throw new Error("Partition manifest evidence-family count does not match partition payloads.");
  }
  if (partitions.some((partition) => partition.sharedMetadataId !== manifest.sharedMetadataId)) {
    throw new Error("Partition shared metadata reference mismatch.");
  }
  return { candidateCount: actualCandidateCount, evidenceFamilyCount: actualEvidenceFamilyCount };
}

function sanitizeCandidate(candidate, { suppressed = false } = {}) {
  const normalizedPath = String(candidate?.normalizedPath || "");
  const evidence = String(candidate?.evidence || "");
  const documentationStatus = String(candidate?.documentationStatus || "");
  if (!normalizedPath.startsWith("/")) {
    throw new Error("Candidate handoff entries require a normalized path.");
  }
  if (!supportedEvidence.has(evidence)) {
    throw new Error(`Unsupported candidate evidence "${evidence}".`);
  }
  if (!supportedDocumentationStatuses.has(documentationStatus)) {
    throw new Error(`Unsupported candidate documentation status "${documentationStatus}".`);
  }

  return {
    baseUrls: Array.isArray(candidate.baseUrls)
      ? candidate.baseUrls.map((value) => String(value || "").trim()).filter(Boolean).sort()
      : [],
    confidenceScore: Number.isFinite(candidate.confidenceScore) ? candidate.confidenceScore : null,
    method: candidate.method ? String(candidate.method).toUpperCase() : null,
    normalizedPath,
    documentationStatus,
    evidence,
    featureFamily: candidate.featureFamily
      ? String(candidate.featureFamily)
      : null,
    operation: candidate.operation && typeof candidate.operation === "object"
      ? {
        name: candidate.operation.name ? String(candidate.operation.name) : null,
        operationType: candidate.operation.operationType ? String(candidate.operation.operationType) : null,
        persistedQueryHash: candidate.operation.persistedQueryHash
          ? String(candidate.operation.persistedQueryHash).toLowerCase()
          : null,
      }
      : null,
    provenance: Array.isArray(candidate.provenances)
      ? candidate.provenances.map((value) => String(value || "").trim()).filter(Boolean).sort()
      : [],
    reasons: Array.isArray(candidate.reasons)
      ? candidate.reasons.map((value) => String(value || "").trim()).filter(Boolean).sort()
      : [],
    ...(suppressed
      ? { suppressionNote: candidate.suppressionNote ? String(candidate.suppressionNote) : null }
      : {}),
  };
}

function sanitizeScopeReviewCandidate(candidate) {
  const sanitized = sanitizeCandidate(candidate);
  const hostFamily = String(candidate?.hostFamily || "").trim().toLowerCase();
  const matchingSpecIds = Array.isArray(candidate?.matchingSpecIds)
    ? candidate.matchingSpecIds
        .map((specId) => String(specId || "").trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
    : [];
  const scopeReasons = Array.isArray(candidate?.scopeReasons)
    ? candidate.scopeReasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
    : [];
  if (!hostFamily) {
    throw new Error("Scope-review candidates require a sanitized host family.");
  }
  if (
    scopeReasons.length === 0
    || scopeReasons.some((reason) => !supportedScopeReasons.has(reason))
  ) {
    throw new Error("Scope-review candidates require supported scope reasons.");
  }
  if (candidate?.requiresSpecAssignment !== true) {
    throw new Error("Scope-review candidates must require explicit spec assignment.");
  }

  return {
    ...sanitized,
    hostFamily,
    matchingSpecIds: Array.from(new Set(matchingSpecIds)),
    requiresSpecAssignment: true,
    scopeReasons: Array.from(new Set(scopeReasons)),
  };
}

function sanitizeMutationSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    schemaVersion: summary.schemaVersion ?? 1,
    attemptCount: Number(summary.attemptCount ?? 0),
    byState: Object.fromEntries(
      Object.entries(summary.byState ?? {}).map(([key, value]) => [key, Number(value ?? 0)]),
    ),
    unresolvedOperationIds: (summary.unresolvedOperationIds ?? []).map(String).sort(),
    safeToContinue: summary.safeToContinue === true,
    receipts: (summary.receipts ?? []).map((receipt) => ({
      schemaVersion: receipt.schemaVersion ?? 1,
      operationId: String(receipt.operationId || ""),
      mode: String(receipt.mode || ""),
      approvalDigest: String(receipt.approvalDigest || ""),
      executionState: String(receipt.executionState || ""),
      unresolvedReason: receipt.unresolvedReason == null ? null : String(receipt.unresolvedReason),
      accounting: receipt.accounting ?? null,
    })),
  };
}

function sanitizeLiveGraphqlTelemetry(operations) {
  if (!Array.isArray(operations) || operations.length === 0) return null;
  const sanitized = operations.map((operation) => ({
    name: String(operation.name || ""),
    operationType: ["query", "mutation", "subscription"].includes(operation.operationType)
      ? operation.operationType
      : null,
    bundleCorroborated: operation.bundleCorroborated === true,
    writeLike: operation.writeLike === true,
    writeLikeSignals: (operation.writeLikeSignals ?? []).map(String).sort(),
    observedRecordCount: Number(operation.observedRecordCount ?? 0),
    statuses: (operation.statuses ?? []).map(Number).filter(Number.isInteger).sort((a, b) => a - b),
    mimeTypes: (operation.mimeTypes ?? []).map(String).sort(),
    variableNames: (operation.variableNames ?? []).map(String).sort(),
    responseFieldPaths: (operation.responseFieldPaths ?? []).map(String).sort(),
    seenOnPages: (operation.seenOnPages ?? []).map(String).sort(),
  })).sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: 1,
    operationCount: sanitized.length,
    mutationCount: sanitized.filter(({ operationType }) => operationType === "mutation").length,
    writeLikeCount: sanitized.filter(({ writeLike }) => writeLike).length,
    unknownTypeCount: sanitized.filter(({ operationType }) => operationType == null).length,
    operations: sanitized,
  };
}

function deriveRecommendedNextAction(counts, metadataNextPass, recovery, mutationSummary) {
  if (mutationSummary?.safeToContinue === false) {
    return {
      code: "resolve-unresolved-active-operation",
      operationIds: mutationSummary.unresolvedOperationIds,
      summary:
        "Stop live discovery and resolve the active-operation receipt before another browser lifecycle.",
    };
  }
  if (recovery?.captureStatus !== "complete") {
    return {
      code: recovery?.captureStatus === "authentication-blocked"
        ? "authenticate-and-retry-capture"
        : ["corrupted-minimum-artifacts", "missing-minimum-artifacts"].includes(recovery?.captureStatus)
          ? "repair-minimum-artifacts-and-retry-capture"
          : "complete-or-retry-capture",
      summary: recovery?.captureStatus === "authentication-blocked"
        ? "Authenticate the dedicated browser session and retry capture before treating any candidates as promotion-ready."
        : ["corrupted-minimum-artifacts", "missing-minimum-artifacts"].includes(recovery?.captureStatus)
          ? "Repair or regenerate the corrupted minimum capture artifacts and retry capture before promotion review."
          : "Complete or retry the interrupted capture before treating any candidates as promotion-ready.",
    };
  }

  if (counts.confirmedRead > 0) {
    return {
      code: "review-and-promote-confirmed-candidates",
      summary:
        "Review the confirmed read candidates and promote supported operations in a separate specification PR.",
    };
  }

  if (counts.confirmedSafetyReview > 0) {
    return {
      code: "classify-confirmed-candidate-safety",
      summary:
        "Classify the confirmed non-GET or method-ambiguous candidates before any specification promotion.",
    };
  }

  if (counts.successfullyProbed > 0) {
    return {
      code: "review-probed-candidates",
      summary:
        "Review the successfully probed candidates for evidence-backed specification promotion.",
    };
  }

  if (
    counts.adjacentConfirmedRead > 0
    || counts.adjacentConfirmedSafetyReview > 0
    || counts.adjacentSuccessfullyProbed > 0
  ) {
    return {
      code: "review-adjacent-candidate-scope",
      summary:
        "Assign the adjacent confirmed or probed candidates to the correct specification and host family before any promotion review.",
    };
  }

  if (counts.bundleOnly > 0) {
    return {
      code: "validate-bundle-only-candidates",
      summary:
        "Run targeted UI validation for the bundle-only candidates before considering promotion.",
    };
  }

  if (counts.adjacentBundleOnly > 0) {
    return {
      code: "review-adjacent-bundle-scope",
      summary:
        "Assign the adjacent bundle-only candidates to the correct specification and host family before targeted validation.",
    };
  }

  if (
    metadataNextPass
    && metadataNextPass !== "unknown"
    && metadataNextPass !== "normalized-family-diff"
  ) {
    return {
      code: "follow-portal-metadata",
      metadataNextPass,
      summary:
        `No actionable candidates were generated; follow the portal metadata next pass: ${metadataNextPass}.`,
    };
  }

  return {
    code: "expand-recipe-coverage",
    summary:
      "No actionable candidates were generated; expand the checked-in recipe or coverage inputs before another run.",
  };
}

export function buildCandidateHandoff({
  candidateQueue,
  graphTelemetry = null,
  graphTelemetryAssessment = null,
  graphResearchQueue = null,
  interactionHealth = null,
  interactionHealthStatus = null,
  metadataNextPass,
  mutationSummary = null,
  recovery = null,
  specId,
  specTitle,
  saturation = null,
}) {
  if (!String(specId || "").trim() || !String(specTitle || "").trim()) {
    throw new Error("Candidate handoff generation requires spec identity.");
  }
  if (!Array.isArray(candidateQueue?.candidates)) {
    throw new Error("Candidate handoff generation requires candidateQueue.candidates.");
  }
  if (!Array.isArray(candidateQueue?.suppressedCandidates)) {
    throw new Error("Candidate handoff generation requires candidateQueue.suppressedCandidates.");
  }
  if (!Array.isArray(candidateQueue?.scopeReviewCandidates)) {
    throw new Error("Candidate handoff generation requires candidateQueue.scopeReviewCandidates.");
  }

  const confirmedReadCandidates = [];
  const confirmedSafetyReviewCandidates = [];
  const successfullyProbedCandidates = [];
  const bundleOnlyCandidates = [];
  const adjacentConfirmedReadCandidates = [];
  const adjacentConfirmedSafetyReviewCandidates = [];
  const adjacentSuccessfullyProbedCandidates = [];
  const adjacentBundleOnlyCandidates = [];

  for (const candidate of candidateQueue.candidates) {
    const sanitized = sanitizeCandidate(candidate);
    if (sanitized.evidence === "confirmed") {
      if (sanitized.method === "GET") {
        confirmedReadCandidates.push(sanitized);
      } else {
        confirmedSafetyReviewCandidates.push(sanitized);
      }
    } else if (sanitized.evidence === "probed") {
      successfullyProbedCandidates.push(sanitized);
    } else {
      bundleOnlyCandidates.push(sanitized);
    }
  }

  for (const candidate of candidateQueue.scopeReviewCandidates) {
    const sanitized = sanitizeScopeReviewCandidate(candidate);
    if (sanitized.evidence === "confirmed") {
      if (sanitized.method === "GET") {
        adjacentConfirmedReadCandidates.push(sanitized);
      } else {
        adjacentConfirmedSafetyReviewCandidates.push(sanitized);
      }
    } else if (sanitized.evidence === "probed") {
      adjacentSuccessfullyProbedCandidates.push(sanitized);
    } else {
      adjacentBundleOnlyCandidates.push(sanitized);
    }
  }

  const suppressedCandidates = candidateQueue.suppressedCandidates
    .map((candidate) => sanitizeCandidate(candidate, { suppressed: true }))
    .sort(compareCandidates);
  confirmedReadCandidates.sort(compareCandidates);
  confirmedSafetyReviewCandidates.sort(compareCandidates);
  successfullyProbedCandidates.sort(compareCandidates);
  bundleOnlyCandidates.sort(compareCandidates);
  adjacentConfirmedReadCandidates.sort(compareCandidates);
  adjacentConfirmedSafetyReviewCandidates.sort(compareCandidates);
  adjacentSuccessfullyProbedCandidates.sort(compareCandidates);
  adjacentBundleOnlyCandidates.sort(compareCandidates);

  const counts = {
    adjacentBundleOnly: adjacentBundleOnlyCandidates.length,
    adjacentConfirmedRead: adjacentConfirmedReadCandidates.length,
    adjacentConfirmedSafetyReview: adjacentConfirmedSafetyReviewCandidates.length,
    adjacentSuccessfullyProbed: adjacentSuccessfullyProbedCandidates.length,
    confirmedRead: confirmedReadCandidates.length,
    confirmedSafetyReview: confirmedSafetyReviewCandidates.length,
    successfullyProbed: successfullyProbedCandidates.length,
    bundleOnly: bundleOnlyCandidates.length,
    suppressed: suppressedCandidates.length,
  };
  const activeOperations = sanitizeMutationSummary(mutationSummary);
  const graphTelemetrySummary = graphTelemetry ? {
    artifact: "graph-telemetry.json",
    assessment: graphTelemetryAssessment,
    contractSnapshot: graphTelemetry.contractSnapshot ?? null,
    contractVersions: graphTelemetry.contractVersions ?? [],
    measurements: graphTelemetry.measurements,
    telemetryDigest: graphTelemetry.telemetryDigest,
    telemetryId: graphTelemetry.telemetryId,
    researchQueue: graphResearchQueue ? {
      artifact: "graph-research-queue.json",
      batchIssueCount: graphResearchQueue.batchIssues.length,
      documentedEnrichmentCount: graphResearchQueue.documentedEnrichment.length,
      errorOperationCount: graphResearchQueue.errorOperations.length,
      queueDigest: graphResearchQueue.queueDigest,
      undocumentedCandidateCount: graphResearchQueue.undocumentedCandidates.length,
    } : null,
  } : null;
  const liveGraphqlTelemetry = sanitizeLiveGraphqlTelemetry(candidateQueue.liveGraphqlOperations);

  return {
    schemaVersion: 2,
    spec: {
      id: specId,
      title: specTitle,
    },
    counts,
    graphTelemetry: graphTelemetrySummary,
    liveGraphqlTelemetry,
    interactionHealth: sanitizeInteractionHealth(interactionHealth),
    interactionHealthStatus: interactionHealthStatus ?? {
      available: Boolean(interactionHealth),
      reason: interactionHealth ? null : "canonical-health-unavailable",
      source: interactionHealth ? "summary-and-action-results" : "analysis-artifacts",
    },
    activeOperations,
    saturation: sanitizeDiscoverySaturation(saturation),
    recovery,
    adjacentConfirmedReadCandidates,
    adjacentConfirmedSafetyReviewCandidates,
    adjacentSuccessfullyProbedCandidates,
    adjacentBundleOnlyCandidates,
    confirmedReadCandidates,
    confirmedSafetyReviewCandidates,
    successfullyProbedCandidates,
    bundleOnlyCandidates,
    suppressedCandidates,
    recommendedNextAction: deriveRecommendedNextAction(
      counts,
      metadataNextPass,
      recovery,
      activeOperations,
    ),
  };
}
