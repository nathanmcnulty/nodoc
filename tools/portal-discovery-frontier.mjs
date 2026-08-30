import { createHash } from "node:crypto";

import { buildNoveltyPlan, deriveNoveltyBaseline } from "./portal-discovery-novelty.mjs";

export const frontierSchemaVersion = 1;
export const frontierClasses = [
  "unvisited-state", "eligible-control", "failed-transition", "bundle-only-family",
  "missing-schema-shape", "unassigned-adjacent", "spec-evidence-gap",
  "safety-ownership-schema-conflict", "incomplete-health", "benchmark-regression",
];
export const offlineFrontierSchemaVersion = 1;
const gapClasses = new Set([
  "route", "query", "request-shape", "response-shape", "response-metadata", "ownership",
  "operation-context", "parameter-example", "request-example", "response-example",
  "error-behavior", "permissions", "pagination",
]);

const stableJson = (value) => `${JSON.stringify(value)}\n`;
export const frontierDigest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
const sorted = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const safeText = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 500);
const safe = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(safe);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, safe(entry)]));
  return null;
};
const unsafe = /tenant|bearer|cookie|authorization|password|secret|credential|https?:\/\/|[A-Za-z]:\\/iu;

function assertSafe(value, label) {
  if (unsafe.test(JSON.stringify(value))) throw new Error(`${label} contains unsafe tenant, auth, URL, or absolute-path data.`);
}

function itemFor(entry, metadata = {}) {
  const core = {
    schemaVersion: frontierSchemaVersion,
    class: entry.class,
    subject: safeText(entry.subject || entry.id || entry.route || "unknown"),
    sourceRefs: sorted((entry.sourceRefs ?? entry.evidenceRefs ?? []).map(safeText)),
    expectedInformationClass: safeText(entry.expectedInformationClass || entry.class),
    route: ["cheap", "luna", "manual", "orchestrator"].includes(entry.route) ? entry.route : "orchestrator",
    risk: ["low", "medium", "high", "critical"].includes(entry.risk) ? entry.risk : "medium",
    dependencies: sorted((entry.dependencies ?? []).map(safeText)),
    blockers: sorted((entry.blockers ?? []).map(safeText)),
    completionCriteria: sorted((entry.completionCriteria ?? ["validated evidence and terminal decision"]).map(safeText)),
    evidenceGap: Number.isFinite(entry.evidenceGap) ? entry.evidenceGap : 1,
    informationGain: Number.isFinite(entry.informationGain) ? entry.informationGain : 1,
    costProxy: Number.isFinite(entry.costProxy) ? entry.costProxy : 1,
    freshness: Number.isFinite(entry.freshness) ? entry.freshness : 1,
    saturation: entry.saturation ?? "unknown",
    metadata: safe(metadata),
  };
  return { ...core, itemId: `frontier-${frontierDigest(core).slice(0, 24)}`, itemDigest: frontierDigest(core) };
}

export function calculateUnresolvedFrontier({ discovery = {}, portfolio = {}, benchmark = {}, metadata = {} } = {}) {
  assertSafe({ discovery, benchmark, metadata }, "frontier input");
  const entries = [];
  const add = (entry) => entries.push(itemFor(entry, metadata));
  for (const state of discovery.unvisitedStates ?? []) add({ class: "unvisited-state", subject: state, expectedInformationClass: "state-transition", route: "cheap" });
  for (const control of discovery.eligibleButUnattempted ?? []) add({ class: "eligible-control", subject: control, expectedInformationClass: "control-outcome", route: "cheap" });
  for (const failure of discovery.failedTransitions ?? discovery.unknownTransitions ?? []) add({ class: "failed-transition", subject: failure, expectedInformationClass: "failure-cause", route: "luna", risk: "high" });
  for (const family of discovery.bundleOnlyFamilies ?? []) add({ class: "bundle-only-family", subject: family, expectedInformationClass: "response-shape", route: "luna" });
  for (const shape of discovery.missingSchemaShapes ?? []) add({ class: "missing-schema-shape", subject: shape, expectedInformationClass: "request-response-schema", route: "luna", risk: "high" });
  for (const host of discovery.unassignedAdjacent ?? []) add({ class: "unassigned-adjacent", subject: host, expectedInformationClass: "ownership-and-scope", route: "manual", risk: "high", blockers: ["explicit-assignment-required"] });
  for (const gap of discovery.specEvidenceGaps ?? []) add({ class: "spec-evidence-gap", subject: gap, expectedInformationClass: "existing-spec-corroboration", route: "cheap" });
  for (const conflict of discovery.safetyOwnershipSchemaConflicts ?? []) add({ class: "safety-ownership-schema-conflict", subject: conflict, expectedInformationClass: "conflict-resolution", route: "manual", risk: "critical" });
  if (discovery.health?.complete !== true || discovery.health?.available !== true || discovery.health?.accountingConsistent === false) add({ class: "incomplete-health", subject: "canonical-health", expectedInformationClass: "health-completeness", route: "orchestrator", risk: "high", blockers: ["canonical-health-incomplete"] });
  for (const regression of benchmark.regressions ?? []) add({ class: "benchmark-regression", subject: regression, expectedInformationClass: "benchmark-drift", route: "orchestrator", risk: "high", blockers: ["benchmark-regression"] });
  const items = [...new Map(entries.map((entry) => [entry.itemId, entry])).values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const core = { schemaVersion: frontierSchemaVersion, items, sourceDigest: frontierDigest({ discovery, portfolio, benchmark, metadata }) };
  return { ...core, frontierId: `frontier-set-${frontierDigest(core).slice(0, 24)}`, frontierDigest: frontierDigest(core), measurements: { itemCount: items.length, countsByClass: Object.fromEntries(frontierClasses.map((name) => [name, items.filter((item) => item.class === name).length])) } };
}

export function scheduleFrontier(frontier, { budgets = {}, saturation = "unknown" } = {}) {
  if (!frontier || frontier.schemaVersion !== frontierSchemaVersion) throw new Error("Unsupported or corrupt frontier schema.");
  assertSafe(frontier, "frontier");
  const limits = { actions: budgets.maxActions ?? Infinity, timeMs: budgets.maxTimeMs ?? Infinity, payloadBytes: budgets.maxPayloadBytes ?? Infinity, tokenEstimate: budgets.maxTokenEstimate ?? Infinity, retries: budgets.maxRetries ?? Infinity, portal: budgets.maxPortals ?? Infinity, spec: budgets.maxSpecs ?? Infinity };
  const priority = (item) => (item.evidenceGap * 1000) + (item.informationGain * 100) + (item.risk === "critical" ? 80 : item.risk === "high" ? 40 : 0) - item.costProxy * 10 + item.freshness * 5 - (item.dependencies.length * 20) - (item.saturation === "reached" ? 100 : 0);
  const ordered = [...frontier.items].sort((a, b) => priority(b) - priority(a) || a.itemId.localeCompare(b.itemId));
  const selected = []; let actions = 0; let payloadBytes = 0; let tokenEstimate = 0; const portals = new Set(); const specs = new Set();
  for (const item of ordered) {
    const bytes = Buffer.byteLength(stableJson(item), "utf8"); const tokens = Number.isFinite(item.tokenEstimate) ? item.tokenEstimate : 0;
    if (actions + 1 > limits.actions || payloadBytes + bytes > limits.payloadBytes || tokenEstimate + tokens > limits.tokenEstimate || portals.size + 1 > limits.portal || specs.size + 1 > limits.spec) continue;
    selected.push({ itemId: item.itemId, priority: priority(item), serializedBytes: bytes, tokenEstimate: tokens, action: item.route === "orchestrator" ? "repair-orchestrator-input" : "recommend-offline-review" }); actions += 1; payloadBytes += bytes; tokenEstimate += tokens; portals.add(item.metadata?.portal ?? item.subject); specs.add(item.metadata?.spec ?? item.subject);
  }
  const criticalBlockers = frontier.items.filter((item) => item.risk === "critical" || item.class === "incomplete-health" || item.class === "benchmark-regression");
  const healthy = saturation === "reached" && criticalBlockers.length === 0 && frontier.items.length === 0;
  return { schemaVersion: frontierSchemaVersion, frontierId: frontier.frontierId, saturation, selected, deferredCount: frontier.items.length - selected.length, budgets: safe(limits), terminal: healthy ? "saturated-complete" : selected.length ? "capture-recommended" : "blocked", blockers: criticalBlockers.map((item) => item.itemId).sort(), measurements: { selectedCount: selected.length, serializedBytes: payloadBytes, estimatedTokens: tokenEstimate } };
}

export function validateFrontier(value) {
  if (!value || value.schemaVersion !== frontierSchemaVersion || !Array.isArray(value.items)) throw new Error("Unsupported or corrupt frontier output.");
  const core = Object.fromEntries(Object.entries(value).filter(([key]) => !["frontierId", "frontierDigest", "measurements"].includes(key)));
  if (value.frontierDigest !== frontierDigest(core)) throw new Error("Frontier digest mismatch.");
  for (const item of value.items) if (!frontierClasses.includes(item.class) || item.itemDigest !== frontierDigest(Object.fromEntries(Object.entries(item).filter(([key]) => !["itemId", "itemDigest"].includes(key))))) throw new Error("Invalid frontier item.");
  return value;
}

function inferredGapClass(value) {
  const text = safeText(value).toLowerCase();
  if (/query|parameter/u.test(text)) return "query";
  if (/request.*shape|payload/u.test(text)) return "request-shape";
  if (/response.*shape|schema/u.test(text)) return "response-shape";
  if (/mime|status|header|response.*metadata/u.test(text)) return "response-metadata";
  return "route";
}

function exactCandidate({ specId, hostFamily = "unknown", gapClass, canonicalKey, evidence = [], sourceRefs = [], status = "candidate", requiredActionState = null, blockers = [] }) {
  const core = {
    schemaVersion: offlineFrontierSchemaVersion,
    specId: safeText(specId),
    hostFamily: safeText(hostFamily).toLowerCase(),
    gapClass,
    canonicalKey: safeText(canonicalKey),
    evidence: sorted(evidence.map(safeText)),
    sourceRefs: sorted(sourceRefs.map(safeText)),
    requiredActionState: safe(requiredActionState),
    status,
    blockers: sorted(blockers.map(safeText)),
  };
  return {
    ...core,
    frontierId: `offline-frontier-${frontierDigest(core).slice(0, 24)}`,
    frontierDigest: frontierDigest(core),
  };
}

function targetMapping(recipe, hostFamily, pathname) {
  const target = recipe?.noveltyFrontier?.targets?.find((entry) => (
    (entry.expectedHostFamilies ?? []).map((host) => String(host).toLowerCase()).includes(hostFamily)
    && ((entry.expectedRoutes ?? []).includes(pathname)
      || (entry.expectedRoutePrefixes ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
  ));
  return target ? {
    targetId: target.id,
    state: target.state,
    actionIndexes: target.actionIndexes,
    documentationObjectives: target.expectedDocumentationObjectives ?? [],
  } : null;
}

export function compileOfflineFrontier({ specId, specification = {}, coverage = {}, recipe = {}, priorArtifacts = {}, candidateHandoff = {} } = {}) {
  if (typeof specId !== "string" || !specId.trim()) throw new Error("specId is required for offline frontier compilation.");
  const baseline = deriveNoveltyBaseline(specification);
  let executablePlan = null;
  if (recipe?.noveltyFrontier) {
    try { executablePlan = buildNoveltyPlan(recipe, { required: true, derivedBaseline: baseline }); }
    catch { executablePlan = null; }
  }
  const candidates = [];
  const add = (entry) => candidates.push(exactCandidate({ specId, ...entry }));
  for (const operation of baseline.operations) {
    const host = operation.hosts[0] ?? "unknown";
    const key = `${host} ${operation.method} ${operation.path}`;
    const mapping = targetMapping(recipe, host, operation.path);
    if (!operation.requestSchemaDocumented) add({ hostFamily: host, gapClass: "request-shape", canonicalKey: key, evidence: ["openapi"], sourceRefs: ["checked-in-openapi"], requiredActionState: mapping, status: mapping && executablePlan ? "approved" : "candidate", blockers: mapping && executablePlan ? [] : ["exact-ui-state-approval-required"] });
    if (!operation.responseSchemaDocumented) add({ hostFamily: host, gapClass: "response-shape", canonicalKey: key, evidence: ["openapi"], sourceRefs: ["checked-in-openapi"], requiredActionState: mapping, status: mapping && executablePlan ? "approved" : "candidate", blockers: mapping && executablePlan ? [] : ["exact-ui-state-approval-required"] });
    if (operation.responseStatuses.length === 0 || operation.responseContentTypes.length === 0) add({ hostFamily: host, gapClass: "response-metadata", canonicalKey: key, evidence: ["openapi"], sourceRefs: ["checked-in-openapi"], requiredActionState: mapping, status: mapping && executablePlan ? "approved" : "candidate", blockers: mapping && executablePlan ? [] : ["exact-ui-state-approval-required"] });
    const enrichment = (gapClass, applies) => {
      if (!applies) return;
      const approved = Boolean(mapping && executablePlan && mapping.documentationObjectives.includes(gapClass));
      add({
        hostFamily: host,
        gapClass,
        canonicalKey: key,
        evidence: ["openapi-documentation-inventory"],
        sourceRefs: ["checked-in-openapi"],
        requiredActionState: mapping,
        status: approved ? "approved" : "candidate",
        blockers: approved ? [] : ["sanitized-documentation-evidence-required"],
      });
    };
    enrichment("operation-context", operation.operationContextFields.length === 0);
    enrichment("parameter-example", operation.parameterCount > operation.parameterExamplesDocumented.length);
    enrichment("request-example", operation.requestContentTypes.length > 0 && !operation.requestExampleDocumented);
    enrichment("response-example", !operation.responseExampleDocumented);
    enrichment("error-behavior", operation.errorResponseStatuses.length === 0 || !operation.errorExampleDocumented);
    enrichment("permissions", !operation.permissionsDocumented);
    enrichment("pagination", operation.listLike && !operation.paginationDocumented);
  }
  for (const gap of [...(coverage.openGaps ?? []), ...(coverage.openGapClasses ?? [])]) {
    add({ gapClass: inferredGapClass(gap), canonicalKey: `coverage ${safeText(gap)}`, evidence: ["coverage-ledger"], sourceRefs: ["coverage-ledger"], blockers: ["exact-route-and-ui-state-required"] });
  }
  for (const record of priorArtifacts.candidates ?? priorArtifacts.confirmedReadCandidates ?? []) {
    if (!record?.normalizedPath) continue;
    const host = safeText(record.hostFamily ?? "unknown").toLowerCase();
    const method = safeText(record.method ?? "GET").toUpperCase();
    const mapping = targetMapping(recipe, host, record.normalizedPath);
    add({ hostFamily: host, gapClass: "route", canonicalKey: `${host} ${method} ${record.normalizedPath}`, evidence: ["prior-artifact"], sourceRefs: record.evidenceIds ?? [record.candidateId ?? "prior-candidate"], requiredActionState: mapping, status: mapping && executablePlan ? "approved" : "candidate", blockers: mapping && executablePlan ? [] : ["exact-ui-state-approval-required"] });
  }
  const adjacent = [
    ...(candidateHandoff.adjacentConfirmedReadCandidates ?? []),
    ...(candidateHandoff.adjacentConfirmedSafetyReviewCandidates ?? []),
  ];
  for (const record of adjacent) add({ hostFamily: record.hostFamily ?? "unknown", gapClass: "ownership", canonicalKey: `${record.hostFamily ?? "unknown"} ${record.method ?? "ANY"} ${record.normalizedPath ?? "unknown"}`, evidence: ["candidate-handoff"], sourceRefs: record.evidenceIds ?? [record.candidateId ?? "adjacent-candidate"], status: "blocked", blockers: ["explicit-spec-and-host-assignment-required"] });
  const items = [...new Map(candidates.map((entry) => [`${entry.gapClass}|${entry.canonicalKey}`, entry])).values()]
    .sort((left, right) => `${left.gapClass}|${left.canonicalKey}`.localeCompare(`${right.gapClass}|${right.canonicalKey}`));
  const approved = items.filter((entry) => entry.status === "approved" && entry.requiredActionState);
  const unresolvedOwnership = items.filter((entry) => entry.gapClass === "ownership" && entry.status !== "satisfied");
  const terminal = recipe?.noveltyStatus?.status === "satisfied"
    ? "satisfied-prebrowser-block"
    : unresolvedOwnership.length > 0
      ? "blocked-adjacent-ownership"
      : approved.length > 0
        ? "capture-authorized"
        : "blocked-no-exact-frontier";
  const core = { schemaVersion: offlineFrontierSchemaVersion, specId: safeText(specId), items, terminal };
  return {
    ...core,
    frontierSetId: `offline-frontier-set-${frontierDigest(core).slice(0, 24)}`,
    frontierSetDigest: frontierDigest(core),
    measurements: {
      approvedCount: approved.length,
      candidateCount: items.filter((entry) => entry.status === "candidate").length,
      countsByGapClass: Object.fromEntries([...gapClasses].sort().map((name) => [
        name,
        items.filter((entry) => entry.gapClass === name).length,
      ])),
      itemCount: items.length,
      unresolvedOwnershipCount: unresolvedOwnership.length,
    },
  };
}

export function validateOfflineFrontier(value) {
  if (!value || value.schemaVersion !== offlineFrontierSchemaVersion || !Array.isArray(value.items)) throw new Error("Unsupported offline frontier schema.");
  const core = Object.fromEntries(Object.entries(value).filter(([key]) => !["frontierSetId", "frontierSetDigest", "measurements"].includes(key)));
  if (value.frontierSetDigest !== frontierDigest(core)) throw new Error("Offline frontier digest mismatch.");
  for (const item of value.items) {
    if (!gapClasses.has(item.gapClass)) throw new Error(`Unsupported offline frontier gap class ${item.gapClass}.`);
    const itemCore = Object.fromEntries(Object.entries(item).filter(([key]) => !["frontierId", "frontierDigest"].includes(key)));
    if (item.frontierDigest !== frontierDigest(itemCore)) throw new Error("Offline frontier item digest mismatch.");
  }
  return value;
}
