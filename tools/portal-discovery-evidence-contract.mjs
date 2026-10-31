import { createHash } from "node:crypto";
import { actionResultSucceeded } from "./discovery-capture-policy.mjs";
import { routePattern } from "./portal-discovery-novelty.mjs";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const methods = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
const axisStates = new Set(["unknown", "gap", "active", "blocked", "satisfied", "observed", "execution-tested", "derived-current"]);
const stateKinds = new Set(["empty", "populated", "detail", "error", "pagination"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const stableJson = (value) => `${JSON.stringify(canonical(value))}\n`;
const digest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");

export function buildGraphQlOperationDefinitionDigest({ operationNames, operationKind, persistedQuerySha256Hashes = [], literalQuerySha256Hashes = [] }) {
  return digest({ operationNames: [...operationNames].sort(), operationKind, persistedQuerySha256Hashes: [...persistedQuerySha256Hashes].sort(), literalQuerySha256Hashes: [...literalQuerySha256Hashes].sort() });
}

function fail(message) {
  const error = new Error(message);
  error.code = "evidence-contract-invalid";
  throw error;
}

export function isValidKnownOperationRefreshExpiryTimestamp(value) {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function cleanStrings(values, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  const result = values.map((value) => String(value ?? "").trim());
  if (result.some((value) => !value) || new Set(result).size !== result.length) fail(`${label} must contain unique non-empty strings.`);
  return result;
}

function actionDescriptor(action) {
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    return { type: (separator > 0 ? action.slice(0, separator) : action).replace(/-(root|iframe)$/u, ""), value: separator > 0 ? action.slice(separator + 1) : "" };
  }
  return { type: String(action?.type ?? "").replace(/-(root|iframe)$/u, ""), value: String(action?.value ?? "") };
}

// Bind the complete recipe, preserving action order and exact string/object scopes.
// Only the approval's own content hash and the resolver's documented marker
// are excluded; neither is an executable recipe field.
export function buildKnownOperationExecutionDigest(recipe) {
  const projection = structuredClone(recipe);
  delete projection.__resolvedVariableBindingsDigest;
  if (projection.knownOperationRefresh) delete projection.knownOperationRefresh.approvalDigest;
  return digest(projection);
}

// Static metadata can retain legacy history without granting live permission.
// Variable-bearing source recipes bind their raw projection separately from
// the resolved execution digest, whose syntax is all static validation knows.
export function classifyKnownOperationExecutionApproval(approval, rawPlan, { hasRuntimeVariables = false } = {}) {
  if (approval.executionDigest === undefined && approval.sourceExecutionDigest === undefined) return 'legacy-non-runnable';
  const valid = sha256Pattern.test(String(rawPlan.executionDigest ?? ''))
    && sha256Pattern.test(String(approval.executionDigest ?? ''))
    && (hasRuntimeVariables
      ? approval.sourceExecutionDigest === rawPlan.executionDigest
      : approval.executionDigest === rawPlan.executionDigest
        && (approval.sourceExecutionDigest === undefined || approval.sourceExecutionDigest === rawPlan.executionDigest));
  if (!valid) fail('knownOperationRefresh full execution approval binding is invalid.');
  return 'bound';
}

export function buildKnownOperationRefreshPlan(recipe, { required = false, baselineOperations = null } = {}) {
  const contract = recipe?.knownOperationRefresh;
  if (!contract) {
    if (required) fail("selected recipe does not declare knownOperationRefresh metadata.");
    return null;
  }
  if (contract.status && contract.status !== "active") fail("knownOperationRefresh.status must be active while a refresh contract is runnable.");
  const method = String(contract.method ?? "").toUpperCase();
  if (!methods.has(method)) fail("knownOperationRefresh.method must be a valid observed HTTP method.");
  const host = String(contract.host ?? "").trim().toLowerCase();
  if (!host || host.includes("://") || host.includes("/") || host.includes("@")) fail("knownOperationRefresh.host must be one hostname.");
  const routes = cleanStrings(contract.routes, "knownOperationRefresh.routes");
  if (routes.some((route) => !route.startsWith("/") || route.includes("?") || route.includes("#"))) fail("knownOperationRefresh.routes must contain clean absolute paths.");
  const operationNames = cleanStrings(contract.operationNames ?? [], "knownOperationRefresh.operationNames", { allowEmpty: true });
  if (routes.some((route) => /\/(?:graphql|gql)\/?$/iu.test(route)) && operationNames.length === 0) fail("knownOperationRefresh GraphQL routes require exact operationNames.");
  const operationKind = contract.operationKind === undefined ? null : String(contract.operationKind).trim().toLowerCase();
  if (routes.some((route) => /\/(?:graphql|gql)\/?$/iu.test(route)) && operationKind !== "query") fail("knownOperationRefresh GraphQL routes require operationKind=query; mutations and subscriptions are not authorized refresh targets.");
  const persistedQuerySha256Hashes = cleanStrings(contract.persistedQuerySha256Hashes ?? [], "knownOperationRefresh.persistedQuerySha256Hashes", { allowEmpty: true });
  const literalQuerySha256Hashes = cleanStrings(contract.literalQuerySha256Hashes ?? [], "knownOperationRefresh.literalQuerySha256Hashes", { allowEmpty: true });
  if ([...persistedQuerySha256Hashes, ...literalQuerySha256Hashes].some((value) => !sha256Pattern.test(value))) fail("knownOperationRefresh GraphQL query hashes must be SHA-256 values.");
  if (operationKind === "query" && persistedQuerySha256Hashes.length === 0 && literalQuerySha256Hashes.length === 0) fail("knownOperationRefresh GraphQL queries require an exact persisted-query or literal-query hash.");
  const operationDefinitionDigest = contract.operationDefinitionDigest === undefined ? null : String(contract.operationDefinitionDigest).trim();
  if (operationKind === "query" && !sha256Pattern.test(operationDefinitionDigest)) fail("knownOperationRefresh GraphQL queries require an immutable operationDefinitionDigest.");
  const expectedOperationDefinitionDigest = operationKind === "query"
    ? buildGraphQlOperationDefinitionDigest({ operationNames, operationKind, persistedQuerySha256Hashes, literalQuerySha256Hashes })
    : null;
  if (operationKind === "query" && operationDefinitionDigest !== expectedOperationDefinitionDigest) fail("knownOperationRefresh operationDefinitionDigest must bind the exact reviewed GraphQL operation names, kind, and request hashes.");
  const state = String(contract.state ?? "").trim();
  if (!state) fail("knownOperationRefresh.state is required.");
  const actions = (recipe.actions ?? []).map(actionDescriptor);
  if (!Array.isArray(contract.actionIndexes) || contract.actionIndexes.length === 0) fail("knownOperationRefresh.actionIndexes must be non-empty.");
  const actionIndexes = contract.actionIndexes.map(Number);
  if (actionIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= actions.length) || new Set(actionIndexes).size !== actionIndexes.length) fail("knownOperationRefresh.actionIndexes must be unique in-range indexes.");
  if (!actionIndexes.some((index) => actions[index].type === "capture")) fail("knownOperationRefresh.actionIndexes must include a capture checkpoint.");
  if (!actionIndexes.some((index) => ["navigate", "reload"].includes(actions[index].type))) fail("knownOperationRefresh.actionIndexes must include an exact passive page transition.");
  const approvalArtifact = String(contract.approvalArtifact ?? "").trim();
  const approvalDigest = String(contract.approvalDigest ?? "").trim();
  if (!approvalArtifact || !sha256Pattern.test(approvalDigest)) fail("knownOperationRefresh requires an approvalArtifact and immutable SHA-256 approvalDigest.");
  const approvalExpiresAt = String(contract.approvalExpiresAt ?? "").trim();
  if (!isValidKnownOperationRefreshExpiryTimestamp(approvalExpiresAt)) fail("knownOperationRefresh.approvalExpiresAt must be an ISO date-time.");
  const objectives = cleanStrings(contract.documentationObjectives ?? [], "knownOperationRefresh.documentationObjectives", { allowEmpty: true });
  const evidenceIds = cleanStrings(contract.evidenceIds ?? [], "knownOperationRefresh.evidenceIds", { allowEmpty: true });
  const variableBindingsDigest = String(contract.variableBindingsDigest ?? "").trim();
  if (!sha256Pattern.test(variableBindingsDigest)) fail("knownOperationRefresh.variableBindingsDigest must bind the exact resolved variables.");
  if (recipe.__resolvedVariableBindingsDigest && recipe.__resolvedVariableBindingsDigest !== variableBindingsDigest) fail("knownOperationRefresh resolved variable binding digest mismatch.");
  const entryUrl = actionIndexes.map((index) => actions[index]).find((action) => action.type === "navigate" && action.value)?.value || String(recipe.url || "");
  let parsedEntry;
  try { parsedEntry = new URL(entryUrl, recipe.url); } catch { fail("knownOperationRefresh entry URL is invalid."); }
  const captureHosts = (recipe?.matchHosts ?? []).map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  if (!captureHosts.includes(host)) fail("knownOperationRefresh API host must be included in the recipe network matchHosts.");
  const actionBindings = actionIndexes.map((index) => ({ index, ...actions[index] }));
  const policy = { mode: String(recipe?.inspectionPolicy?.mode ?? ""), prohibitedControlPatterns: [...(recipe?.inspectionPolicy?.prohibitedControlPatterns ?? [])].map(String).sort() };
  if (policy.mode !== "observe-only") fail("knownOperationRefresh requires an observe-only inspection policy.");
  if (Array.isArray(baselineOperations)) {
    const hostOwned = (candidate) => candidate === host || (candidate.startsWith("server-variable") && host.endsWith(candidate.slice("server-variable".length)));
    const owned = routes.every((route) => baselineOperations.some((operation) => {
      if (operation.method !== method) return false;
      const bindings = operation.serverBindings?.length
        ? operation.serverBindings
        : (operation.hosts ?? []).map((operationHost) => ({ host: operationHost, basePath: "/" }));
      return bindings.some((binding) => {
        const basePath = String(binding.basePath ?? "/").replace(/\/+$/u, "");
        const operationPath = String(operation.path ?? "");
        const wirePath = `${basePath}${operationPath.startsWith("/") ? "" : "/"}${operationPath}`;
        return hostOwned(binding.host) && routePattern(wirePath).test(route);
      });
    }));
    if (!owned) fail("knownOperationRefresh method/host/routes are not owned by the bundled OpenAPI operation inventory.");
  }
  const contractCore = { schemaVersion: 1, kind: "known-operation-refresh", method, host, routes: [...routes].sort(), operationNames: [...operationNames].sort(), operationKind, operationDefinitionDigest, persistedQuerySha256Hashes: [...persistedQuerySha256Hashes].sort(), literalQuerySha256Hashes: [...literalQuerySha256Hashes].sort(), state, actionIndexes: [...actionIndexes].sort((a, b) => a - b), entryUrl: parsedEntry.href, entryHost: parsedEntry.hostname.toLowerCase(), actionBindings, policy, variableBindingsDigest, approvalExpiresAt, documentationObjectives: [...objectives].sort(), evidenceIds: [...evidenceIds].sort() };
  return { ...contractCore, approvalArtifact, approvalDigest, refreshDigest: digest(contractCore), executionDigest: buildKnownOperationExecutionDigest(recipe) };
}

export function evaluateKnownOperationRefreshEvidence({ actionResults = [], apiRecords = [], plan }) {
  if (!plan) return null;
  const actionResultByIndex = new Map(actionResults
    .filter((entry) => Number.isInteger(entry?.actionIndex ?? entry?.index))
    .map((entry) => [entry.actionIndex ?? entry.index, entry]));
  const successfulActions = new Set(plan.actionBindings.flatMap((binding) => {
    const entry = actionResultByIndex.get(binding.index);
    if (!entry || entry.type !== binding.type || entry.error || entry.result?.error) return [];
    if (binding.type === "capture") return entry.result?.capturedOnly === true ? [binding.index] : [];
    if (binding.type === "wait-ms") return Number(entry.result?.waitedMs) > 0 ? [binding.index] : [];
    return actionResultSucceeded(entry) ? [binding.index] : [];
  }));
  const missingActionIndexes = plan.actionIndexes.filter((index) => !successfulActions.has(index));
  const matchedRecords = apiRecords.filter((record) => {
    let host = String(record?.host ?? "").toLowerCase();
    let pathname = String(record?.path ?? record?.pathname ?? "");
    if ((!host || !pathname) && record?.url) {
      try { const parsed = new URL(record.url); host ||= parsed.hostname.toLowerCase(); pathname ||= parsed.pathname; } catch { return false; }
    }
    const index = record?.attribution?.actionIndex ?? record?.actionIndex;
    const persistedQueryMatch = plan.persistedQuerySha256Hashes.length > 0
      && plan.persistedQuerySha256Hashes.includes(String(record?.graphQlPersistedQuerySha256Hash ?? ""));
    const literalQueryMatch = plan.literalQuerySha256Hashes.length > 0
      && plan.literalQuerySha256Hashes.includes(String(record?.graphQlLiteralQuerySha256Hash ?? ""))
      && record?.graphQlOperationKind === plan.operationKind;
    const graphQlBindingMatch = plan.operationKind !== "query" || persistedQueryMatch || literalQueryMatch;
    return String(record?.method ?? "").toUpperCase() === plan.method
      && host === plan.host
      && plan.routes.includes(pathname)
      && (plan.operationNames.length === 0 || plan.operationNames.includes(String(record?.graphQlOperationName ?? "")))
      && graphQlBindingMatch
      && Number.isInteger(index)
      && index >= 0
      && plan.actionIndexes.includes(index);
  });
  const populated = value => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.some(populated);
    if (value && typeof value === "object") return Object.values(value).some(populated);
    if (typeof value === "number") return value !== 0;
    return value === true;
  };
  const graphQlErrorRecords = matchedRecords.filter((record) => {
    if (plan.operationKind !== "query" || typeof record?.responseBodyForAnalysis !== "string") return false;
    try {
      const parsed = JSON.parse(record.responseBodyForAnalysis);
      return Array.isArray(parsed?.errors) && parsed.errors.length > 0;
    } catch {
      return false;
    }
  });
  const unverifiedGraphQlRecords = matchedRecords.filter((record) => {
    if (plan.operationKind !== "query") return false;
    if (record?.bodyCapture?.state !== "complete" || !sha256Pattern.test(String(record?.bodyCapture?.sha256 ?? "")) || typeof record?.responseBodyForAnalysis !== "string") return true;
    try {
      const parsed = JSON.parse(record.responseBodyForAnalysis);
      return !parsed || typeof parsed !== "object"
        || (parsed.errors != null && !Array.isArray(parsed.errors))
        || (!("data" in parsed) && !(Array.isArray(parsed.errors) && parsed.errors.length > 0));
    } catch {
      return true;
    }
  });
  // A 2xx transport alone is not evidence of usable API health.
  const transport2xxRecords = matchedRecords.filter(record => Number(record?.status) >= 200 && Number(record?.status) < 300);
  const restBody = record => {
    if (record?.bodyCapture?.state !== "complete"
        || !sha256Pattern.test(String(record?.bodyCapture?.sha256 ?? ""))
        || typeof record?.responseBodyForAnalysis !== "string"
        || !record.responseBodyForAnalysis.trim()) return { usable: false, logicalError: false };
    try {
      const parsed = JSON.parse(record.responseBodyForAnalysis);
      if (parsed === null) return { usable: false, logicalError: false };
      const entries = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.entries(parsed) : [];
      const logicalError = entries.some(([key, value]) => {
        const name = key.toLowerCase();
        if (["error", "errors", "errormessage"].includes(name)) return populated(value);
        if (name !== "errordata" || !value || typeof value !== "object" || Array.isArray(value)) return false;
        return Object.entries(value).some(([field, text]) => ["errormessage", "errortype", "exceptionname"].includes(field.toLowerCase())
          && typeof text === "string" && text.trim().length > 0);
      });
      return { usable: true, logicalError };
    } catch {
      return { usable: false, logicalError: false };
    }
  };
  const unverifiedRestRecords = plan.operationKind === "query" ? [] : transport2xxRecords.filter(record => !restBody(record).usable);
  const restErrorRecords = plan.operationKind === "query" ? [] : transport2xxRecords.filter(record => restBody(record).logicalError);
  const unverifiedRestSet = new Set(unverifiedRestRecords);
  const restErrorSet = new Set(restErrorRecords);
  const graphQlErrorRecordSet = new Set(graphQlErrorRecords);
  const unverifiedGraphQlRecordSet = new Set(unverifiedGraphQlRecords);
  const successfulRecords = transport2xxRecords.filter(record => !graphQlErrorRecordSet.has(record)
    && !unverifiedGraphQlRecordSet.has(record) && !unverifiedRestSet.has(record) && !restErrorSet.has(record));
  const completeRecords = successfulRecords.filter((record) => record?.bodyCapture?.state === "complete" && sha256Pattern.test(String(record?.bodyCapture?.sha256 ?? "")) && typeof record?.responseBodyForAnalysis === "string");
  const httpErrorRecords = matchedRecords.filter(record => Number(record?.status) >= 400);
  const incompleteWriteRecords = matchedRecords.filter((record) => record?.bodyCapture?.state === "incomplete-write");
  const observedStatuses = Array.from(new Set(matchedRecords.map((record) => Number(record?.status)).filter(Number.isInteger))).sort((left, right) => left - right);
  const lastSuccessfulObservationAt = successfulRecords
    .map((record) => String(record?.observedAt ?? record?.capturedAt ?? record?.timestamp ?? ""))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
  const status = missingActionIndexes.length > 0
    ? "action-accounting-incomplete"
    : matchedRecords.length === 0
      ? "no-target-signal"
      : incompleteWriteRecords.length > 0 || unverifiedGraphQlRecords.length > 0 || unverifiedRestRecords.length > 0
        ? "capture-incomplete"
        : graphQlErrorRecords.length > 0 || restErrorRecords.length > 0 || httpErrorRecords.length > 0 || successfulRecords.length === 0
          ? "error-observed"
          : "observed";
  return {
    schemaVersion: 1,
    kind: plan.kind,
    refreshDigest: plan.refreshDigest,
    status,
    missingActionIndexes,
    matchedRecordCount: matchedRecords.length,
    transport2xxRecordCount: transport2xxRecords.length,
    successfulRecordCount: successfulRecords.length,
    completeBodyRecordCount: completeRecords.length,
    incompleteWriteRecordCount: incompleteWriteRecords.length,
    health: {
      status: missingActionIndexes.length > 0 || incompleteWriteRecords.length > 0 || unverifiedGraphQlRecords.length > 0 || unverifiedRestRecords.length > 0
        ? "incomplete"
        : graphQlErrorRecords.length > 0 || restErrorRecords.length > 0 || httpErrorRecords.length > 0
          ? "error-observed"
          : successfulRecords.length > 0
          ? "healthy-observed"
          : matchedRecords.length > 0
            ? "error-observed"
            : "unknown",
      observedStatuses,
      graphQlErrorRecordCount: graphQlErrorRecords.length,
      restLogicalErrorRecordCount: restErrorRecords.length,
      httpErrorRecordCount: httpErrorRecords.length,
      unverifiedRestRecordCount: unverifiedRestRecords.length,
      unverifiedGraphQlRecordCount: unverifiedGraphQlRecords.length,
      lastSuccessfulObservationAt,
    },
    evidenceAxes: { freshness: matchedRecords.length > 0 ? "observed" : "gap", discovery: matchedRecords.length > 0 ? "observed" : "unknown", schema: completeRecords.length > 0 ? "observed" : "unknown", usage: successfulRecords.length > 0 ? "observed" : "unknown" },
  };
}

export function validateRepresentativeStateMatrix(value, { actions = [] } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("representativeStates must be an array.");
  const seen = new Set();
  return value.map((entry, index) => {
    const label = `representativeStates[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object.`);
    const id = String(entry.id ?? "").trim();
    const kind = String(entry.kind ?? "").trim();
    const evidenceId = String(entry.evidenceId ?? "").trim();
    const page = String(entry.page ?? "").trim();
    const target = String(entry.target ?? "").trim();
    const prerequisite = String(entry.prerequisite ?? "").trim();
    const actionIndex = Number(entry.actionIndex);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || seen.has(id)) fail(`${label}.id must be unique kebab-case.`);
    seen.add(id);
    if (!stateKinds.has(kind) || !evidenceId || !page || !target || !prerequisite) fail(`${label} requires a supported kind and exact evidence/page/target/prerequisite.`);
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= actions.length) fail(`${label}.actionIndex must reference a recipe action.`);
    if (kind === "populated" && entry.emptyEvidence === true) fail(`${label} cannot infer a populated state from empty evidence.`);
    return { id, kind, evidenceId, page, target, prerequisite, actionIndex, ...(entry.emptyEvidence === true ? { emptyEvidence: true } : {}) };
  });
}

export function evaluateEvidenceAxes(recipe, { verifiedEvidence = [] } = {}) {
  const explicit = recipe?.evidenceAxes;
  if (explicit !== undefined) {
    if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) fail("evidenceAxes must be an object.");
    const blocked = recipe?.capturePrerequisite?.status === "blocked";
    if (!Array.isArray(verifiedEvidence)) fail("verifiedEvidence must be an array.");
    const verified = new Set(verifiedEvidence.map((entry, index) => {
      const evidenceId = String(entry?.evidenceId ?? "").trim();
      const artifactSha256 = String(entry?.artifactSha256 ?? "").trim();
      const reviewDigest = String(entry?.reviewDigest ?? "").trim();
      if (!evidenceId || !sha256Pattern.test(artifactSha256) || !sha256Pattern.test(reviewDigest)) fail(`verifiedEvidence[${index}] must bind an evidence ID to immutable artifact and accepted-review SHA-256 digests.`);
      return evidenceId;
    }));
    if (verified.size !== verifiedEvidence.length) fail("verifiedEvidence evidence IDs must be unique.");
    const successStates = new Set(["satisfied", "observed", "execution-tested", "derived-current"]);
    const axes = {};
    for (const name of ["freshness", "discovery", "schema", "usage"]) {
      const claimedStatus = String(explicit[name]?.status ?? explicit[name] ?? "unknown");
      if (!axisStates.has(claimedStatus)) fail(`evidenceAxes.${name} has an unsupported status.`);
      const evidenceIds = cleanStrings(explicit[name]?.evidenceIds ?? [], `evidenceAxes.${name}.evidenceIds`, { allowEmpty: true });
      const claimVerified = evidenceIds.length > 0 && evidenceIds.every((evidenceId) => verified.has(evidenceId));
      const status = blocked
        ? "blocked"
        : successStates.has(claimedStatus) && !claimVerified
          ? "unknown"
          : claimedStatus;
      axes[name] = {
        status,
        evidenceIds,
        ...(status !== claimedStatus ? { claimedStatus, verification: blocked ? "blocked-prerequisite-precedence" : "unverified" } : { verification: claimVerified ? "verified" : "not-required" }),
      };
    }
    return axes;
  }
  const blocked = recipe?.capturePrerequisite?.status === "blocked";
  return {
    freshness: { status: blocked ? "blocked" : recipe?.noveltyStatus?.evidenceDisposition === "capture-freshness-gap" ? "gap" : "unknown", evidenceIds: [] },
    discovery: { status: blocked ? "blocked" : recipe?.noveltyFrontier ? "active" : "unknown", evidenceIds: [] },
    schema: { status: blocked ? "blocked" : "unknown", evidenceIds: [] },
    usage: { status: blocked ? "blocked" : "unknown", evidenceIds: [] },
  };
}

export function buildReviewPacket({ evidence = [], diff = [], scope, policy = [], model, reasoning }) {
  const bindings = { evidence: [...evidence].sort(), diff: [...diff].sort(), scope, policy: [...policy].sort(), model, reasoning };
  const packet = { schemaVersion: 1, bindings, rawPortalDataIncluded: false };
  return { ...packet, cacheKey: digest(packet), packetDigest: digest({ ...packet, purpose: "immutable-review" }) };
}

export function validateReviewPacket(packet) {
  if (!packet || packet.schemaVersion !== 1 || packet.rawPortalDataIncluded !== false || !packet.bindings) fail("review packet schema or privacy boundary is invalid.");
  const rebuilt = buildReviewPacket(packet.bindings);
  if (packet.cacheKey !== rebuilt.cacheKey || packet.packetDigest !== rebuilt.packetDigest) fail("review packet digest binding mismatch.");
  return rebuilt;
}
