import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const baselineApprovalSchemaVersion = 1;
export const baselineSyncSchemaVersion = 1;
export const baselineApprovalModel = "gpt-5.6-luna";
export const baselineApprovalReasonings = Object.freeze(["xhigh", "max"]);

const signalClasses = new Map([
  ["query-metadata", "queryMetadata"],
  ["request-shape", "requestShapes"],
  ["response-metadata", "responseMetadata"],
  ["response-shape", "responseShapes"],
  ["route", "routes"],
]);
const stableJson = (value) => `${JSON.stringify(value)}\n`;
export const baselineApprovalDigest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
export const baselineSourceArtifactDigest = (value) => baselineApprovalDigest(value);
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const sortedUnique = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right));

function validateSourceArtifact(sourceArtifact) {
  if (!sourceArtifact || typeof sourceArtifact !== "object" || Array.isArray(sourceArtifact)) throw new Error("Baseline synchronization requires a canonical source artifact.");
  if (!Array.isArray(sourceArtifact.evidenceIndex) || sourceArtifact.evidenceIndex.length === 0 || sourceArtifact.evidenceIndex.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Source artifact requires a non-empty immutable evidenceIndex.");
  if (new Set(sourceArtifact.evidenceIndex).size !== sourceArtifact.evidenceIndex.length) throw new Error("Source artifact evidenceIndex must be unique.");
  return { digest: baselineSourceArtifactDigest(sourceArtifact), evidenceIds: new Set(sourceArtifact.evidenceIndex) };
}

export function validateBaselineApproval(approval, { sourceArtifact, specId } = {}) {
  const verifiedSource = validateSourceArtifact(sourceArtifact);
  if (!approval || approval.schemaVersion !== baselineApprovalSchemaVersion) throw new Error("Unsupported baseline approval schema.");
  if (approval.workerModel !== baselineApprovalModel) throw new Error(`Baseline approval requires exact model ${baselineApprovalModel}.`);
  if (!baselineApprovalReasonings.includes(approval.workerReasoning)) throw new Error("Baseline approval reasoning must be xhigh or max.");
  if (approval.decision !== "accept") throw new Error("Only accepted baseline approvals can be synchronized.");
  if (approval.specId !== specId) throw new Error("Baseline approval spec scope changed.");
  if (!signalClasses.has(approval.signalClass)) throw new Error("Baseline approval signalClass is unsupported.");
  if (typeof approval.canonicalSignal !== "string" || !approval.canonicalSignal.trim()) throw new Error("Baseline approval canonicalSignal is required.");
  if (!Array.isArray(approval.evidenceIds) || approval.evidenceIds.length === 0 || approval.evidenceIds.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Baseline approval requires immutable evidenceIds.");
  if (new Set(approval.evidenceIds).size !== approval.evidenceIds.length) throw new Error("Baseline approval evidenceIds must be unique.");
  if (approval.sourceArtifactDigest !== verifiedSource.digest) throw new Error("Baseline approval source artifact is stale or mismatched.");
  if (approval.evidenceIds.some((evidenceId) => !verifiedSource.evidenceIds.has(evidenceId))) throw new Error("Baseline approval references evidence absent from the canonical source artifact.");
  if (approval.health?.complete !== true || approval.health?.available !== true || approval.health?.accountingConsistent !== true) throw new Error("Baseline approval requires terminal complete canonical health.");
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(String(approval.approvedAt || ""))) throw new Error("Baseline approval approvedAt must be an ISO timestamp.");
  if (approval.approvalDigest !== baselineApprovalDigest(without(approval, ["approvalDigest"]))) throw new Error("Baseline approval digest mismatch.");
  return approval;
}

export function compileBaselineSync({ specId, recipe, approvals = [], sourceArtifact } = {}) {
  if (!recipe?.noveltyFrontier?.baselineSignals) throw new Error("Baseline synchronization requires an active noveltyFrontier baselineSignals object.");
  if (!Array.isArray(approvals) || approvals.length === 0) throw new Error("Baseline synchronization requires at least one approval artifact.");
  const verifiedSource = validateSourceArtifact(sourceArtifact);
  const validated = approvals.map((approval) => validateBaselineApproval(approval, { sourceArtifact, specId }));
  const prior = recipe.noveltyFrontier.baselineSignals;
  const nextSignals = Object.fromEntries(["queryMetadata", "requestShapes", "responseMetadata", "responseShapes", "routes"].map((key) => [key, sortedUnique([...(prior[key] ?? []), ...validated.filter((approval) => signalClasses.get(approval.signalClass) === key).map((approval) => approval.canonicalSignal.trim())])]));
  const updatedRecipe = {
    ...recipe,
    noveltyFrontier: {
      ...recipe.noveltyFrontier,
      baselineSignals: nextSignals,
      baselineApprovalDigests: sortedUnique([...(recipe.noveltyFrontier.baselineApprovalDigests ?? []), ...validated.map((approval) => approval.approvalDigest)]),
    },
  };
  const core = {
    schemaVersion: baselineSyncSchemaVersion,
    specId,
    sourceArtifactDigest: verifiedSource.digest,
    approvalDigests: validated.map((approval) => approval.approvalDigest).sort(),
    addedSignals: validated.filter((approval) => !(prior[signalClasses.get(approval.signalClass)] ?? []).includes(approval.canonicalSignal)).map((approval) => ({ signalClass: approval.signalClass, canonicalSignal: approval.canonicalSignal })).sort((left, right) => `${left.signalClass}|${left.canonicalSignal}`.localeCompare(`${right.signalClass}|${right.canonicalSignal}`)),
    updatedRecipe,
  };
  return { ...core, syncDigest: baselineApprovalDigest(core) };
}

export function validateBaselineSync(value) {
  if (!value || value.schemaVersion !== baselineSyncSchemaVersion) throw new Error("Unsupported baseline sync schema.");
  if (value.syncDigest !== baselineApprovalDigest(without(value, ["syncDigest"]))) throw new Error("Baseline sync digest mismatch.");
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, inputPath] = process.argv.slice(2);
  if (command !== "compile" || !inputPath) throw new Error("Use compile <input.json>.");
  const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  if (typeof input.sourceArtifactPath !== "string" || !input.sourceArtifactPath.trim()) throw new Error("CLI input requires sourceArtifactPath so provenance is hashed from disk.");
  const sourceArtifact = JSON.parse(await readFile(path.resolve(path.dirname(path.resolve(inputPath)), input.sourceArtifactPath), "utf8"));
  process.stdout.write(stableJson(compileBaselineSync({ ...input, sourceArtifact, sourceArtifactPath: undefined })));
}
