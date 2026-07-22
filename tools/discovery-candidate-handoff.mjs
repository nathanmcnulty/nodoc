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

function compareCandidates(left, right) {
  return `${left.method ?? ""} ${left.normalizedPath}`.localeCompare(
    `${right.method ?? ""} ${right.normalizedPath}`,
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
    method: candidate.method ? String(candidate.method).toUpperCase() : null,
    normalizedPath,
    documentationStatus,
    evidence,
    featureFamily: candidate.featureFamily
      ? String(candidate.featureFamily)
      : null,
    ...(suppressed
      ? { suppressionNote: candidate.suppressionNote ? String(candidate.suppressionNote) : null }
      : {}),
  };
}

function deriveRecommendedNextAction(counts, metadataNextPass) {
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

  if (counts.bundleOnly > 0) {
    return {
      code: "validate-bundle-only-candidates",
      summary:
        "Run targeted UI validation for the bundle-only candidates before considering promotion.",
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
  metadataNextPass,
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

  const confirmedReadCandidates = [];
  const confirmedSafetyReviewCandidates = [];
  const successfullyProbedCandidates = [];
  const bundleOnlyCandidates = [];

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

  const suppressedCandidates = candidateQueue.suppressedCandidates
    .map((candidate) => sanitizeCandidate(candidate, { suppressed: true }))
    .sort(compareCandidates);
  confirmedReadCandidates.sort(compareCandidates);
  confirmedSafetyReviewCandidates.sort(compareCandidates);
  successfullyProbedCandidates.sort(compareCandidates);
  bundleOnlyCandidates.sort(compareCandidates);

  const counts = {
    confirmedRead: confirmedReadCandidates.length,
    confirmedSafetyReview: confirmedSafetyReviewCandidates.length,
    successfullyProbed: successfullyProbedCandidates.length,
    bundleOnly: bundleOnlyCandidates.length,
    suppressed: suppressedCandidates.length,
  };

  return {
    schemaVersion: 1,
    spec: {
      id: specId,
      title: specTitle,
    },
    counts,
    confirmedReadCandidates,
    confirmedSafetyReviewCandidates,
    successfullyProbedCandidates,
    bundleOnlyCandidates,
    suppressedCandidates,
    recommendedNextAction: deriveRecommendedNextAction(counts, metadataNextPass),
  };
}
