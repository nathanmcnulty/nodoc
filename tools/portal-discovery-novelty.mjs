import { createHash } from "node:crypto";

import { actionResultSucceeded } from "./discovery-capture-policy.mjs";

const evidenceLevels = new Set(["confirmed", "probed", "bundle-discovered", "hypothesis"]);
const informationClasses = new Set([
  "new-host-family",
  "new-route-family",
  "request-shape",
  "response-shape",
  "query-metadata",
  "response-metadata",
]);
const documentationObjectives = new Set([
  "error-example",
  "pagination-observation",
  "request-example",
  "response-example",
]);
const interactiveActionTypes = new Set([
  "click",
  "click-automation-id",
  "click-contains",
  "click-href",
  "click-label",
  "crawl-links",
  "navigate",
  "probe-get",
  "reload",
  "replay-seeded-links",
  "replay-seeded-routes",
]);
const stableJson = (value) => `${JSON.stringify(value)}\n`;
const noveltyDigest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");

function routePattern(pathname) {
  const escaped = String(pathname).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\{[^/{}]+\\\}/gu, "[^/]+")}/?$`, "u");
}

function routePrefixMatches(pathname, prefix) {
  const normalizedPath = String(pathname || "").replace(/\/+$/u, "") || "/";
  const normalizedPrefix = String(prefix || "").replace(/\/+$/u, "") || "/";
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function schemaIsInformative(schema) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.example !== undefined || Array.isArray(schema.enum) || schema.const !== undefined) return true;
  if (["oneOf", "anyOf", "allOf"].some((key) => Array.isArray(schema[key]) && schema[key].some(schemaIsInformative))) return true;
  if (schema.type === "array") return schemaIsInformative(schema.items);
  if (schema.type === "object" || schema.properties || schema.additionalProperties !== undefined) {
    return Object.keys(schema.properties ?? {}).length > 0
      || (schema.additionalProperties && schema.additionalProperties !== true && schemaIsInformative(schema.additionalProperties));
  }
  return Boolean(schema.type || schema.format);
}

function mediaIsInformative(media) {
  return Boolean(media && (
    media.example !== undefined
    || (media.examples && Object.keys(media.examples).length > 0)
    || schemaIsInformative(media.schema)
  ));
}

function mediaHasExample(media) {
  return Boolean(media && (
    media.example !== undefined
    || (media.examples && Object.keys(media.examples).length > 0)
    || media.schema?.example !== undefined
    || (media.schema?.examples && Object.keys(media.schema.examples).length > 0)
  ));
}

function serverHosts(servers) {
  return [...new Set((servers ?? []).flatMap((server) => {
    try {
      return [new URL(String(server?.url || "").replace(/\{[^{}]+\}/gu, "server-variable")).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }))].sort();
}

function serverBindings(servers) {
  const bindings = (servers ?? []).flatMap((server) => {
    try {
      const parsed = new URL(String(server?.url || "").replace(/\{[^{}]+\}/gu, "server-variable"));
      return [{
        basePath: parsed.pathname.replace(/\/+$/u, "") || "/",
        host: parsed.hostname.toLowerCase(),
      }];
    } catch {
      return [];
    }
  });
  return [...new Map(bindings.map((binding) => [`${binding.host} ${binding.basePath}`, binding])).values()]
    .sort((left, right) => `${left.host} ${left.basePath}`.localeCompare(`${right.host} ${right.basePath}`));
}

function runtimeOperationPath(basePath, operationPath) {
  const normalizedBase = String(basePath || "/").replace(/\/+$/u, "") || "/";
  const normalizedOperation = String(operationPath || "/").startsWith("/")
    ? String(operationPath || "/")
    : `/${operationPath}`;
  return normalizedBase === "/" ? normalizedOperation : `${normalizedBase}${normalizedOperation}`;
}

export function deriveNoveltyBaseline(specification) {
  const rootServers = specification?.servers ?? [];
  const rootSecurity = specification?.security;
  const operations = [];
  for (const [pathname, pathItem] of Object.entries(specification?.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!/^(get|head|options|post|put|patch|delete)$/u.test(method) || !operation || typeof operation !== "object") continue;
      const servers = operation.servers ?? pathItem.servers ?? rootServers;
      const hosts = serverHosts(servers);
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
      const queryParameterNames = [...new Set(parameters
        .filter((parameter) => parameter?.in === "query" && typeof parameter.name === "string")
        .map((parameter) => parameter.name))].sort();
      const successfulResponses = Object.entries(operation.responses ?? {})
        .filter(([status]) => status === "default" || /^2\d\d$/u.test(status));
      const responseContentTypes = [...new Set(successfulResponses.flatMap(([, response]) => Object.keys(response?.content ?? {})))].sort();
      const responseStatuses = successfulResponses.map(([status]) => status).sort();
      const responseSchemaDocumented = successfulResponses.some(([, response]) => Object.values(response?.content ?? {}).some(mediaIsInformative));
      const responseExampleDocumented = successfulResponses.some(([, response]) => Object.values(response?.content ?? {}).some(mediaHasExample));
      const errorResponses = Object.entries(operation.responses ?? {}).filter(([status]) => /^[45]\d\d$/u.test(status));
      const requestMedia = Object.values(operation.requestBody?.content ?? {});
      const requestContentTypes = Object.keys(operation.requestBody?.content ?? {}).sort();
      const requestSchemaDocumented = requestMedia.length === 0 || requestMedia.some(mediaIsInformative);
      const operationContext = operation["x-nodoc-operation-context"] ?? null;
      const parameterExamplesDocumented = parameters.filter((parameter) => (
        parameter?.example !== undefined
        || (parameter?.examples && Object.keys(parameter.examples).length > 0)
        || parameter?.schema?.example !== undefined
        || (parameter?.schema?.examples && Object.keys(parameter.schema.examples).length > 0)
      )).map((parameter) => `${parameter.in}:${parameter.name}`).sort();
      const listLike = method === "get" && (
        /^List(?:\.|[A-Z])/u.test(String(operation.operationId ?? ""))
        || /^list\b/iu.test(String(operation.summary ?? ""))
      );
      const paginationDocumented = parameters.some((parameter) => (
        parameter?.in === "query"
        && /^(?:\$?top|\$?skip|cursor|continuation(?:token)?|limit|offset|page(?:size|token)?)$/iu.test(String(parameter.name ?? ""))
      )) || Boolean(operationContext?.pagination);
      operations.push({
        hosts,
        method: method.toUpperCase(),
        path: pathname,
        listLike,
        operationContextFields: operationContext && typeof operationContext === "object"
          ? Object.keys(operationContext).sort()
          : [],
        paginationDocumented,
        parameterCount: parameters.length,
        parameterExamplesDocumented,
        permissionsDocumented: operation.security !== undefined
          || rootSecurity !== undefined
          || Boolean(operationContext?.authProfile)
          || Array.isArray(operationContext?.permissions),
        queryParameterNames,
        requestContentTypes,
        requestExampleDocumented: requestMedia.some(mediaHasExample),
        requestSchemaDocumented,
        responseContentTypes,
        responseExampleDocumented,
        responseSchemaDocumented,
        responseStatuses,
        errorExampleDocumented: errorResponses.some(([, response]) => Object.values(response?.content ?? {}).some(mediaHasExample)),
        errorResponseStatuses: errorResponses.map(([status]) => status).sort(),
        serverBindings: serverBindings(servers),
      });
    }
  }
  return {
    source: "checked-in-openapi",
    operations: operations.sort((left, right) => `${left.hosts.join(",")} ${left.method} ${left.path}`.localeCompare(`${right.hosts.join(",")} ${right.method} ${right.path}`)),
  };
}

function actionDescriptor(action) {
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    const rawType = separator > 0 ? action.slice(0, separator) : action;
    return {
      type: rawType.replace(/-(root|iframe)$/u, ""),
      value: separator > 0 ? action.slice(separator + 1) : "",
    };
  }
  return {
    type: String(action?.type || ""),
    value: String(action?.value ?? ""),
  };
}

function fail(message) {
  const error = new Error(message);
  error.code = "novelty-frontier-invalid";
  error.blocker = {
    remediation: "Add concrete frontier targets tied to safe deterministic recipe actions before allocating browser or ledger work.",
  };
  throw error;
}

function uniqueStrings(values, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  }
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) fail(`${label} must contain non-empty strings.`);
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates.`);
  return normalized;
}

export function buildNoveltyPlan(recipe, { required = false, derivedBaseline = null } = {}) {
  const frontier = recipe?.noveltyFrontier;
  if (!frontier) {
    const noveltyStatus = recipe?.noveltyStatus;
    if (noveltyStatus !== undefined) {
      if (!noveltyStatus || typeof noveltyStatus !== "object" || Array.isArray(noveltyStatus)) {
        fail("noveltyStatus must be an object.");
      }
      if (noveltyStatus.status !== "satisfied") {
        fail("noveltyStatus.status must be satisfied when no noveltyFrontier is declared.");
      }
      for (const key of ["reason", "nextRequirement"]) {
        if (typeof noveltyStatus[key] !== "string" || !noveltyStatus[key].trim()) {
          fail(`noveltyStatus.${key} must be a non-empty string.`);
        }
      }
      const evidenceDispositions = new Set([
        "capture-freshness-gap",
        "frontier-exhausted",
        "missing-immutable-state-provenance",
      ]);
      if (noveltyStatus.evidenceDisposition !== undefined
        && !evidenceDispositions.has(noveltyStatus.evidenceDisposition)) {
        fail("noveltyStatus.evidenceDisposition must be capture-freshness-gap, frontier-exhausted, or missing-immutable-state-provenance.");
      }
    }
    if (required) {
      fail(noveltyStatus?.status === "satisfied"
        ? `selected recipe's prior novelty frontier is satisfied; ${noveltyStatus.nextRequirement}`
        : "selected recipe does not declare noveltyFrontier metadata.");
    }
    return null;
  }
  if (!frontier || typeof frontier !== "object" || Array.isArray(frontier)) {
    fail("noveltyFrontier must be an object.");
  }
  if (!Array.isArray(frontier.targets) || frontier.targets.length === 0) {
    fail("noveltyFrontier.targets must contain at least one target.");
  }
  if (!frontier.baselineSignals || typeof frontier.baselineSignals !== "object" || Array.isArray(frontier.baselineSignals)) {
    fail("noveltyFrontier.baselineSignals must explicitly snapshot the checked-in evidence baseline.");
  }
  if (typeof frontier.reopenCondition !== "string" || !frontier.reopenCondition.trim()) {
    fail("noveltyFrontier.reopenCondition must describe the exact new state or evidence gap that reopened capture.");
  }
  if (!/^[a-f0-9]{64}$/u.test(String(frontier.approvalDigest || ""))) {
    fail("noveltyFrontier.approvalDigest must be an immutable SHA-256 approval digest.");
  }
  const baselineSignals = Object.fromEntries([
    "queryMetadata",
    "requestShapes",
    "responseMetadata",
    "responseShapes",
    "routes",
  ].map((key) => [key, uniqueStrings(
    frontier.baselineSignals[key] ?? [],
    `noveltyFrontier.baselineSignals.${key}`,
    { allowEmpty: true },
  )]));
  if (required && !Array.isArray(derivedBaseline?.operations)) {
    fail("required novelty planning must derive its baseline from the checked-in specification.");
  }

  const actions = Array.isArray(recipe.actions) ? recipe.actions.map(actionDescriptor) : [];
  const seenIds = new Set();
  const targetedIndexes = new Set();
  const targets = frontier.targets.map((target, targetIndex) => {
    const context = `noveltyFrontier.targets[${targetIndex}]`;
    if (!target || typeof target !== "object" || Array.isArray(target)) fail(`${context} must be an object.`);
    const id = String(target.id || "").trim();
    const state = String(target.state || "").trim();
    const rationale = String(target.rationale || "").trim();
    const safeAction = String(target.safeAction || "").trim();
    const acceptanceKey = String(target.acceptanceKey || "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) fail(`${context}.id must be a stable kebab-case identifier.`);
    if (seenIds.has(id)) fail(`${context}.id must be unique.`);
    seenIds.add(id);
    if (!state || !rationale || !safeAction || !acceptanceKey) {
      fail(`${context} must include state, rationale, safeAction, and acceptanceKey.`);
    }
    if (!evidenceLevels.has(target.evidenceLevel)) fail(`${context}.evidenceLevel is unsupported.`);

    const expectedHostFamilies = uniqueStrings(target.expectedHostFamilies, `${context}.expectedHostFamilies`)
      .map((host) => host.toLowerCase());
    if (expectedHostFamilies.some((host) => host.includes("://") || host.includes("/") || host.includes("@"))) {
      fail(`${context}.expectedHostFamilies must contain hostnames only.`);
    }
    const expectedRoutePrefixes = uniqueStrings(target.expectedRoutePrefixes ?? [], `${context}.expectedRoutePrefixes`, { allowEmpty: true });
    if (expectedRoutePrefixes.some((prefix) => !prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#"))) {
      fail(`${context}.expectedRoutePrefixes must contain clean absolute path prefixes.`);
    }
    const expectedRoutes = uniqueStrings(target.expectedRoutes ?? [], `${context}.expectedRoutes`, { allowEmpty: true });
    if (expectedRoutes.some((route) => !route.startsWith("/") || route.includes("?") || route.includes("#"))) {
      fail(`${context}.expectedRoutes must contain clean absolute paths.`);
    }
    if (expectedRoutePrefixes.length === 0 && expectedRoutes.length === 0) {
      fail(`${context} must declare expectedRoutes or expectedRoutePrefixes.`);
    }
    const expectedInformationClasses = uniqueStrings(
      target.expectedInformationClasses,
      `${context}.expectedInformationClasses`,
    );
    if (expectedInformationClasses.some((value) => !informationClasses.has(value))) {
      fail(`${context}.expectedInformationClasses contains an unsupported class.`);
    }
    const expectedDocumentationObjectives = uniqueStrings(
      target.expectedDocumentationObjectives ?? [],
      `${context}.expectedDocumentationObjectives`,
      { allowEmpty: true },
    );
    if (expectedDocumentationObjectives.some((value) => !documentationObjectives.has(value))) {
      fail(`${context}.expectedDocumentationObjectives contains an unsupported objective.`);
    }
    const objectiveClasses = {
      "error-example": ["response-metadata", "response-shape"],
      "pagination-observation": ["query-metadata", "response-shape"],
      "request-example": ["request-shape"],
      "response-example": ["response-shape"],
    };
    if (expectedDocumentationObjectives.some((objective) => (
      !objectiveClasses[objective].some((value) => expectedInformationClasses.includes(value))
    ))) {
      fail(`${context}.expectedDocumentationObjectives must be backed by a compatible expectedInformationClasses entry.`);
    }

    if (!Array.isArray(target.actionIndexes) || target.actionIndexes.length === 0) {
      fail(`${context}.actionIndexes must be a non-empty array.`);
    }
    const actionIndexes = target.actionIndexes.map((value) => Number(value));
    if (actionIndexes.some((value) => !Number.isInteger(value) || value < 0 || value >= actions.length)) {
      fail(`${context}.actionIndexes contains an out-of-range action index.`);
    }
    if (new Set(actionIndexes).size !== actionIndexes.length) fail(`${context}.actionIndexes must not contain duplicates.`);
    if (!actionIndexes.some((index) => interactiveActionTypes.has(actions[index].type))) {
      fail(`${context}.actionIndexes must include a safe interactive action.`);
    }
    if (!actionIndexes.some((index) => actions[index].type === "capture")) {
      fail(`${context}.actionIndexes must include a capture checkpoint.`);
    }
    actionIndexes.forEach((index) => targetedIndexes.add(index));

    return {
      acceptanceKey,
      actionIndexes: [...actionIndexes].sort((left, right) => left - right),
      evidenceLevel: target.evidenceLevel,
      expectedHostFamilies,
      expectedDocumentationObjectives,
      expectedInformationClasses,
      expectedRoutePrefixes,
      expectedRoutes,
      id,
      rationale,
      safeAction,
      state,
    };
  });

  const classifications = actions.map((action, index) => ({
    index,
    type: action.type,
    value: action.value,
    classification: targetedIndexes.has(index) ? "frontier-targeted" : "known-replay",
  }));
  let frontierControlReadiness = null;
  if (recipe.frontierControlReadiness !== undefined) {
    const readiness = recipe.frontierControlReadiness;
    if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) {
      fail("frontierControlReadiness must be an object.");
    }
    if (!Array.isArray(readiness.actionIndexes) || readiness.actionIndexes.length === 0) {
      fail("frontierControlReadiness.actionIndexes must be a non-empty array.");
    }
    const actionIndexes = readiness.actionIndexes.map(Number);
    if (new Set(actionIndexes).size !== actionIndexes.length) {
      fail("frontierControlReadiness.actionIndexes must not contain duplicates.");
    }
    if (actionIndexes.some((index) => (
      !Number.isInteger(index)
      || !targetedIndexes.has(index)
      || !String(actions[index]?.type || "").startsWith("click")
    ))) {
      fail("frontierControlReadiness.actionIndexes must reference frontier-targeted click actions.");
    }
    const timeoutMs = Number(readiness.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      fail("frontierControlReadiness.timeoutMs must be a positive number.");
    }
    frontierControlReadiness = {
      actionIndexes: [...actionIndexes].sort((left, right) => left - right),
      timeoutMs,
    };
  }
  const targetedClickIndexes = [...targetedIndexes]
    .filter((index) => String(actions[index]?.type || "").startsWith("click"))
    .sort((left, right) => left - right);
  if (targetedClickIndexes.length > 0 && !frontierControlReadiness) {
    fail("frontierControlReadiness is required for click-driven novelty targets.");
  }
  if (frontierControlReadiness
    && targetedClickIndexes.some((index) => !frontierControlReadiness.actionIndexes.includes(index))) {
    fail("frontierControlReadiness.actionIndexes must cover every frontier-targeted click action.");
  }
  const planCore = {
    schemaVersion: 1,
    approvalDigest: frontier.approvalDigest,
    baseline: String(frontier.baseline || "checked-in-spec-and-coverage-ledgers"),
    baselineSignals: {
      ...baselineSignals,
      derivedOperationCount: derivedBaseline?.operations?.length ?? 0,
      source: derivedBaseline?.source ?? "recipe-overlay-only",
    },
    targets,
    reopenCondition: frontier.reopenCondition.trim(),
    ...(frontierControlReadiness ? { frontierControlReadiness } : {}),
    actions: [{
      index: -1,
      type: "navigate",
      value: String(recipe.url || ""),
      classification: "mandatory-orchestration",
    }, ...classifications],
    measurements: {
      actionCount: actions.length,
      frontierTargetCount: targets.length,
      frontierTargetedActionCount: targetedIndexes.size,
      frontierTargetedActionShare: actions.length === 0 ? 0 : targetedIndexes.size / actions.length,
      mandatoryOrchestrationActionCount: 1,
    },
  };
  const plan = {
    ...planCore,
    frontierDigest: noveltyDigest(planCore),
  };
  Object.defineProperty(plan, "baselineOperations", {
    enumerable: false,
    value: derivedBaseline?.operations ?? [],
  });
  return plan;
}

function operationServerBindings(operation) {
  if (Array.isArray(operation?.serverBindings) && operation.serverBindings.length > 0) {
    return operation.serverBindings;
  }
  return (operation?.hosts ?? []).map((host) => ({ basePath: "/", host }));
}

function operationMatchesRecord(operation, hostname, method, pathname) {
  if (operation.method !== method) return false;
  return operationServerBindings(operation).some((binding) => binding.host === hostname
    && routePattern(runtimeOperationPath(binding.basePath, operation.path)).test(pathname));
}

function targetMatchesCanonicalOperation(target, operation) {
  return target.expectedHostFamilies.some((host) => operation.hosts.includes(host))
    && (target.expectedRoutes.includes(operation.path)
      || target.expectedRoutePrefixes.some((prefix) => routePrefixMatches(operation.path, prefix)));
}

function recordMatchesTarget(record, target, baselineOperations = []) {
  let hostname;
  try {
    hostname = new URL(record?.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const pathname = String(record?.path || "");
  if (!target.expectedHostFamilies.includes(hostname)) return false;
  if (target.expectedRoutes.includes(pathname)
    || target.expectedRoutePrefixes.some((prefix) => routePrefixMatches(pathname, prefix))) return true;
  const method = String(record?.method || "GET").toUpperCase();
  return baselineOperations.some((operation) => targetMatchesCanonicalOperation(target, operation)
    && operationMatchesRecord(operation, hostname, method, pathname));
}

function candidateHostnames(candidate) {
  const values = [candidate?.hostFamily, ...(candidate?.baseUrls ?? [])];
  return values.flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(value).hostname.toLowerCase()];
    } catch {
      return [String(value).toLowerCase()];
    }
  });
}

function candidateMatchesTarget(candidate, target) {
  if (!["undocumented", "path-documented-missing-method"].includes(candidate?.documentationStatus)) return false;
  return candidateHostnames(candidate).some((hostname) => target.expectedHostFamilies.includes(hostname))
    && (target.expectedRoutes.includes(candidate?.normalizedPath)
      || target.expectedRoutePrefixes.some((prefix) => routePrefixMatches(candidate?.normalizedPath, prefix)));
}

function candidateLists(candidateHandoff) {
  return [
    candidateHandoff?.adjacentBundleOnlyCandidates,
    candidateHandoff?.adjacentConfirmedReadCandidates,
    candidateHandoff?.adjacentConfirmedSafetyReviewCandidates,
    candidateHandoff?.adjacentSuccessfullyProbedCandidates,
    candidateHandoff?.bundleOnlyCandidates,
    candidateHandoff?.confirmedReadCandidates,
    candidateHandoff?.confirmedSafetyReviewCandidates,
    candidateHandoff?.successfullyProbedCandidates,
  ].flatMap((list) => Array.isArray(list) ? list : []);
}

function recordHostname(record) {
  try {
    return new URL(record?.url).hostname.toLowerCase();
  } catch {
    return "unknown-host";
  }
}

function recordBelongsToTarget(record, target, targetPages) {
  const actionIndex = record?.attribution?.actionIndex;
  if (Number.isInteger(actionIndex)) return target.actionIndexes.includes(actionIndex);
  return (record?.seenOnPages ?? []).some((page) => targetPages.has(page));
}

function hasInformativeResponseShape(record) {
  if (!record?.responseShapeFingerprint || typeof record?.responseBodySample !== "string") return false;
  const sample = record.responseBodySample.trim();
  if (!sample) return false;
  try {
    const parsed = JSON.parse(sample);
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length > 0;
    return parsed !== null && parsed !== "";
  } catch {
    return true;
  }
}

function structuralShape(value, depth = 0) {
  if (depth > 10) return "truncated";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const shapes = [...new Set(value.slice(0, 20).map((item) => JSON.stringify(structuralShape(item, depth + 1))))].sort();
    return { array: shapes.map((item) => JSON.parse(item)) };
  }
  if (typeof value === "object") {
    const entries = [];
    let dynamic = false;
    for (const key of Object.keys(value).sort().slice(0, 128)) {
      if (key.length > 128
        || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(key)
        || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(key)
        || /\.onmicrosoft\.com/iu.test(key)) {
        dynamic = true;
        continue;
      }
      entries.push([key, structuralShape(value[key], depth + 1)]);
    }
    if (dynamic) entries.push(["{dynamicProperty}", "unknown"]);
    return Object.fromEntries(entries);
  }
  return typeof value;
}

function responseShapeFingerprint(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return createHash("sha256").update(JSON.stringify(structuralShape(JSON.parse(value)))).digest("hex");
  } catch {
    return createHash("sha256").update("non-json:string").digest("hex");
  }
}

function probeActionRecords(actionResults) {
  return actionResults.flatMap((actionResult) => {
    const result = actionResult?.result ?? {};
    const materializedOutcomes = new Set(["auth-blocked", "confirmed", "http-error", "not-found"]);
    if (actionResult?.type !== "probe-get"
      || !materializedOutcomes.has(result.outcome)
      || !Number.isInteger(result.status)
      || !result.url) return [];
    try {
      const parsed = new URL(result.url);
      return [{
        attribution: { actionIndex: actionResult.actionIndex },
        method: "GET",
        mimeType: String(result.contentType || "").split(";", 1)[0] || null,
        path: parsed.pathname,
        queryParameterNames: [...new Set(parsed.searchParams.keys())].sort(),
        responseBodySample: typeof result.body === "string" ? result.body : null,
        responseShapeFingerprint: responseShapeFingerprint(result.body),
        seenOnPages: actionResult.page ? [actionResult.page] : [],
        status: result.status ?? null,
        url: result.url,
      }];
    } catch {
      return [];
    }
  });
}

function hasInformativeRequestExample(record) {
  return (record?.requestBodySamples ?? []).some((sample) => (
    typeof sample === "string" && sample.trim() && sample.trim() !== "{}" && sample.trim() !== "[]"
  ));
}

function responseHasPaginationFields(record) {
  if (typeof record?.responseBodySample !== "string") return false;
  try {
    const parsed = JSON.parse(record.responseBodySample);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return Object.keys(parsed).some((key) => /^(?:@odata\.nextLink|next(?:Link|Cursor|PageToken)|continuationToken)$/iu.test(key));
  } catch {
    return false;
  }
}

function signalKey(record, property, normalizedPath = record?.path) {
  const hostname = recordHostname(record);
  const method = String(record?.method || "GET").toUpperCase();
  const pathname = String(normalizedPath || "");
  const value = String(record?.[property] || "");
  return value ? `${hostname} ${method} ${pathname} ${value}` : null;
}

function matchingBaselineOperation(record, operations) {
  const hostname = recordHostname(record);
  const method = String(record?.method || "GET").toUpperCase();
  const pathname = String(record?.path || "");
  return operations.find((operation) => operationMatchesRecord(operation, hostname, method, pathname)) ?? null;
}

export function evaluateNoveltyEvidence({ recipe, noveltyPlan = null, actionResults = [], apiRecords = [], candidateHandoff } = {}) {
  const plan = noveltyPlan ?? buildNoveltyPlan(recipe, { required: true });
  const known = Object.fromEntries(["queryMetadata", "requestShapes", "responseMetadata", "responseShapes", "routes"]
    .map((key) => [key, new Set(plan.baselineSignals[key] ?? [])]));
  const completedRecipeActionIndexes = new Set();
  const actionPages = new Map();
  const recipeActionResults = actionResults.filter((result) => (
    Number.isInteger(result?.actionIndex)
      ? result.actionIndex >= 0
      : !/^seed(?:-|$)/u.test(String(result?.page ?? ""))
  ));
  const indexedResultsAvailable = recipeActionResults.some((result) => Number.isInteger(result?.actionIndex));
  const evidenceRecords = [...apiRecords];
  for (const probeRecord of probeActionRecords(actionResults)) {
    const duplicate = evidenceRecords.some((record) => record?.url === probeRecord.url
      && record?.attribution?.actionIndex === probeRecord.attribution.actionIndex
      && record?.responseBodySample === probeRecord.responseBodySample);
    if (!duplicate) evidenceRecords.push(probeRecord);
  }
  let resultCursor = 0;
  for (const [index, action] of recipe.actions.entries()) {
    const expected = actionDescriptor(action);
    const traversedPages = [];
    const results = indexedResultsAvailable
      ? recipeActionResults.filter((result) => result.actionIndex === index)
      : recipeActionResults.slice(resultCursor);
    for (const actual of results) {
      if (!indexedResultsAvailable) resultCursor += 1;
      if (actual?.page) traversedPages.push(actual.page);
      if (actual?.type === expected.type && String(actual?.value ?? "") === expected.value) {
        if (actionResultSucceeded(actual)) completedRecipeActionIndexes.add(index);
        actionPages.set(index, traversedPages);
        break;
      }
    }
  }
  const targets = plan.targets.map((target) => {
    const attempted = target.actionIndexes.every((index) => completedRecipeActionIndexes.has(index));
    const targetPages = new Set(target.actionIndexes.flatMap((index) => actionPages.get(index) ?? []));
    const records = evidenceRecords.filter((record) => recordMatchesTarget(record, target, plan.baselineOperations)
      && recordBelongsToTarget(record, target, targetPages));
    const candidates = candidateLists(candidateHandoff).filter((candidate) => candidateMatchesTarget(candidate, target));
    const undocumentedRecords = records.filter((record) => candidates.some((candidate) => (
      candidateHostnames(candidate).includes(recordHostname(record))
      && String(candidate.method || "GET").toUpperCase() === String(record.method || "GET").toUpperCase()
      && routePattern(candidate.normalizedPath).test(String(record.path))
    )));
    const reviewableUndocumentedRecords = new Set(undocumentedRecords);
    const signalRecords = records.filter((record) => (
      matchingBaselineOperation(record, plan.baselineOperations)
      || reviewableUndocumentedRecords.has(record)
    ));
    const acceptedClasses = new Set(target.expectedInformationClasses);
    const baselineHosts = new Set(plan.baselineOperations.flatMap((operation) => operation.hosts));
    const routeSignals = acceptedClasses.has("new-route-family")
      ? Array.from(new Set(undocumentedRecords
        .map((record) => `${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${record.path}`)
        .filter((value) => !known.routes.has(value)))).sort()
      : [];
    const hostSignals = acceptedClasses.has("new-host-family")
      ? Array.from(new Set(undocumentedRecords.map(recordHostname).filter((hostname) => !baselineHosts.has(hostname)))).sort()
      : [];
    const responseShapeSignals = acceptedClasses.has("response-shape")
      ? Array.from(new Set(signalRecords.map((record) => {
        if (!hasInformativeResponseShape(record)) return null;
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        if (operation?.responseSchemaDocumented) return null;
        return signalKey(record, "responseShapeFingerprint", operation?.path ?? record.path);
      }).filter((value) => value && !known.responseShapes.has(value)))).sort()
      : [];
    const requestShapeSignals = acceptedClasses.has("request-shape")
      ? Array.from(new Set(signalRecords.map((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        if (operation?.requestSchemaDocumented) return null;
        return signalKey(record, "requestShapeFingerprint", operation?.path ?? record.path);
      }).filter((value) => value && !known.requestShapes.has(value)))).sort()
      : [];
    const queryMetadataSignals = acceptedClasses.has("query-metadata")
      ? Array.from(new Set(signalRecords.flatMap((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        const knownNames = new Set(operation?.queryParameterNames ?? []);
        return (record.queryParameterNames ?? [])
          .filter((name) => !knownNames.has(name))
          .map((name) => `${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation?.path ?? record.path} ${name}`);
      }).filter((value) => value && !known.queryMetadata.has(value)))).sort()
      : [];
    const responseMetadataSignals = acceptedClasses.has("response-metadata")
      ? Array.from(new Set(signalRecords.flatMap((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        const signals = [];
        if (record.mimeType && !operation?.responseContentTypes?.includes(record.mimeType)) {
          const signal = `${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation?.path ?? record.path} mime:${record.mimeType}`;
          if (!known.responseMetadata.has(signal)) signals.push(signal);
        }
        const status = String(record.status ?? "");
        if (status && !operation?.responseStatuses?.includes("default") && !operation?.responseStatuses?.includes(status)) {
          const signal = `${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation?.path ?? record.path} status:${status}`;
          if (!known.responseMetadata.has(signal)) signals.push(signal);
        }
        return signals;
      }))).sort()
      : [];
    const acceptedDocumentation = new Set(target.expectedDocumentationObjectives ?? []);
    const documentationSignals = Array.from(new Set(signalRecords.flatMap((record) => {
      const operation = matchingBaselineOperation(record, plan.baselineOperations);
      if (!operation) return [];
      const prefix = `${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation.path}`;
      const signals = [];
      if (acceptedDocumentation.has("response-example")
        && !operation.responseExampleDocumented
        && hasInformativeResponseShape(record)) signals.push(`${prefix} response-example`);
      if (acceptedDocumentation.has("request-example")
        && !operation.requestExampleDocumented
        && hasInformativeRequestExample(record)) signals.push(`${prefix} request-example`);
      if (acceptedDocumentation.has("error-example")
        && !operation.errorExampleDocumented
        && /^[45]/u.test(String(record.status ?? ""))
        && hasInformativeResponseShape(record)) signals.push(`${prefix} error-example:${record.status}`);
      if (acceptedDocumentation.has("pagination-observation")
        && operation.listLike
        && !operation.paginationDocumented
        && ((record.queryParameterNames ?? []).some((name) => /^(?:\$?top|\$?skip|cursor|continuation(?:token)?|limit|offset|page(?:size|token)?)$/iu.test(name))
          || responseHasPaginationFields(record))) signals.push(`${prefix} pagination-observation`);
      return signals;
    }))).sort();
    const materializedSignalCount = routeSignals.length
      + hostSignals.length
      + responseShapeSignals.length
      + requestShapeSignals.length
      + queryMetadataSignals.length
      + responseMetadataSignals.length
      + documentationSignals.length;
    const checkpointMetrics = target.actionIndexes
      .flatMap((index) => recipeActionResults.filter((result) => result.actionIndex === index))
      .map((result) => result.checkpointMetrics)
      .filter(Boolean);
    const countedActions = checkpointMetrics.reduce((total, entry) => total + (entry.countedActions ?? 0), 0);
    const elapsedMs = checkpointMetrics.reduce((total, entry) => total + (entry.elapsedMs ?? 0), 0);
    const readinessControls = checkpointMetrics.flatMap((entry) => entry.controlReadiness?.controls ?? []);
    const costYield = {
      bundleCacheHits: {
        memory: checkpointMetrics.reduce((total, entry) => total + (entry.bundleAnalysis?.cacheHits?.memory ?? 0), 0),
        persistent: checkpointMetrics.reduce((total, entry) => total + (entry.bundleAnalysis?.cacheHits?.persistent ?? 0), 0),
      },
      controlReadiness: {
        absent: readinessControls.filter((entry) => entry.status === "absent-not-applicable").length,
        ambiguous: readinessControls.filter((entry) => entry.status === "ambiguous").length,
        eligible: readinessControls.filter((entry) => entry.status === "present").length,
      },
      countedActions,
      elapsedMs,
      estimatedCostProxy: {
        kind: "non-financial-cardinality",
        value: checkpointMetrics.reduce((total, entry) => total + (entry.estimatedCostProxy?.value ?? 0), 0),
      },
      newCandidateFamilyCount: checkpointMetrics.reduce((total, entry) => total + (entry.newCandidateFamilyCount ?? 0), 0),
      newRequestFamilyCount: checkpointMetrics.reduce((total, entry) => total + (entry.newRequestFamilyCount ?? 0), 0),
      qualifyingNoveltySignals: materializedSignalCount,
      yieldPerAction: countedActions > 0 ? materializedSignalCount / countedActions : null,
      yieldPerMinute: elapsedMs > 0 ? materializedSignalCount / (elapsedMs / 60000) : null,
    };
    return {
      acceptanceKey: target.acceptanceKey,
      attempted,
      id: target.id,
      hostSignals,
      matchedRecordCount: records.length,
      materializedSignalCount,
      costYield,
      documentationSignals,
      queryMetadataSignals,
      requestShapeSignals,
      responseMetadataSignals,
      responseShapeSignals,
      routeSignals,
      state: target.state,
    };
  });
  const targetedSignals = targets.reduce((total, target) => total + target.materializedSignalCount, 0);
  const attemptedTargetCount = targets.filter((target) => target.attempted).length;
  const observedTargetCount = targets.filter((target) => target.matchedRecordCount > 0).length;
  const productiveTargetCount = targets.filter((target) => target.materializedSignalCount > 0).length;
  const requiredSignalCount = recipe.actions.length > 20 ? 3 : 1;
  const requiredProductiveTargets = recipe.actions.length > 20 ? 2 : 1;
  const complete = attemptedTargetCount === targets.length;
  const productive = complete
    && targetedSignals >= requiredSignalCount
    && productiveTargetCount >= requiredProductiveTargets;
  return {
    schemaVersion: 1,
    status: !complete
      ? "frontier-incomplete"
      : observedTargetCount === 0
        ? "no-target-signal"
        : productive
          ? "productive"
          : "no-novelty",
    targets,
    measurements: {
      attemptedTargetCount,
      observedTargetCount,
      plannedTargetCount: targets.length,
      productiveTargetCount,
      requiredProductiveTargets,
      requiredSignalCount,
      targetedShapeAndMetadataSignalCount: targetedSignals,
    },
  };
}

export const noveltyEvidenceLevels = [...evidenceLevels];
export const noveltyInformationClasses = [...informationClasses];
