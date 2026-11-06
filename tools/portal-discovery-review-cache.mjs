import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateReviewPacket } from "./portal-discovery-evidence-contract.mjs";

const digest = (value) => createHash("sha256").update(`${JSON.stringify(value)}\n`, "utf8").digest("hex");
const criticalCodes = new Set(["safety-defect", "accounting-defect", "privacy-defect", "schema-defect"]);

function cachePath(cacheDir, cacheKey) {
  if (!/^[a-f0-9]{64}$/u.test(String(cacheKey ?? ""))) throw new Error("review cache key must be SHA-256.");
  return path.join(path.resolve(cacheDir), `${cacheKey}.json`);
}

export async function writeReviewCache({ cacheDir, packet, workerResult }) {
  validateReviewPacket(packet);
  if (workerResult.assignmentId == null || workerResult.assignmentDigest == null) throw new Error("cached review must preserve its original assignment identity.");
  const entry = { schemaVersion: 1, cacheKey: packet.cacheKey, packetDigest: packet.packetDigest, originalReview: workerResult, originalReviewDigest: digest(workerResult) };
  const destination = cachePath(cacheDir, packet.cacheKey);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return entry;
}

export async function loadReviewCache({ cacheDir, packet, currentAssignment }) {
  validateReviewPacket(packet);
  const source = await readFile(cachePath(cacheDir, packet.cacheKey), "utf8");
  const entry = JSON.parse(source);
  if (entry.cacheKey !== packet.cacheKey || entry.packetDigest !== packet.packetDigest || digest(entry.originalReview) !== entry.originalReviewDigest) throw new Error("cached review binding mismatch.");
  const blockers = entry.originalReview.blockers ?? [];
  const criticalBlockers = blockers.filter((blocker) => criticalCodes.has(typeof blocker === "string" ? blocker : blocker?.code));
  return {
    reusable: criticalBlockers.length === 0 && ["accept", "no-action"].includes(entry.originalReview.decision),
    criticalBlockers,
    originalReview: { assignmentId: entry.originalReview.assignmentId, assignmentDigest: entry.originalReview.assignmentDigest, model: entry.originalReview.model, reasoning: entry.originalReview.reasoning, artifactDigest: entry.originalReviewDigest },
    originalWorkerResult: entry.originalReview,
    applicability: { assignmentId: currentAssignment.assignmentId, assignmentDigest: currentAssignment.assignmentDigest, packetDigest: packet.packetDigest },
    reuseRequiresCurrentSolGate: true,
  };
}
