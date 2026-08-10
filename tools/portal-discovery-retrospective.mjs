import { createHash } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const retrospectiveSchemaVersion = 1;
export const modelUsageSchemaVersion = 1;
export const improvementQueueSchemaVersion = 1;

const classes = new Set([
  "recurring-deterministic-failure", "documentation-process-mismatch", "recipe-weakness",
  "analyzer-blind-spot", "model-disagreement", "operational-incident",
  "schema-ownership-ambiguity", "ci-workflow-gap", "benchmark-candidate",
]);
const states = new Set(["proposed", "observe", "approved", "rejected", "blocked"]);
const routes = new Set(["cheap", "luna", "manual", "orchestrator"]);
const unsafe = /\btenant\b|\bbearer\b|\bcookie\b|\bauthorization\b|\bpassword\b|\bsecret\b|\bcredential\b|\bprompt\s*text\b|https?:\/\/|[A-Za-z]:\\|[A-Za-z]:\//iu;
const stableJson = (value) => `${JSON.stringify(value)}\n`;
export const retrospectiveDigest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const sorted = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const clean = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(clean);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, clean(entry)]));
  return null;
};
const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
};
const nonNegative = (value, label) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  return value;
};
const optionalCount = (value, label) => value === undefined || value === null ? null : nonNegative(value, label);
const available = (value) => value !== null && value !== undefined;
const sourceDigest = (entry, label) => {
  if (!entry || typeof entry !== "object") throw new Error(`${label} must be a structured source.`);
  required(entry.sourceId, `${label}.sourceId`);
  required(entry.digest, `${label}.digest`);
  return { sourceId: entry.sourceId, digest: entry.digest, schemaVersion: entry.schemaVersion ?? null };
};

export function assertRetrospectiveSafe(value, label = "input") {
  if (unsafe.test(JSON.stringify(value))) throw new Error(`${label} contains tenant, auth, raw URL, prompt, or absolute-path data.`);
}

function sourceList(input) {
  const sources = input.sources ?? {};
  return Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([kind, entry]) => ({ kind, ...sourceDigest(entry, `sources.${kind}`) }));
}

function assignmentIndex(input) {
  const assignments = input.reviewAssignments?.assignments ?? input.assignments ?? [];
  if (!Array.isArray(assignments)) throw new Error("assignments must be an array.");
  const ids = new Map();
  for (const assignment of assignments) {
    const id = required(assignment.assignmentId, "assignmentId");
    if (ids.has(id)) throw new Error(`Duplicate assignment ${id}.`);
    ids.set(id, assignment.assignmentDigest ?? null);
  }
  return ids;
}

function validateTelemetry(records, assignments) {
  if (records === undefined) return [];
  if (!Array.isArray(records)) throw new Error("modelUsage.records must be an array.");
  const seen = new Set();
  return records.map((record, index) => {
    const telemetryId = required(record.telemetryId, `modelUsage.records[${index}].telemetryId`);
    if (seen.has(telemetryId)) throw new Error(`Duplicate telemetry ${telemetryId}.`);
    seen.add(telemetryId);
    const assignmentId = required(record.assignmentId, `${telemetryId}.assignmentId`);
    if (!assignments.has(assignmentId)) throw new Error(`Unknown telemetry assignment ${assignmentId}.`);
    if (record.assignmentDigest !== assignments.get(assignmentId)) throw new Error(`Telemetry assignment digest mismatch for ${telemetryId}.`);
    const kind = record.kind ?? (record.actual ? "actual" : "estimate");
    if (!new Set(["actual", "estimate"]).has(kind)) throw new Error(`Telemetry ${telemetryId} kind is invalid.`);
    required(record.modelId, `${telemetryId}.modelId`);
    if (kind === "actual") {
      required(record.provider, `${telemetryId}.provider`);
      required(record.source, `${telemetryId}.source`);
      for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "reasoningTokens"]) optionalCount(record[key], `${telemetryId}.${key}`);
    } else {
      required(record.tokenizer, `${telemetryId}.tokenizer`);
      required(record.tokenizerVersion, `${telemetryId}.tokenizerVersion`);
      optionalCount(record.serializedPromptBytes, `${telemetryId}.serializedPromptBytes`);
      optionalCount(record.serializedContextBytes, `${telemetryId}.serializedContextBytes`);
      optionalCount(record.estimatedInputTokens, `${telemetryId}.estimatedInputTokens`);
      optionalCount(record.estimatedOutputTokens, `${telemetryId}.estimatedOutputTokens`);
      if (record.confidence !== undefined) required(record.confidence, `${telemetryId}.confidence`);
    }
    return clean({ ...record, kind });
  }).sort((a, b) => a.telemetryId.localeCompare(b.telemetryId));
}

function sum(records, key, kind) {
  const values = records.filter((entry) => entry.kind === kind).map((entry) => entry[key]).filter(available);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function aggregateUsage(records) {
  const groups = new Map();
  for (const record of records) {
    const key = [record.kind, record.modelId, record.reasoning ?? "none", record.assignmentType ?? "unknown", record.specId ?? "unknown"].join("|");
    const group = groups.get(key) ?? { kind: record.kind, modelId: record.modelId, reasoning: record.reasoning ?? "none", assignmentType: record.assignmentType ?? "unknown", specId: record.specId ?? "unknown", recordCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, reasoningTokens: null };
    group.recordCount += 1;
    for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "reasoningTokens"]) if (available(record[field])) group[field] = (group[field] ?? 0) + record[field];
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function metrics(input, usage) {
  const promotion = input.promotion ?? {};
  const review = input.reviewResults ?? {};
  const totals = {
    candidateCount: optionalCount(input.candidates?.count, "candidates.count"),
    evidenceCount: optionalCount(input.evidence?.count, "evidence.count"),
    validatedCandidateCount: optionalCount(input.candidates?.validatedCount, "candidates.validatedCount"),
    approvedCandidateCount: optionalCount(input.candidates?.approvedCount, "candidates.approvedCount"),
    proposedChangeCount: optionalCount(promotion.proposedChangeCount, "promotion.proposedChangeCount"),
    mergedResultCount: optionalCount(input.outcomes?.mergedResultCount, "outcomes.mergedResultCount"),
    workerResultValidationFailureCount: optionalCount(review.validationFailureCount, "reviewResults.validationFailureCount"),
    capabilityEscalationCount: optionalCount(input.escalations?.count, "escalations.count"),
    retryCount: optionalCount(input.recovery?.retryCount, "recovery.retryCount"),
    recoveryIncidentCount: optionalCount(input.recovery?.incidentCount, "recovery.incidentCount"),
    escalationIncrementalTokens: optionalCount(input.escalations?.incrementalTokens, "escalations.incrementalTokens"),
    retryRecoveryTokens: optionalCount(input.recovery?.retryRecoveryTokens, "recovery.retryRecoveryTokens"),
    invalidResultTokens: optionalCount(input.reviewResults?.invalidResultTokens, "reviewResults.invalidResultTokens"),
    cacheAvoidedInputTokens: optionalCount(input.cacheReuse?.avoidedInputTokens, "cacheReuse.avoidedInputTokens"),
  };
  const actualInput = sum(usage, "inputTokens", "actual");
  const estimatedInput = sum(usage, "estimatedInputTokens", "estimate");
  const actualOutput = sum(usage, "outputTokens", "actual");
  const estimatedOutput = sum(usage, "estimatedOutputTokens", "estimate");
  const actualTotal = actualInput === null && actualOutput === null ? null : (actualInput ?? 0) + (actualOutput ?? 0);
  const estimatedTotal = estimatedInput === null && estimatedOutput === null ? null : (estimatedInput ?? 0) + (estimatedOutput ?? 0);
  const pricing = input.pricing;
  return {
    ...totals,
    actualTokens: { input: actualInput, output: actualOutput, total: actualTotal },
    estimatedTokens: { input: estimatedInput, output: estimatedOutput, total: estimatedTotal },
    cost: pricing ? calculateCost(usage, pricing) : { currency: null, actual: null, estimated: null, status: "unavailable" },
    tokensPerValidatedCandidate: actualInput === null || !totals.validatedCandidateCount ? null : actualInput / totals.validatedCandidateCount,
    tokensPerProposedChange: actualTotal === null || !totals.proposedChangeCount ? null : actualTotal / totals.proposedChangeCount,
    tokensPerMergedResult: actualTotal === null || !totals.mergedResultCount ? null : actualTotal / totals.mergedResultCount,
  };
}

function calculateCost(records, pricing) {
  if (!pricing || pricing.schemaVersion !== 1 || !pricing.currency || !Array.isArray(pricing.rates)) throw new Error("Pricing must be explicit schema-versioned input.");
  const rates = new Map(pricing.rates.map((rate) => [rate.modelId, rate]));
  let actual = 0; let estimated = 0; let actualSeen = false; let estimateSeen = false;
  for (const record of records) {
    const rate = rates.get(record.modelId);
    if (!rate) continue;
    const total = (record.inputTokens ?? record.estimatedInputTokens ?? 0) * (rate.inputPerMillion ?? 0) / 1e6 + (record.outputTokens ?? record.estimatedOutputTokens ?? 0) * (rate.outputPerMillion ?? 0) / 1e6;
    if (record.kind === "actual") { actual += total; actualSeen = true; } else { estimated += total; estimateSeen = true; }
  }
  return { currency: pricing.currency, actual: actualSeen ? Number(actual.toFixed(12)) : null, estimated: estimateSeen ? Number(estimated.toFixed(12)) : null, status: "available", pricingVersion: pricing.version ?? null };
}

function improvementQueue(input) {
  const observations = input.improvementObservations ?? [];
  if (!Array.isArray(observations)) throw new Error("improvementObservations must be an array.");
  const threshold = Number.isInteger(input.options?.supportThreshold) && input.options.supportThreshold > 0 ? input.options.supportThreshold : 2;
  const critical = new Set(input.options?.criticalReasonCodes ?? ["exact-cardinality-mismatch", "digest-mismatch", "unsafe-input"]);
  const grouped = new Map();
  for (const observation of observations) {
    const reasonCode = required(observation.reasonCode, "observation.reasonCode");
    const classification = required(observation.class, "observation.class");
    if (!classes.has(classification)) throw new Error(`Unknown improvement class ${classification}.`);
    const key = `${classification}|${reasonCode}|${observation.surface ?? "unknown"}`;
    const prior = grouped.get(key) ?? { ...observation, supportCount: 0, evidenceRefs: new Set(), affectedSurfaces: new Set() };
    prior.supportCount += 1;
    for (const ref of observation.evidenceRefs ?? []) prior.evidenceRefs.add(required(ref, "evidenceRef"));
    if (observation.surface) prior.affectedSurfaces.add(observation.surface);
    grouped.set(key, prior);
  }
  return [...grouped.values()].map((entry) => {
    const supportCount = entry.supportCount;
    const state = states.has(entry.state) ? entry.state : (critical.has(entry.reasonCode) || supportCount >= threshold ? "proposed" : "observe");
    const core = { schemaVersion: improvementQueueSchemaVersion, class: entry.class, severity: entry.severity ?? (critical.has(entry.reasonCode) ? "critical" : "medium"), frequency: supportCount, supportCount, reasonCodes: [entry.reasonCode], evidenceRefs: sorted([...entry.evidenceRefs]), affectedSurfaces: sorted([...entry.affectedSurfaces]), proposedOwner: entry.proposedOwner ?? (state === "proposed" ? "luna" : "manual"), proposedLayer: entry.proposedLayer ?? "layer-3", recommendedValidation: entry.recommendedValidation ?? "review-evidence-and-reproduce", state };
    return { ...core, proposalId: `improvement-${retrospectiveDigest(core).slice(0, 24)}`, proposalDigest: retrospectiveDigest(core) };
  }).sort((a, b) => a.proposalId.localeCompare(b.proposalId));
}

export function compileRetrospective(input) {
  if (!input || input.schemaVersion !== 1) throw new Error("Unsupported or corrupt retrospective input schema.");
  assertRetrospectiveSafe(input);
  const assignments = assignmentIndex(input);
  const usageRecords = validateTelemetry(input.modelUsage?.records, assignments);
  const queue = improvementQueue(input);
  const core = {
    schemaVersion: retrospectiveSchemaVersion,
    runId: required(input.runId, "runId"),
    scope: clean(input.scope ?? { portals: [], specs: [] }),
    sources: sourceList(input),
    outcomes: clean(input.outcomes ?? {}),
    durations: clean(input.durations ?? { captureMs: null, stageMs: {} }),
    actionMetrics: clean(input.actionMetrics ?? {}),
    informationGain: clean(input.informationGain ?? {}),
    cacheReuse: clean(input.cacheReuse ?? {}),
    gapSummaries: clean(input.gapSummaries ?? {}),
    processEvents: clean(input.processEvents ?? {}),
    operatorAnnotations: clean(input.operatorAnnotations ?? []),
    metrics: metrics(input, usageRecords),
    modelUsage: { schemaVersion: modelUsageSchemaVersion, records: usageRecords, aggregates: aggregateUsage(usageRecords), actualRecordCount: usageRecords.filter((r) => r.kind === "actual").length, estimateRecordCount: usageRecords.filter((r) => r.kind === "estimate").length },
    improvementQueue: { schemaVersion: improvementQueueSchemaVersion, proposals: queue },
    unresolvedBlockers: clean(input.unresolvedBlockers ?? []),
    nextActions: clean(input.nextActions ?? []),
    measurements: { synthetic: true, inputBytes: Buffer.byteLength(stableJson(input), "utf8"), outputBytes: 0, proposalCount: queue.length, proposalCountsByState: Object.fromEntries([...states].map((state) => [state, queue.filter((entry) => entry.state === state).length])), rejectedTelemetryCount: 0, unavailableAggregateCount: Object.values(metrics(input, usageRecords)).flatMap((value) => typeof value === "object" && value ? Object.values(value) : [value]).filter((value) => value === null).length },
  };
  core.measurements.outputBytes = Buffer.byteLength(stableJson(core), "utf8");
  return { ...core, retrospectiveId: `retrospective-${retrospectiveDigest(core).slice(0, 24)}`, retrospectiveDigest: retrospectiveDigest(core) };
}

export function validateRetrospective(value) {
  if (!value || value.schemaVersion !== retrospectiveSchemaVersion || value.retrospectiveDigest !== retrospectiveDigest(Object.fromEntries(Object.entries(value).filter(([key]) => !["retrospectiveId", "retrospectiveDigest"].includes(key))))) throw new Error("Unsupported or corrupt retrospective output.");
  assertRetrospectiveSafe(value, "retrospective output");
  const ids = new Set();
  for (const proposal of value.improvementQueue?.proposals ?? []) {
    if (ids.has(proposal.proposalId) || proposal.proposalDigest !== retrospectiveDigest(Object.fromEntries(Object.entries(proposal).filter(([key]) => !["proposalId", "proposalDigest"].includes(key))))) throw new Error("Invalid improvement proposal digest or ID.");
    ids.add(proposal.proposalId);
  }
  return value;
}

export async function writeRetrospectiveAtomic(filePath, value) {
  validateRetrospective(value);
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${value.retrospectiveDigest.slice(0, 12)}`;
  await writeFile(temporary, stableJson(value), "utf8");
  await rename(temporary, absolute);
}

async function main() {
  const [command, inputPath, ...args] = process.argv.slice(2);
  if (command !== "compile" || !inputPath) throw new Error("Use compile <input.json> [--write <output.json>].");
  const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  const result = compileRetrospective(input);
  const writeIndex = args.indexOf("--write");
  if (writeIndex >= 0) await writeRetrospectiveAtomic(args[writeIndex + 1], result);
  process.stdout.write(stableJson(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
