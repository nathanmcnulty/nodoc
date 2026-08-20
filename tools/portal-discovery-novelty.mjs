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
const interactiveActionTypes = new Set([
  "click",
  "click-contains",
  "click-href",
  "click-label",
  "crawl-links",
  "navigate",
  "replay-seeded-links",
  "replay-seeded-routes",
]);

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

function serverHosts(servers) {
  return [...new Set((servers ?? []).flatMap((server) => {
    try {
      return [new URL(String(server?.url || "").replace(/\{[^{}]+\}/gu, "server-variable")).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }))].sort();
}

export function deriveNoveltyBaseline(specification) {
  const rootServers = specification?.servers ?? [];
  const operations = [];
  for (const [pathname, pathItem] of Object.entries(specification?.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!/^(get|head|options|post|put|patch|delete)$/u.test(method) || !operation || typeof operation !== "object") continue;
      const hosts = serverHosts(operation.servers ?? pathItem.servers ?? rootServers);
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
      const queryParameterNames = [...new Set(parameters
        .filter((parameter) => parameter?.in === "query" && typeof parameter.name === "string")
        .map((parameter) => parameter.name))].sort();
      const successfulResponses = Object.entries(operation.responses ?? {})
        .filter(([status]) => status === "default" || /^2\d\d$/u.test(status));
      const responseContentTypes = [...new Set(successfulResponses.flatMap(([, response]) => Object.keys(response?.content ?? {})))].sort();
      const responseStatuses = successfulResponses.map(([status]) => status).sort();
      const responseSchemaDocumented = successfulResponses.some(([, response]) => Object.values(response?.content ?? {}).some(mediaIsInformative));
      const requestMedia = Object.values(operation.requestBody?.content ?? {});
      const requestSchemaDocumented = requestMedia.length === 0 || requestMedia.some(mediaIsInformative);
      operations.push({
        hosts,
        method: method.toUpperCase(),
        path: pathname,
        queryParameterNames,
        requestSchemaDocumented,
        responseContentTypes,
        responseSchemaDocumented,
        responseStatuses,
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
  const baselineSignals = Object.fromEntries([
    "queryMetadata",
    "requestShapes",
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
    const expectedRoutePrefixes = uniqueStrings(target.expectedRoutePrefixes, `${context}.expectedRoutePrefixes`);
    if (expectedRoutePrefixes.some((prefix) => !prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#"))) {
      fail(`${context}.expectedRoutePrefixes must contain clean absolute path prefixes.`);
    }
    const expectedInformationClasses = uniqueStrings(
      target.expectedInformationClasses,
      `${context}.expectedInformationClasses`,
    );
    if (expectedInformationClasses.some((value) => !informationClasses.has(value))) {
      fail(`${context}.expectedInformationClasses contains an unsupported class.`);
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
      expectedInformationClasses,
      expectedRoutePrefixes,
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
  const plan = {
    schemaVersion: 1,
    baseline: String(frontier.baseline || "checked-in-spec-and-coverage-ledgers"),
    baselineSignals: {
      ...baselineSignals,
      derivedOperationCount: derivedBaseline?.operations?.length ?? 0,
      source: derivedBaseline?.source ?? "recipe-overlay-only",
    },
    targets,
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
  Object.defineProperty(plan, "baselineOperations", {
    enumerable: false,
    value: derivedBaseline?.operations ?? [],
  });
  return plan;
}

function recordMatchesTarget(record, target) {
  let hostname;
  try {
    hostname = new URL(record?.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const pathname = String(record?.path || "");
  return target.expectedHostFamilies.includes(hostname)
    && target.expectedRoutePrefixes.some((prefix) => routePrefixMatches(pathname, prefix));
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
    && target.expectedRoutePrefixes.some((prefix) => routePrefixMatches(candidate?.normalizedPath, prefix));
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
  return operations.find((operation) => operation.method === method
    && operation.hosts.includes(hostname)
    && routePattern(operation.path).test(String(record?.path || ""))) ?? null;
}

export function evaluateNoveltyEvidence({ recipe, noveltyPlan = null, actionResults = [], apiRecords = [], candidateHandoff } = {}) {
  const plan = noveltyPlan ?? buildNoveltyPlan(recipe, { required: true });
  const known = Object.fromEntries(["queryMetadata", "requestShapes", "responseShapes", "routes"]
    .map((key) => [key, new Set(plan.baselineSignals[key] ?? [])]));
  const completedRecipeActionIndexes = new Set();
  const actionPages = new Map();
  const recipeActionResults = actionResults.filter((result) => (
    Number.isInteger(result?.actionIndex)
      ? result.actionIndex >= 0
      : !/^seed(?:-|$)/u.test(String(result?.page ?? ""))
  ));
  const indexedResultsAvailable = recipeActionResults.some((result) => Number.isInteger(result?.actionIndex));
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
    const records = apiRecords.filter((record) => recordMatchesTarget(record, target)
      && (record.seenOnPages ?? []).some((page) => targetPages.has(page)));
    const candidates = candidateLists(candidateHandoff).filter((candidate) => candidateMatchesTarget(candidate, target));
    const undocumentedRecords = records.filter((record) => candidates.some((candidate) => (
      candidateHostnames(candidate).includes(recordHostname(record))
      && String(candidate.method || "GET").toUpperCase() === String(record.method || "GET").toUpperCase()
      && routePattern(candidate.normalizedPath).test(String(record.path))
    )));
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
      ? Array.from(new Set(records.map((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        if (operation?.responseSchemaDocumented) return null;
        return signalKey(record, "responseShapeFingerprint", operation?.path ?? record.path);
      }).filter((value) => value && !known.responseShapes.has(value)))).sort()
      : [];
    const requestShapeSignals = acceptedClasses.has("request-shape")
      ? Array.from(new Set(records.map((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        if (operation?.requestSchemaDocumented) return null;
        return signalKey(record, "requestShapeFingerprint", operation?.path ?? record.path);
      }).filter((value) => value && !known.requestShapes.has(value)))).sort()
      : [];
    const queryMetadataSignals = acceptedClasses.has("query-metadata")
      ? Array.from(new Set(records.flatMap((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        const knownNames = new Set(operation?.queryParameterNames ?? []);
        return (record.queryParameterNames ?? [])
          .filter((name) => !knownNames.has(name))
          .map((name) => `${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation?.path ?? record.path} ${name}`);
      }).filter((value) => value && !known.queryMetadata.has(value)))).sort()
      : [];
    const responseMetadataSignals = acceptedClasses.has("response-metadata")
      ? Array.from(new Set(records.flatMap((record) => {
        const operation = matchingBaselineOperation(record, plan.baselineOperations);
        const signals = [];
        if (record.mimeType && !operation?.responseContentTypes?.includes(record.mimeType)) {
          signals.push(`${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation?.path ?? record.path} mime:${record.mimeType}`);
        }
        const status = String(record.status ?? "");
        if (status && !operation?.responseStatuses?.includes("default") && !operation?.responseStatuses?.includes(status)) {
          signals.push(`${recordHostname(record)} ${String(record.method || "GET").toUpperCase()} ${operation?.path ?? record.path} status:${status}`);
        }
        return signals;
      }))).sort()
      : [];
    const materializedSignalCount = routeSignals.length
      + hostSignals.length
      + responseShapeSignals.length
      + requestShapeSignals.length
      + queryMetadataSignals.length
      + responseMetadataSignals.length;
    return {
      acceptanceKey: target.acceptanceKey,
      attempted,
      id: target.id,
      hostSignals,
      matchedRecordCount: records.length,
      materializedSignalCount,
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
  const productiveTargetCount = targets.filter((target) => target.materializedSignalCount > 0).length;
  const requiredSignalCount = recipe.actions.length > 20 ? 3 : 1;
  const requiredProductiveTargets = recipe.actions.length > 20 ? 2 : 1;
  const complete = attemptedTargetCount === targets.length;
  const productive = complete
    && targetedSignals >= requiredSignalCount
    && productiveTargetCount >= requiredProductiveTargets;
  return {
    schemaVersion: 1,
    status: !complete ? "frontier-incomplete" : productive ? "productive" : "no-novelty",
    targets,
    measurements: {
      attemptedTargetCount,
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
