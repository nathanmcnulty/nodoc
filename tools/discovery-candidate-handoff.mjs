import { sanitizeInteractionHealth } from "./discovery-capture-policy.mjs";

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
  return `${left.hostFamily ?? ""} ${left.method ?? ""} ${left.normalizedPath}`.localeCompare(
    `${right.hostFamily ?? ""} ${right.method ?? ""} ${right.normalizedPath}`,
  );
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

function deriveRecommendedNextAction(counts, metadataNextPass, recovery) {
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
  interactionHealth = null,
  interactionHealthStatus = null,
  metadataNextPass,
  recovery = null,
  specId,
  specTitle,
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

  return {
    schemaVersion: 2,
    spec: {
      id: specId,
      title: specTitle,
    },
    counts,
    interactionHealth: sanitizeInteractionHealth(interactionHealth),
    interactionHealthStatus: interactionHealthStatus ?? {
      available: Boolean(interactionHealth),
      reason: interactionHealth ? null : "canonical-health-unavailable",
      source: interactionHealth ? "summary-and-action-results" : "analysis-artifacts",
    },
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
    recommendedNextAction: deriveRecommendedNextAction(counts, metadataNextPass, recovery),
  };
}
