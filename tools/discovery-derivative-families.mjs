import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const derivativeFamilySchemaVersion = 1;
export const derivativeFamilyIndexSchemaVersion = 1;

const stableJson = (value) => `${JSON.stringify(value)}\n`;
const digest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

function familyKey(candidate, partition) {
  return {
    schemaVersion: derivativeFamilySchemaVersion,
    method: normalized(candidate.method),
    destinationSpec: normalized(partition.destination?.specId),
    hostFamily: normalized(candidate.hostFamily ?? partition.hostFamily),
    routeTemplate: normalized(candidate.routeTemplate ?? candidate.normalizedPath),
    queryKeyShape: Array.isArray(candidate.queryKeyShape)
      ? [...new Set(candidate.queryKeyShape.map(normalized).filter(Boolean))].sort()
      : [],
    responseShapeFingerprint: normalized(candidate.responseShapeFingerprint ?? candidate.responseSchemaFingerprint),
    operation: candidate.operation && typeof candidate.operation === "object"
      ? {
        operationType: normalized(candidate.operation.operationType),
        name: normalized(candidate.operation.name),
        persistedQueryHash: normalized(candidate.operation.persistedQueryHash),
      }
      : null,
    reviewClass: normalized(partition.reviewClass),
    safetyClass: normalized(candidate.safetyClass ?? (partition.reviewClass?.includes("safety") ? "safety-review" : "read-only")),
    scopeFlags: Array.isArray(candidate.scopeFlags)
      ? [...new Set(candidate.scopeFlags.map(normalized).filter(Boolean))].sort()
      : [partition.reviewClass?.includes("adjacent") ? "adjacent" : "in-scope"],
  };
}

function candidateRefs(grouped) {
  return grouped.partitions.flatMap((partition) => partition.candidates.map((candidate) => ({
    candidate,
    partition,
  })));
}

export function buildDerivativeFamilyIndex(grouped) {
  if (!grouped?.manifest || !Array.isArray(grouped.partitions)) throw new Error("A grouped handoff is required.");
  const families = new Map();
  const candidateFamilyRefs = [];
  const evidenceFamilyRefs = [];
  for (const { candidate, partition } of candidateRefs(grouped)) {
    const key = familyKey(candidate, partition);
    const familyId = `family-${digest(key).slice(0, 24)}`;
    if (!families.has(familyId)) families.set(familyId, {
      familyId,
      key,
      candidateIds: [],
      evidenceFamilyIds: [],
      reviewContext: {
        destinationSpec: partition.destination?.specId ?? null,
        hostFamily: normalized(partition.destination?.hostFamily),
        reviewClass: partition.reviewClass,
      },
    });
    const family = families.get(familyId);
    family.candidateIds.push(candidate.candidateId);
    family.evidenceFamilyIds.push(candidate.evidenceFamilyId);
    candidateFamilyRefs.push({ candidateId: candidate.candidateId, familyId });
    evidenceFamilyRefs.push({ evidenceFamilyId: candidate.evidenceFamilyId, familyId });
  }
  const uniqueSorted = (values) => [...new Set(values)].sort();
  for (const family of families.values()) {
    family.candidateIds = uniqueSorted(family.candidateIds);
    family.evidenceFamilyIds = uniqueSorted(family.evidenceFamilyIds);
  }
  const familyEntries = [...families.values()].sort((a, b) => a.familyId.localeCompare(b.familyId));
  const result = {
    schemaVersion: derivativeFamilyIndexSchemaVersion,
    familySchemaVersion: derivativeFamilySchemaVersion,
    sourceManifestDigest: digest(grouped.manifest),
    families: familyEntries,
    candidateFamilyRefs: candidateFamilyRefs.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    evidenceFamilyRefs: evidenceFamilyRefs.sort((a, b) => a.evidenceFamilyId.localeCompare(b.evidenceFamilyId)),
    totals: {
      candidateCount: candidateFamilyRefs.length,
      evidenceReferenceCount: evidenceFamilyRefs.length,
      uniqueFamilyCount: familyEntries.length,
      repeatedFamilyReferenceCount: candidateFamilyRefs.length - familyEntries.length,
    },
  };
  return { ...result, digest: digest(result) };
}

function compatibleReview(previous, family, current) {
  if (!previous || previous.outcome !== "approved") return ["changed"];
  if (previous.destinationSpec !== family.reviewContext.destinationSpec) return ["incompatible-destination"];
  if (previous.hostFamily !== family.reviewContext.hostFamily) return ["incompatible-destination"];
  if (previous.safetyClass !== family.key.safetyClass) return ["incompatible-safety"];
  if (previous.captureHealthFingerprint !== current.captureHealthFingerprint) return ["incomplete-health"];
  if (previous.analyzerVersion !== current.analyzerVersion || previous.schemaVersion !== current.schemaVersion) return ["version-mismatch"];
  if (previous.provenanceFingerprint !== current.provenanceFingerprint) return ["missing-provenance"];
  if (family.key.scopeFlags.includes("adjacent")) return ["ambiguous-scope"];
  return ["reusable"];
}

export function recommendDerivativeReuse(currentIndex, previousIndex, reviewMetadata = {}) {
  if (currentIndex?.schemaVersion !== derivativeFamilyIndexSchemaVersion) throw new Error("Incompatible current derivative family index.");
  if (previousIndex?.schemaVersion !== derivativeFamilyIndexSchemaVersion) return currentIndex.families.map((family) => ({ familyId: family.familyId, decision: "blocked", reasonCodes: ["version-mismatch"] }));
  const previous = new Map(previousIndex.families.map((family) => [family.familyId, family.review]));
  return currentIndex.families.map((family) => {
    const reasonCodes = compatibleReview(previous.get(family.familyId), family, reviewMetadata);
    return { familyId: family.familyId, decision: reasonCodes[0] === "reusable" ? "reusable" : "review", reasonCodes };
  });
}

export function attachDerivativeReviews(index, reviews) {
  const byId = new Map(reviews.map((review) => [review.familyId, review]));
  const result = { ...index, families: index.families.map((family) => ({ ...family, review: byId.get(family.familyId) ?? null })) };
  return { ...result, digest: digest(result) };
}

export async function writeDerivativeFamilyIndex(index, filePath) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, stableJson(index), { encoding: "utf8", flag: "wx" });
  await rename(temporary, filePath);
  return filePath;
}

export async function readDerivativeFamilyIndex(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed.schemaVersion !== derivativeFamilyIndexSchemaVersion || parsed.digest !== digest({ ...parsed, digest: undefined })) {
      return { status: "miss", reasonCodes: ["corrupt-or-incompatible-index"] };
    }
    return { status: "ok", index: parsed };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "miss", reasonCodes: ["index-missing"] };
    return { status: "blocked", reasonCodes: ["corrupt-or-incompatible-index"] };
  }
}

export function measureDerivativeCompaction(grouped, index) {
  const baseline = Buffer.byteLength(stableJson(grouped.partitions), "utf8");
  const compacted = Buffer.byteLength(stableJson({ families: index.families, candidateFamilyRefs: index.candidateFamilyRefs, evidenceFamilyRefs: index.evidenceFamilyRefs }), "utf8");
  return { baselineReviewBytes: baseline, compactedReviewBytes: compacted, bytesCompacted: Math.max(0, baseline - compacted), uniqueFamilyCount: index.totals.uniqueFamilyCount, repeatedFamilyReferenceCount: index.totals.repeatedFamilyReferenceCount, candidatesPreserved: index.totals.candidateCount, evidenceReferencesPreserved: index.totals.evidenceReferenceCount, maxWorkerPayloadBytes: Math.max(0, ...grouped.partitions.map((partition) => Buffer.byteLength(stableJson(partition), "utf8"))) };
}
