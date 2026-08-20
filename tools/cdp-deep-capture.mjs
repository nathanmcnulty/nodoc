import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { mineJavascriptBundles } from "./mine-javascript-bundles.mjs";
import {
  activeGetPathPattern,
  activeGetQueryPattern,
  classifyGetProbeUrl,
  sanitizeObservedTransportUrl,
} from "./discovery-safety.mjs";
import { planActionBudget, validateActionBudgetResult } from "./portal-discovery-action-budget.mjs";
import {
  buildTransitionEvidence,
  decodeBoundedCdpBody,
  deriveActionEligibility,
  responseBodyCaptureLimit,
  shouldRequestResponseBody,
  summarizeActionResults,
} from "./discovery-capture-policy.mjs";
import {
  buildStableEvidenceId,
  captureArtifactSchemaVersion,
  CdpAttributionRegistry,
  normalizeAttributionUrl,
  shouldPreferActiveSessionAttribution,
} from "./cdp-attribution.mjs";
import { collectCdpDomSnapshots } from "./cdp-snapshot-collector.mjs";

let apiBase = "http://127.0.0.1:9222";
const defaultNavigationTimeoutMs = 15000;
const defaultNetworkIdleMs = 750;
const defaultSeedLinkLimit = 12;
const defaultSeedRouteLimit = 8;
const defaultSettleMs = 8000;
const defaultPostActionSettleMs = 6000;
const defaultEvaluateTimeoutMs = 10000;
const defaultCdpCommandTimeoutMs = 20000;
const defaultFinalizationTimeoutMs = 30000;
const defaultBodyCaptureTimeoutMs = 10000;
const defaultScriptCaptureTimeoutMs = 15000;
let runtimeEvaluateTimeoutMs = defaultEvaluateTimeoutMs;

class CapturePhaseTimeoutError extends Error {
  constructor(phase, timeoutMs, detail = null) {
    super(`Capture phase "${phase}" timed out after ${timeoutMs} ms.`);
    this.name = "CapturePhaseTimeoutError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
    this.detail = detail;
  }
}

async function withPhaseTimeout(operation, timeoutMs, phase) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CapturePhaseTimeoutError(phase, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeCaptureFailure(args, error) {
  await writeFile(
    path.join(args.outDir, "capture-failure.json"),
    `${JSON.stringify({
      detail: error instanceof Error ? error.message : String(error),
      phase: error?.phase ?? "capture",
      schemaVersion: captureArtifactSchemaVersion,
      timeoutMs: error?.timeoutMs ?? null,
    }, null, 2)}\n`,
    "utf8",
  );
}

function stripBom(value) {
  return typeof value === "string" ? value.replace(/^\uFEFF/u, "") : value;
}

function parseActionSpec(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --action value "${value}". Expected type=value.`);
  }

  const rawType = value.slice(0, separator).trim();
  const rawValue = value.slice(separator + 1);
  const normalizedType = rawType.replace(/-(root|iframe)$/u, "");
  const scope = rawType.endsWith("-root")
    ? "root"
    : rawType.endsWith("-iframe")
      ? "iframe"
      : "any";

  const type = normalizedType === "click" ? "click-label" : normalizedType;
  if (![
    "capture",
    "click-contains",
    "click-href",
    "click-label",
    "crawl-links",
    "navigate",
    "probe-get",
    "replay-seeded-links",
    "replay-seeded-routes",
    "wait-ms",
  ].includes(type)) {
    throw new Error(`Unsupported action type "${rawType}".`);
  }

  return {
    raw: value,
    scope,
    type,
    value: rawValue,
  };
}

function parseVarSpec(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --var value "${value}". Expected name=value.`);
  }

  return {
    name: value.slice(0, separator).trim(),
    value: value.slice(separator + 1),
  };
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function ensureGlobalFlag(flags = "gu") {
  const uniqueFlags = Array.from(new Set(String(flags || "").split("")));
  if (!uniqueFlags.includes("g")) {
    uniqueFlags.push("g");
  }
  return uniqueFlags.join("");
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function shapeOf(value, depth = 0) {
  if (depth >= 8) {
    return "max-depth";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    const shapes = uniqueSorted(value.slice(0, 20).map((item) => JSON.stringify(shapeOf(item, depth + 1))));
    return { array: shapes.map((item) => JSON.parse(item)) };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, shapeOf(value[key], depth + 1)]),
    );
  }
  return typeof value;
}

function bodyShapeFingerprint(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return sha256(JSON.stringify(shapeOf(parsed)));
  } catch {
    return sha256(`non-json:${typeof value}`);
  }
}

function requestEvidence(request) {
  try {
    const parsed = new URL(request.url);
    const queryParameterNames = uniqueSorted(Array.from(parsed.searchParams.keys()));
    const requestShapeFingerprint =
      request.requestShapeFingerprint ?? bodyShapeFingerprint(request.requestBody);
    const responseShapeFingerprint =
      request.responseShapeFingerprint ?? bodyShapeFingerprint(request.responseBody);
    return {
      queryParameterNames,
      requestFingerprint: sha256(JSON.stringify({
        method: request.method,
        path: parsed.pathname,
        queryParameterNames,
        requestShapeFingerprint,
        responseShapeFingerprint,
        status: request.status ?? null,
      })),
      requestShapeFingerprint,
      responseShapeFingerprint,
    };
  } catch {
    return {
      queryParameterNames: [],
      requestFingerprint: sha256(`${request.method} ${request.url}`),
      requestShapeFingerprint:
        request.requestShapeFingerprint ?? bodyShapeFingerprint(request.requestBody),
      responseShapeFingerprint:
        request.responseShapeFingerprint ?? bodyShapeFingerprint(request.responseBody),
    };
  }
}

function normalizeHeaderEntries(headers = {}) {
  return Object.entries(headers)
    .map(([name, value]) => [String(name || "").trim().toLowerCase(), value])
    .filter(([name]) => Boolean(name));
}

function normalizeHeaderMap(headers = {}) {
  return Object.fromEntries(normalizeHeaderEntries(headers));
}

function toHeaderValues(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "")).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/gu)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [String(value)];
}

function extractCookieNames(value) {
  return Array.from(
    new Set(
      toHeaderValues(value)
        .map((entry) => entry.split(";")[0]?.split("=")[0]?.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function hostnameMatchesPattern(hostname, pattern) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  const normalizedPattern = String(pattern || "").trim().toLowerCase();

  if (!normalizedHostname || !normalizedPattern) {
    return false;
  }

  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHostname.length > suffix.length && normalizedHostname.endsWith(suffix);
  }

  return normalizedHostname === normalizedPattern;
}

function summarizeHeaderMetadata(headers = {}) {
  const headerKeys = Array.from(new Set(normalizeHeaderEntries(headers).map(([name]) => name))).sort();
  const headerMap = normalizeHeaderMap(headers);
  const cookieNames = extractCookieNames(headerMap.cookie);
  const cookieHeader = toHeaderValues(headerMap.cookie).join("; ");
  const authorizationValue = typeof headerMap.authorization === "string" ? headerMap.authorization.trim() : "";
  const authorizationScheme = authorizationValue ? authorizationValue.split(/\s+/u, 1)[0] : null;
  const yamHeaderNames = headerKeys.filter((name) => name.startsWith("x-yam-"));

  return {
    authSignals: {
      authorizationScheme,
      cookieNames,
      hasAuthorizationHeader: Boolean(authorizationValue),
      hasAuthorizationReceiverHeader: headerKeys.includes("authorization-receiver"),
      hasCookieHeader: Boolean(cookieHeader),
      hasXRequestIdHeader: headerKeys.includes("x-request-id"),
      yamHeaderNames,
    },
    requestHeaderKeys: headerKeys,
    selectedRequestHeaders: {
      "content-type": headerMap["content-type"] ?? null,
      origin: headerMap.origin ?? null,
      referer: headerMap.referer ?? null,
      "x-ecs-etag": headerMap["x-ecs-etag"] ?? null,
      "x-request-id": headerMap["x-request-id"] ?? null,
      "x-yammer-oauthtokenexpiration": headerMap["x-yammer-oauthtokenexpiration"] ?? null,
    },
  };
}

function sanitizeLocationHeader(value) {
  const sensitiveKeys = new Set([
    "access_token",
    "client_info",
    "code",
    "id_token",
    "nonce",
    "refresh_token",
    "session_state",
    "state",
  ]);
  const locationValue = toHeaderValues(value)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!locationValue) {
    return null;
  }

  try {
    const placeholderOrigin = "https://placeholder.invalid";
    const parsed = new URL(locationValue, placeholderOrigin);

    for (const [key] of parsed.searchParams) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    if (/^[a-z][a-z0-9+.-]*:/iu.test(locationValue)) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const hashIndex = locationValue.indexOf("#");
    const withoutHash = hashIndex === -1 ? locationValue : locationValue.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : locationValue.slice(hashIndex);
    const queryIndex = withoutHash.indexOf("?");

    if (queryIndex === -1) {
      return locationValue;
    }

    const prefix = withoutHash.slice(0, queryIndex);
    const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
    let redacted = false;

    for (const [key] of params) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        params.set(key, "[redacted]");
        redacted = true;
      }
    }

    if (!redacted) {
      return locationValue;
    }

    const query = params.toString();
    return query ? `${prefix}?${query}${hash}` : `${prefix}${hash}`;
  }
}

function summarizeResponseHeaderMetadata(headers = {}) {
  const headerKeys = Array.from(new Set(normalizeHeaderEntries(headers).map(([name]) => name))).sort();
  const headerMap = normalizeHeaderMap(headers);
  const setCookieNames = extractCookieNames(headerMap["set-cookie"]);

  return {
    responseAuthSignals: {
      hasAccessControlAllowCredentialsHeader: headerKeys.includes("access-control-allow-credentials"),
      hasLocationHeader: headerKeys.includes("location"),
      hasSetCookieHeader: setCookieNames.length > 0,
      hasWwwAuthenticateHeader: headerKeys.includes("www-authenticate"),
      hasXRequestIdHeader: headerKeys.includes("x-request-id"),
      setCookieNames,
    },
    responseHeaderKeys: headerKeys,
    selectedResponseHeaders: {
      "content-type": headerMap["content-type"] ?? null,
      location: sanitizeLocationHeader(headerMap.location),
      "www-authenticate": headerMap["www-authenticate"] ?? null,
      "x-request-id": headerMap["x-request-id"] ?? null,
    },
  };
}

function expandTemplateVariables(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/gu, (_match, variableName) => {
      if (!Object.prototype.hasOwnProperty.call(variables, variableName)) {
        throw new Error(`Recipe variable "${variableName}" was not provided.`);
      }

      return String(variables[variableName]);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandTemplateVariables(item, variables));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        expandTemplateVariables(entryValue, variables),
      ]),
    );
  }

  return value;
}

function normalizeRecipeAction(action) {
  if (typeof action === "string") {
    return parseActionSpec(action);
  }

  if (!action || typeof action !== "object") {
    throw new Error("Recipe actions must be strings or objects.");
  }

  const rawType = String(action.type || "").trim();
  if (!rawType) {
    throw new Error("Recipe action objects must include a type.");
  }

  const scopedType =
    action.scope && action.scope !== "any"
      ? `${rawType}-${String(action.scope).trim()}`
      : rawType;
  return {
    ...parseActionSpec(`${scopedType}=${action.value ?? ""}`),
    highValue: action.highValue === true,
    optional: action.optional === true,
    required: Boolean(action.required),
  };
}

function resolveRecipePath(value, recipeDir) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.resolve(recipeDir, value);
}

function normalizeSeedRouteGroups(groups = {}) {
  const normalizedGroups = {};

  for (const [groupName, group] of Object.entries(groups)) {
    const routeTemplates = ensureArray(group?.routeTemplates)
      .map((template) => String(template || "").trim())
      .filter(Boolean);
    const idSources = ensureArray(group?.idSources)
      .map((source) => ({
        artifactFile: String(source?.artifactFile || "").trim(),
        captureGroup:
          Number.isInteger(source?.captureGroup) && source.captureGroup >= 0
            ? source.captureGroup
            : 1,
        decode: Boolean(source?.decode),
        flags: ensureGlobalFlag(source?.flags ?? "gu"),
        pageContains: ensureArray(source?.pageContains)
          .map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean),
        pattern: String(source?.pattern || "").trim(),
      }))
      .filter((source) => source.artifactFile && source.pattern);

    normalizedGroups[groupName] = {
      idSources,
      limit:
        Number.isInteger(group?.limit) && group.limit > 0
          ? group.limit
          : defaultSeedRouteLimit,
      routeTemplates,
    };
  }

  return normalizedGroups;
}

function applyRecipeConfig(args, recipeConfig, recipePath) {
  const recipeDir = path.dirname(recipePath);
  if (recipeConfig.url) {
    args.url = recipeConfig.url;
  }

  if (recipeConfig.portal) {
    args.portal = recipeConfig.portal;
  }

  if (recipeConfig.label) {
    args.label = recipeConfig.label;
  }

  if (recipeConfig.out) {
    args.outDir = resolveRecipePath(recipeConfig.out, recipeDir);
  }

  if (Array.isArray(recipeConfig.matchHosts)) {
    args.matchHosts = [...recipeConfig.matchHosts];
  }

  if (Array.isArray(recipeConfig.matchPathPrefixes)) {
    args.matchPathPrefixes = recipeConfig.matchPathPrefixes.map((item) => normalizePath(item));
  }

  if (recipeConfig.seedArtifacts) {
    args.seedArtifacts = resolveRecipePath(recipeConfig.seedArtifacts, recipeDir);
  }

  if (Array.isArray(recipeConfig.seedPages)) {
    args.seedPages = [...recipeConfig.seedPages];
  }

  if (Array.isArray(recipeConfig.seedLinkContains)) {
    args.seedLinkContains = [...recipeConfig.seedLinkContains];
  }

  if (Number.isFinite(Number(recipeConfig.seedLinkLimit))) {
    args.seedLinkLimit = Number(recipeConfig.seedLinkLimit);
  }

  if (Number.isFinite(Number(recipeConfig.settleMs))) {
    args.settleMs = Number(recipeConfig.settleMs);
  }

  if (Number.isFinite(Number(recipeConfig.postActionSettleMs))) {
    args.postActionSettleMs = Number(recipeConfig.postActionSettleMs);
  }

  if (Number.isFinite(Number(recipeConfig.navigationTimeoutMs))) {
    args.navigationTimeoutMs = Number(recipeConfig.navigationTimeoutMs);
  }

  if (Number.isFinite(Number(recipeConfig.networkIdleMs))) {
    args.networkIdleMs = Number(recipeConfig.networkIdleMs);
  }

  if (Number.isFinite(Number(recipeConfig.evaluateTimeoutMs))) {
    args.evaluateTimeoutMs = Number(recipeConfig.evaluateTimeoutMs);
  }

  for (const key of ["finalizationTimeoutMs", "bodyCaptureTimeoutMs", "scriptCaptureTimeoutMs"]) {
    if (Number.isFinite(Number(recipeConfig[key]))) {
      args[key] = Number(recipeConfig[key]);
    }
  }

  if (recipeConfig.actions) {
    args.actions = ensureArray(recipeConfig.actions).map(normalizeRecipeAction);
  }

  if (recipeConfig.captureScripts !== undefined) {
    args.captureScripts = Boolean(recipeConfig.captureScripts);
  }

  args.seedRouteGroups = normalizeSeedRouteGroups(recipeConfig.seedRouteGroups);
  args.actionBudget = planActionBudget(recipeConfig, { maxActions: recipeConfig.maxActions });
}

async function parseArgs(argv) {
  const args = {
    actions: [],
    captureScripts: true,
    cdpEndpoint: "http://127.0.0.1:9222",
    bundleCacheDir: null,
    evaluateTimeoutMs: defaultEvaluateTimeoutMs,
    finalizationTimeoutMs: defaultFinalizationTimeoutMs,
    bodyCaptureTimeoutMs: defaultBodyCaptureTimeoutMs,
    scriptCaptureTimeoutMs: defaultScriptCaptureTimeoutMs,
    label: null,
    matchHosts: [],
    matchPathPrefixes: [],
    navigationTimeoutMs: defaultNavigationTimeoutMs,
    networkIdleMs: defaultNetworkIdleMs,
    outDir: null,
    portal: null,
    postActionSettleMs: defaultPostActionSettleMs,
    recipePath: null,
    seedArtifacts: null,
    seedLinkContains: [],
    seedLinkLimit: defaultSeedLinkLimit,
    seedPages: [],
    seedRouteGroups: {},
    settleMs: defaultSettleMs,
    targetId: null,
    url: null,
    variables: {},
    actionBudget: null,
  };

  let recipePath = null;
  const cliVariables = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--recipe" && next) {
      recipePath = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--recipe=")) {
      recipePath = path.resolve(arg.slice("--recipe=".length));
      continue;
    }

    if (arg === "--var" && next) {
      const { name, value } = parseVarSpec(next);
      cliVariables[name] = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--var=")) {
      const { name, value } = parseVarSpec(arg.slice("--var=".length));
      cliVariables[name] = value;
      continue;
    }
  }

  if (recipePath) {
    const recipeSource = JSON.parse(stripBom(await readFile(recipePath, "utf8")));
    const expandedRecipe = expandTemplateVariables(
      recipeSource,
      {
        ...(recipeSource.variables ?? {}),
        ...cliVariables,
      },
    );
    applyRecipeConfig(args, expandedRecipe, recipePath);
    args.recipePath = recipePath;
    args.variables = cliVariables;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--recipe" || arg.startsWith("--recipe=")) {
      if (arg === "--recipe") {
        index += 1;
      }
      continue;
    }

    if (arg === "--var" || arg.startsWith("--var=")) {
      if (arg === "--var") {
        index += 1;
      }
      continue;
    }

    if (arg === "--url" && next) {
      args.url = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--portal" && next) {
      args.portal = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--portal=")) {
      args.portal = arg.slice("--portal=".length);
      continue;
    }

    if (arg === "--label" && next) {
      args.label = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--label=")) {
      args.label = arg.slice("--label=".length);
      continue;
    }

    if (arg === "--target-id" && next) {
      args.targetId = next.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--target-id=")) {
      args.targetId = arg.slice("--target-id=".length).trim();
      continue;
    }

    if (arg === "--cdp-endpoint" && next) {
      args.cdpEndpoint = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--cdp-endpoint=")) {
      args.cdpEndpoint = arg.slice("--cdp-endpoint=".length);
      continue;
    }

    if (arg === "--out" && next) {
      args.outDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === "--bundle-cache-dir" && next) {
      args.bundleCacheDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.outDir = path.resolve(arg.slice("--out=".length));
      continue;
    }

    if (arg === "--match-hosts" && next) {
      args.matchHosts = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }

    if (arg.startsWith("--match-hosts=")) {
      args.matchHosts = arg.slice("--match-hosts=".length).split(",").map((item) => item.trim()).filter(Boolean);
      continue;
    }

    if (arg === "--match-path-prefixes" && next) {
      args.matchPathPrefixes = next.split(",").map((item) => normalizePath(item)).filter(Boolean);
      index += 1;
      continue;
    }

    if (arg.startsWith("--match-path-prefixes=")) {
      args.matchPathPrefixes = arg
        .slice("--match-path-prefixes=".length)
        .split(",")
        .map((item) => normalizePath(item))
        .filter(Boolean);
      continue;
    }

    if (arg === "--seed-artifacts" && next) {
      args.seedArtifacts = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--seed-artifacts=")) {
      args.seedArtifacts = path.resolve(arg.slice("--seed-artifacts=".length));
      continue;
    }

    if (arg === "--seed-page" && next) {
      args.seedPages.push(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--seed-page=")) {
      args.seedPages.push(arg.slice("--seed-page=".length));
      continue;
    }

    if (arg === "--seed-link-contains" && next) {
      args.seedLinkContains.push(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--seed-link-contains=")) {
      args.seedLinkContains.push(arg.slice("--seed-link-contains=".length));
      continue;
    }

    if (arg === "--seed-link-limit" && next) {
      args.seedLinkLimit = Number(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--seed-link-limit=")) {
      args.seedLinkLimit = Number(arg.slice("--seed-link-limit=".length));
      continue;
    }

    if (arg === "--settle-ms" && next) {
      args.settleMs = Number(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--settle-ms=")) {
      args.settleMs = Number(arg.slice("--settle-ms=".length));
      continue;
    }

    if (arg === "--post-action-settle-ms" && next) {
      args.postActionSettleMs = Number(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--post-action-settle-ms=")) {
      args.postActionSettleMs = Number(arg.slice("--post-action-settle-ms=".length));
      continue;
    }

    if (arg === "--navigation-timeout-ms" && next) {
      args.navigationTimeoutMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--network-idle-ms" && next) {
      args.networkIdleMs = Number(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--network-idle-ms=")) {
      args.networkIdleMs = Number(arg.slice("--network-idle-ms=".length));
      continue;
    }

    if (arg.startsWith("--navigation-timeout-ms=")) {
      args.navigationTimeoutMs = Number(arg.slice("--navigation-timeout-ms=".length));
      continue;
    }

    if (arg === "--evaluate-timeout-ms" && next) {
      args.evaluateTimeoutMs = Number(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--evaluate-timeout-ms=")) {
      args.evaluateTimeoutMs = Number(arg.slice("--evaluate-timeout-ms=".length));
      continue;
    }

    for (const key of ["finalizationTimeoutMs", "bodyCaptureTimeoutMs", "scriptCaptureTimeoutMs"]) {
      const option = `--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
      if (arg === option && next) {
        args[key] = Number(next);
        index += 1;
        break;
      }
      if (arg.startsWith(`${option}=`)) {
        args[key] = Number(arg.slice(option.length + 1));
        break;
      }
    }

    if (arg === "--action" && next) {
      args.actions.push(parseActionSpec(next));
      index += 1;
      continue;
    }

    if (arg.startsWith("--action=")) {
      args.actions.push(parseActionSpec(arg.slice("--action=".length)));
      continue;
    }
  }

  if (!args.url) {
    throw new Error("Missing required --url argument.");
  }

  if (args.actionBudget?.maxActions !== null && args.actionBudget?.maxActions !== undefined
      && args.actionBudget.countedActions > args.actionBudget.maxActions) {
    throw new Error(`Action budget exceeded before browser interaction: planned ${args.actionBudget.countedActions} browser actions exceeds authorized maximum ${args.actionBudget.maxActions}.`);
  }

  if (!args.portal) {
    throw new Error("Missing required --portal argument.");
  }

  if (!args.outDir) {
    throw new Error("Missing required --out argument.");
  }

  for (const key of ["evaluateTimeoutMs", "navigationTimeoutMs", "networkIdleMs", "postActionSettleMs", "settleMs"]) {
    if (!Number.isFinite(args[key]) || args[key] <= 0) {
      throw new Error(`Invalid value for ${key}: "${args[key]}".`);
    }
  }

  for (const key of ["finalizationTimeoutMs", "bodyCaptureTimeoutMs", "scriptCaptureTimeoutMs"]) {
    if (!Number.isFinite(args[key]) || args[key] <= 0) {
      throw new Error(`Invalid value for ${key}: "${args[key]}".`);
    }
  }

  if (!Number.isInteger(args.seedLinkLimit) || args.seedLinkLimit <= 0) {
    throw new Error(`Invalid value for seedLinkLimit: "${args.seedLinkLimit}".`);
  }

  if (args.actions.some((action) => ["replay-seeded-links", "replay-seeded-routes"].includes(action.type)) && !args.seedArtifacts) {
    throw new Error("Seeded replay actions require --seed-artifacts <directory>.");
  }

  for (const action of args.actions.filter((entry) => entry.type === "replay-seeded-routes")) {
    if (!args.seedRouteGroups[action.value]) {
      throw new Error(`No seed route group named "${action.value}" was defined in the selected recipe.`);
    }
  }

  return args;
}

function normalizePath(value) {
  return `/${String(value || "")
    .replace(/^\/+/u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/$/u, "")}`;
}

function matchesPathPrefix(normalizedPath, prefix) {
  return normalizedPath === prefix
    || normalizedPath.startsWith(`${prefix}/`)
    || normalizedPath.startsWith(`${prefix}(`);
}

function shouldMatchRequest(requestUrl, args) {
  if (!requestUrl || typeof requestUrl !== "string") {
    return false;
  }

  if (args.matchHosts.length === 0 && args.matchPathPrefixes.length === 0) {
    return true;
  }

  try {
    const parsed = new URL(requestUrl);
    const hostMatches = args.matchHosts.length === 0
      || args.matchHosts.some((pattern) => hostnameMatchesPattern(parsed.hostname, pattern));
    const pathMatches = args.matchPathPrefixes.length === 0
      || args.matchPathPrefixes.some((prefix) => matchesPathPrefix(parsed.pathname, prefix));
    return hostMatches && pathMatches;
  } catch {
    return false;
  }
}

function truncate(value, maxLength = 5000) {
  if (typeof value !== "string") {
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

const redactedBodyValue = "[redacted]";
const sensitiveBodyKeys = new Set([
  "accesstoken",
  "assertion",
  "authorization",
  "authtoken",
  "clientsecret",
  "hubtenanttoken",
  "idtoken",
  "password",
  "refreshtoken",
  "secret",
  "token",
]);

function normalizeSensitiveKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function sanitizeTokenLikeString(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  return value
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gu, "$1 [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu, redactedBodyValue)
    .replace(
      /([?&](?:access_token|refresh_token|id_token|client_secret|assertion|token)=)[^&\s]+/giu,
      `$1${redactedBodyValue}`,
    );
}

function redactStructuredBody(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactStructuredBody(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sensitiveBodyKeys.has(normalizeSensitiveKey(key))
          ? redactedBodyValue
          : redactStructuredBody(entryValue),
      ]),
    );
  }

  if (typeof value === "string") {
    return sanitizeTokenLikeString(value);
  }

  return value;
}

function sanitizeCapturedBody(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.stringify(redactStructuredBody(JSON.parse(trimmed)));
  } catch {
    // Try additional body formats.
  }

  try {
    const params = new URLSearchParams(trimmed);
    let changed = false;
    for (const key of new Set(Array.from(params.keys()))) {
      if (!sensitiveBodyKeys.has(normalizeSensitiveKey(key))) {
        continue;
      }

      params.set(key, redactedBodyValue);
      changed = true;
    }

    if (changed) {
      return params.toString();
    }
  } catch {
    // Fall back to plain string sanitization.
  }

  return sanitizeTokenLikeString(value);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function mergeArray(existing, next) {
  const combined = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(next) ? next : []),
  ].filter(Boolean);

  if (combined.every((item) => typeof item === "string")) {
    return uniqueSorted(combined);
  }

  const keyed = new Map(combined.map((item) => [JSON.stringify(item), item]));
  return Array.from(keyed.values());
}

async function readJsonArray(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function loadSeedArtifacts(seedArtifactsDir) {
  return {
    actionResults: await readJsonArray(path.join(seedArtifactsDir, "action-results.json")),
    apiRecords: await readJsonArray(path.join(seedArtifactsDir, "api-records.json")),
    pageStates: await readJsonArray(path.join(seedArtifactsDir, "page-states.json")),
    rawRequests: await readJsonArray(path.join(seedArtifactsDir, "raw-requests.json")),
    sessionSnapshots: await readJsonArray(path.join(seedArtifactsDir, "session-snapshots.json")),
  };
}

function getSeedArtifactEntries(seedArtifacts, artifactFile) {
  const normalized = String(artifactFile || "").trim().toLowerCase();
  switch (normalized) {
    case "action-results":
    case "action-results.json":
      return seedArtifacts.actionResults ?? [];
    case "api-records":
    case "api-records.json":
      return seedArtifacts.apiRecords ?? [];
    case "page-states":
    case "page-states.json":
      return seedArtifacts.pageStates ?? [];
    case "raw-requests":
    case "raw-requests.json":
      return seedArtifacts.rawRequests ?? [];
    case "session-snapshots":
    case "session-snapshots.json":
      return seedArtifacts.sessionSnapshots ?? [];
    default:
      return [];
  }
}

function matchesSeedPageFilter(entry, pageContainsFilters) {
  if (pageContainsFilters.length === 0) {
    return true;
  }

  const entryText = [
    entry?.page,
    entry?.pageLabel,
    entry?.sourcePage,
    entry?.title,
    entry?.url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return pageContainsFilters.some((value) => entryText.includes(value));
}

function extractSeedValues(entries, source) {
  const regex = new RegExp(source.pattern, source.flags);
  const values = [];

  for (const entry of entries) {
    if (!matchesSeedPageFilter(entry, source.pageContains)) {
      continue;
    }

    const serializedEntry = JSON.stringify(entry);
    for (const match of serializedEntry.matchAll(regex)) {
      let value = match[source.captureGroup] ?? match[0];
      if (typeof value !== "string") {
        continue;
      }

      value = value.trim();
      if (!value) {
        continue;
      }

      if (source.decode) {
        try {
          value = decodeURIComponent(value);
        } catch {
          // Leave the original encoded value in place.
        }
      }

      values.push(value);
    }
  }

  return values;
}

function buildSeedRouteUrl(routeTemplate, seedValue, rootOrigin) {
  const interpolatedTemplate = String(routeTemplate)
    .replaceAll("{encoded}", encodeURIComponent(seedValue))
    .replaceAll("{id}", seedValue)
    .replaceAll("{value}", seedValue);
  return resolveMaybeRelativeUrl(interpolatedTemplate, `${rootOrigin}/`);
}

function mergeItems(existing, next) {
  const merged = { ...existing, ...next };

  for (const key of [
    "querySamples",
    "requestBodySamples",
    "sameOriginLinks",
    "seenOnPages",
    "sessionSnapshots",
    "scriptUrls",
    "visibleTabs",
    "visibleControls",
  ]) {
    if (Array.isArray(existing[key]) || Array.isArray(next[key])) {
      merged[key] = mergeArray(existing[key], next[key]);
    }
  }

  if (existing.responseBodySample && next.responseBodySample && existing.responseBodySample !== next.responseBodySample) {
    merged.responseBodySample = existing.responseBodySample;
  }

  return merged;
}

async function writeMergedArray(filePath, items, keyBuilder) {
  const existing = await readJsonArray(filePath);
  const merged = new Map(existing.map((item) => [keyBuilder(item), item]));

  for (const item of items) {
    const key = keyBuilder(item);
    if (merged.has(key)) {
      merged.set(key, mergeItems(merged.get(key), item));
    } else {
      merged.set(key, item);
    }
  }

  const ordered = Array.from(merged.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
  await writeFile(filePath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

async function createTarget() {
  const response = await fetch(`${apiBase}/json/new?about:blank`, {
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`Failed to create CDP target: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function listTargets() {
  const response = await fetch(`${apiBase}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to list CDP targets: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function resolveTarget(args) {
  if (!args.targetId) {
    return {
      ...(await createTarget()),
      closeWhenDone: true,
      reusedExistingTarget: false,
    };
  }

  const targets = await listTargets();
  const target = targets.find((entry) => entry.id === args.targetId);
  if (!target) {
    throw new Error(`No existing CDP target found for --target-id ${JSON.stringify(args.targetId)}.`);
  }

  if (!target.webSocketDebuggerUrl) {
    throw new Error(`CDP target ${JSON.stringify(args.targetId)} does not expose a websocket debugger URL.`);
  }

  return {
    ...target,
    closeWhenDone: false,
    reusedExistingTarget: true,
  };
}

async function closeTarget(targetId) {
  try {
    await fetch(`${apiBase}/json/close/${targetId}`);
  } catch {
    // Best effort only.
  }
}

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(wsUrl);
    this.socketClosed = false;
    this.closing = false;
    this.closeDetails = null;
  }

  rejectPending(error) {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }

    this.pending.clear();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = (event) => {
        cleanup();
        reject(event?.error ?? new Error("Failed to open CDP WebSocket."));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("CDP WebSocket closed before it opened."));
      };
      const cleanup = () => {
        this.socket.removeEventListener("open", handleOpen);
        this.socket.removeEventListener("error", handleError);
        this.socket.removeEventListener("close", handleClose);
      };

      this.socket.addEventListener("open", handleOpen, { once: true });
      this.socket.addEventListener("error", handleError, { once: true });
      this.socket.addEventListener("close", handleClose, { once: true });
    });

    this.socket.addEventListener("close", (event) => {
      this.socketClosed = true;
      this.closeDetails = {
        code: event.code ?? null,
        reason: event.reason ?? null,
      };
      if (!this.closing) {
        console.error(
          `CDP WebSocket closed unexpectedly (code ${this.closeDetails.code ?? "unknown"}${this.closeDetails.reason ? `: ${this.closeDetails.reason}` : ""}; pending=${this.pending.size}; nextId=${this.nextId}; pendingMethods=${JSON.stringify(Array.from(this.pending.values()).map(({ method, sessionId }) => ({ method, sessionId }))) }).`,
        );
      }
      this.rejectPending(new Error(
        `CDP WebSocket closed (code ${this.closeDetails.code ?? "unknown"}${this.closeDetails.reason ? `: ${this.closeDetails.reason}` : ""}).`,
      ));
    }, { once: true });

    this.socket.addEventListener("message", (raw) => {
      const message = JSON.parse(String(raw.data));
      if (typeof message.id === "number") {
        const key = `${message.sessionId ?? ""}:${message.id}`;
        const entry = this.pending.get(key);
        if (!entry) {
          return;
        }

        this.pending.delete(key);
        clearTimeout(entry.timeout);
        if (message.error) {
          entry.reject(new Error(message.error.message));
          return;
        }

        entry.resolve(message.result);
        return;
      }

      const callbacks = this.listeners.get(message.method) ?? [];
      for (const callback of callbacks) {
        callback(message.params ?? {}, {
          sessionId: message.sessionId ?? null,
        });
      }
    });
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) ?? [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }

  async send(method, params = {}, sessionId = null) {
    if (this.socketClosed || this.socket.readyState !== WebSocket.OPEN) {
      const detail = this.closeDetails
        ? ` (code ${this.closeDetails.code ?? "unknown"}${this.closeDetails.reason ? `: ${this.closeDetails.reason}` : ""})`
        : "";
      throw new Error(`CDP WebSocket is not open${detail}.`);
    }

    const id = ++this.nextId;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    });

    const key = `${sessionId ?? ""}:${id}`;
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(key)) {
          return;
        }
        reject(new Error(
          `CDP command ${method} timed out after ${defaultCdpCommandTimeoutMs} ms` +
          `${sessionId ? ` in session ${sessionId}` : ""}.`,
        ));
      }, defaultCdpCommandTimeoutMs);
      this.pending.set(key, { method, reject, resolve, sessionId, timeout });
    });

    this.socket.send(payload);
    return response;
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) {
      this.socketClosed = true;
      return;
    }

    await new Promise((resolve) => {
      this.socket.addEventListener("close", resolve, { once: true });
      if (this.socket.readyState !== WebSocket.CLOSING) {
        this.closing = true;
        this.socket.close();
      }
    });

    this.socketClosed = true;
  }
}

function requestKey(requestId, sessionId = null) {
  return `${sessionId ?? ""}:${requestId}`;
}

function requestFamily(request) {
  try {
    const parsed = new URL(request.url);
    return `${String(request.method || "GET").toUpperCase()} ${parsed.pathname}`;
  } catch {
    return `${String(request.method || "GET").toUpperCase()} ${String(request.url || "")}`;
  }
}

function isDomCapableTarget(sessionId, targetInfo) {
  if (sessionId === null) {
    return true;
  }

  return ["iframe", "page"].includes(targetInfo?.targetType ?? "");
}

async function evaluateJson(client, expression, sessionId = null, timeoutMs = runtimeEvaluateTimeoutMs) {
  const result = await Promise.race([
    client.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    }, sessionId),
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }),
  ]);

  return result?.result?.value ?? null;
}

function buildDomSnapshotExpression() {
  return `(() => {
    const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    };

    const toAbsoluteUrl = (value) => {
      try {
        return new URL(value, location.href).toString();
      } catch {
        return null;
      }
    };

    const controls = Array.from(
      document.querySelectorAll("a[href], button, [role='button'], [role='tab'], [aria-controls], [aria-label], [data-automation-id]")
    )
      .filter((element) => visible(element))
      .map((element) => ({
        ariaLabel: normalizeText(element.getAttribute("aria-label")),
        automationId: normalizeText(element.getAttribute("data-automation-id")),
        href: element.getAttribute("href"),
        role: element.getAttribute("role"),
        tag: element.tagName.toLowerCase(),
        text: normalizeText(element.textContent),
      }))
      .filter((item) => item.text || item.ariaLabel || item.automationId || item.href)
      .slice(0, 300);

    const sameOriginLinks = controls
      .filter((item) => item.href)
      .map((item) => {
        const absoluteUrl = toAbsoluteUrl(item.href);
        return {
          text: item.text,
          url: absoluteUrl,
        };
      })
      .filter((item) => item.url && new URL(item.url).origin === location.origin)
      .slice(0, 300);

    const visibleTabs = controls
      .filter((item) => item.role === "tab" || item.tag === "button" || item.ariaLabel || item.text)
      .map((item) => item.text || item.ariaLabel || item.automationId)
      .filter(Boolean)
      .slice(0, 300);

    return {
      bodyText: normalizeText(document.body?.innerText || "").slice(0, 12000),
      controls,
      readyState: document.readyState,
      sameOriginLinks,
      title: document.title,
      url: location.href,
      visibleTabs,
    };
  })()`;
}

function buildClickExpression(action) {
  const encodedMode = JSON.stringify(action.type);
  const encodedValue = JSON.stringify(String(action.value || ""));
  return `(() => {
    const mode = ${encodedMode};
    const rawValue = ${encodedValue};
    const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const normalizedNeedle = normalizeText(rawValue);
    const lowerNeedle = normalizedNeedle.toLowerCase();
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    };

    const toAbsoluteUrl = (value) => {
      try {
        return new URL(value, location.href).toString();
      } catch {
        return null;
      }
    };

    const candidates = Array.from(
      document.querySelectorAll("a[href], button, [role='button'], [role='tab'], [aria-controls], [aria-label], [data-automation-id]")
    )
      .filter((element) => visible(element))
      .map((element) => ({
        absoluteHref: toAbsoluteUrl(element.getAttribute("href")),
        ariaLabel: normalizeText(element.getAttribute("aria-label")),
        automationId: normalizeText(element.getAttribute("data-automation-id")),
        element,
        href: element.getAttribute("href"),
        role: element.getAttribute("role"),
        tag: element.tagName.toLowerCase(),
        text: normalizeText(element.textContent),
      }))
      .filter((candidate) => (
        candidate.text
        || candidate.ariaLabel
        || candidate.automationId
      ))
      .filter((candidate) => [candidate.text, candidate.ariaLabel, candidate.automationId]
        .filter(Boolean)
        .every((value) => value.length <= 200))
      .slice(0, 300);

    const matches = candidates.filter((candidate) => {
      if (mode === "click-href") {
        return candidate.href === rawValue || candidate.absoluteHref === rawValue;
      }

      const haystacks = [candidate.text, candidate.ariaLabel, candidate.automationId]
        .map((item) => item.toLowerCase())
        .filter(Boolean);
      if (mode === "click-contains") {
        return haystacks.some((item) => item.includes(lowerNeedle));
      }

      return haystacks.some((item) => item === lowerNeedle);
    });

    if (matches.length === 0) {
      return { clicked: false };
    }

    matches.sort((left, right) => {
      const leftScore = (left.role === "tab" ? 3 : 0) + (left.tag === "a" ? 2 : 0) + (left.tag === "button" ? 1 : 0);
      const rightScore = (right.role === "tab" ? 3 : 0) + (right.tag === "a" ? 2 : 0) + (right.tag === "button" ? 1 : 0);
      return rightScore - leftScore;
    });

    const match = matches[0];
    match.element.scrollIntoView({ block: "center", inline: "center" });
    match.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    if (typeof match.element.click === "function") {
      match.element.click();
    }

    return {
      absoluteHref: match.absoluteHref,
      ariaLabel: match.ariaLabel,
      automationId: match.automationId,
      clicked: true,
      href: match.href,
      role: match.role,
      tag: match.tag,
      text: match.text,
    };
  })()`;
}

function buildProbeExpression(value) {
  const encodedValue = JSON.stringify(String(value || ""));
  const encodedPathPattern = JSON.stringify(activeGetPathPattern.source);
  const encodedQueryPattern = JSON.stringify(activeGetQueryPattern.source);
  return `(async () => {
    const url = new URL(${encodedValue}, location.href).toString();
    const target = new URL(url);
    const riskyRoute = new RegExp(${encodedPathPattern}, "iu");
    const riskyQuery = new RegExp(${encodedQueryPattern}, "iu");
    let canonicalPath = target.pathname;
    let canonicalFragment = target.hash;
    try {
      for (let pass = 0; pass < 3 && canonicalPath.includes("%"); pass += 1) {
        canonicalPath = decodeURIComponent(canonicalPath);
      }
      for (let pass = 0; pass < 3 && canonicalFragment.includes("%"); pass += 1) {
        canonicalFragment = decodeURIComponent(canonicalFragment);
      }
    } catch {
      return {
        error: "The route contains unsafe URL encoding.",
        ok: false,
        rejected: true,
        status: null,
        url,
      };
    }
    if (
      !["http:", "https:"].includes(target.protocol)
      || target.origin !== location.origin
      || target.username
      || target.password
    ) {
      return {
        error: "Only same-origin HTTP(S) probes are permitted.",
        ok: false,
        rejected: true,
        status: null,
        url,
      };
    }
    let riskyQueryValue = false;
    try {
      riskyQueryValue = Array.from(target.searchParams).some(([key, rawValue]) => {
        let queryKey = key;
        let queryValue = rawValue;
        for (let pass = 0; pass < 3 && queryKey.includes("%"); pass += 1) {
          queryKey = decodeURIComponent(queryKey);
        }
        for (let pass = 0; pass < 3 && queryValue.includes("%"); pass += 1) {
          queryValue = decodeURIComponent(queryValue);
        }
        return ["action", "command", "operation"].includes(queryKey.toLowerCase())
          && riskyRoute.test("/" + queryValue);
      });
    } catch {
      riskyQueryValue = true;
    }
    if (
      riskyRoute.test(canonicalPath)
      || riskyRoute.test(canonicalFragment.replace(/^#/, "/"))
      || riskyQuery.test(target.search)
      || riskyQuery.test(canonicalFragment)
      || riskyQueryValue
    ) {
      return {
        error: "The route matches the active-GET deny rules.",
        ok: false,
        rejected: true,
        status: null,
        url,
      };
    }
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
        method: "GET",
        redirect: "manual",
      });
      const body = await response.text();
      return {
        body: body.slice(0, 5000),
        contentType: response.headers.get("content-type"),
        ok: response.ok,
        redirected: response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400),
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        status: null,
        url,
      };
    }
  })()`;
}

function toApiRecord(request, portalName) {
  try {
    const parsed = new URL(request.url);
    const querySample = parsed.search ? parsed.search : null;
    return {
      schemaVersion: captureArtifactSchemaVersion,
      ...requestEvidence(request),
      attribution: request.attribution,
      confidence: "confirmed-traffic",
      method: request.method,
      mimeType: request.mimeType ?? null,
      path: parsed.pathname,
      portalName,
      querySamples: querySample ? [querySample] : [],
      requestBodySamples: request.requestBody ? [request.requestBody] : [],
      responseBodySample: request.responseBody ?? null,
      seenOnPages: [request.pageLabel],
      status: request.status ?? null,
      url: request.url,
    };
  } catch {
    return {
      schemaVersion: captureArtifactSchemaVersion,
      ...requestEvidence(request),
      attribution: request.attribution,
      confidence: "confirmed-traffic",
      method: request.method,
      mimeType: request.mimeType ?? null,
      path: request.url,
      portalName,
      querySamples: [],
      requestBodySamples: request.requestBody ? [request.requestBody] : [],
      responseBodySample: request.responseBody ?? null,
      seenOnPages: [request.pageLabel],
      status: request.status ?? null,
      url: request.url,
    };
  }
}

function buildActionLabel(action, index) {
  const value = String(action.value || "").replace(/\s+/gu, " ").trim();
  const compactValue = value.length > 80 ? `${value.slice(0, 77)}...` : value;
  return `${String(index + 1).padStart(2, "0")}-${action.type}-${compactValue || "step"}`
    .replace(/[<>:"/\\|?*]+/gu, "-")
    .replace(/\s+/gu, "-");
}

function stateFingerprintFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return sha256(JSON.stringify({
    controls: snapshot.controls ?? [],
    links: snapshot.sameOriginLinks ?? [],
    tabs: snapshot.visibleTabs ?? [],
    title: snapshot.title ?? null,
    url: snapshot.url ?? null,
  }));
}

function resolveMaybeRelativeUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function isAbsoluteUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function slugify(value) {
  const normalized = String(value || "")
    .replace(/^https?:\/\/[^/]+/iu, "")
    .replace(/^[#/]+/u, "")
    .replace(/[?&=#]+/gu, "-")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

  return (normalized || "seeded-link").slice(0, 60);
}

function bundleFilename(scriptUrl, contentHash) {
  let basename = "bundle";
  try {
    basename = path.posix.basename(new URL(scriptUrl).pathname) || basename;
  } catch {
    basename = path.basename(String(scriptUrl || "")) || basename;
  }
  const safeBasename = basename
    .replace(/\.(?:m?js)$/iu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .slice(0, 80) || "bundle";
  return `${safeBasename}-${contentHash.slice(0, 12)}.js`;
}

function sourceMapUrlForScript(source, scriptUrl) {
  const matches = Array.from(
    String(source || "").matchAll(/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)/gu),
  );
  const sourceMapReference = matches.at(-1)?.[1];
  if (!sourceMapReference || sourceMapReference.startsWith("data:")) {
    return null;
  }
  try {
    return new URL(sourceMapReference, scriptUrl).toString();
  } catch {
    return sourceMapReference;
  }
}

function collectSeededLinkCandidates(seedPageStates, rootOrigin, args, action, limit = args.seedLinkLimit) {
  const explicitPageFilters = args.seedPages.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  const sourcePageSelector = String(action.value || "all").trim().toLowerCase();
  const linkContainsFilters = args.seedLinkContains.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  const excludedLinks = new Set([
    `${rootOrigin.toLowerCase()}/#`,
    `${rootOrigin.toLowerCase()}/#home`,
  ]);
  const seenLinks = new Set();
  const candidates = [];

  for (const pageState of seedPageStates) {
    const pageLabel = String(pageState?.page || "");
    const pageLabelLower = pageLabel.toLowerCase();
    if (explicitPageFilters.length > 0 && !explicitPageFilters.some((value) => pageLabelLower.includes(value))) {
      continue;
    }

    if (sourcePageSelector && sourcePageSelector !== "all" && !pageLabelLower.includes(sourcePageSelector)) {
      continue;
    }

    for (const link of pageState?.sameOriginLinks ?? []) {
      try {
        const resolvedUrl = typeof link === "string" ? link : link?.url;
        if (!resolvedUrl) {
          continue;
        }

        const parsed = new URL(resolvedUrl);
        const normalizedUrl = parsed.toString();
        const normalizedUrlLower = normalizedUrl.toLowerCase();
        if (
          parsed.origin !== rootOrigin
          || excludedLinks.has(normalizedUrlLower)
          || !classifyGetProbeUrl(normalizedUrl, rootOrigin).allowed
        ) {
          continue;
        }

        if (linkContainsFilters.length > 0 && !linkContainsFilters.some((value) => normalizedUrlLower.includes(value))) {
          continue;
        }

        if (seenLinks.has(normalizedUrl)) {
          continue;
        }

        seenLinks.add(normalizedUrl);
        candidates.push({
          sourcePage: pageLabel,
          url: normalizedUrl,
        });
      } catch {
        // Ignore malformed seed links.
      }
    }
  }

  return candidates.slice(0, limit);
}

function collectSeededRouteCandidates(seedArtifacts, rootOrigin, args, action) {
  const groupName = String(action.value || "").trim();
  const seedRouteGroup = args.seedRouteGroups[groupName];
  if (!seedRouteGroup) {
    return [];
  }

  const candidates = [];
  const seenUrls = new Set();

  for (const source of seedRouteGroup.idSources) {
    const entries = getSeedArtifactEntries(seedArtifacts, source.artifactFile);
    const seedValues = extractSeedValues(entries, source);

    for (const seedValue of seedValues) {
      for (const routeTemplate of seedRouteGroup.routeTemplates) {
        try {
          const url = buildSeedRouteUrl(routeTemplate, seedValue, rootOrigin);
          const parsed = new URL(url);
          if (parsed.origin !== rootOrigin) {
            continue;
          }

          const normalizedUrl = parsed.toString();
          if (
            seenUrls.has(normalizedUrl)
            || !classifyGetProbeUrl(normalizedUrl, rootOrigin).allowed
          ) {
            continue;
          }

          seenUrls.add(normalizedUrl);
          candidates.push({
            seedValue,
            sourceArtifact: source.artifactFile,
            url: normalizedUrl,
          });

          if (candidates.length >= seedRouteGroup.limit) {
            return candidates;
          }
        } catch {
          // Ignore malformed seeded route candidates.
        }
      }
    }
  }

  return candidates;
}

async function main() {
  const args = await parseArgs(process.argv.slice(2));
  apiBase = args.cdpEndpoint.replace(/\/$/u, "");
  runtimeEvaluateTimeoutMs = args.evaluateTimeoutMs;
  const seedArtifacts = args.seedArtifacts
    ? await loadSeedArtifacts(args.seedArtifacts)
    : {
        actionResults: [],
        apiRecords: [],
        pageStates: [],
        rawRequests: [],
        sessionSnapshots: [],
      };
  await mkdir(args.outDir, { recursive: true });

  const target = await resolveTarget(args);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  const requestMap = new Map();
  const scriptRequestMap = new Map();
  const scriptBodies = new Map();
  const inFlightRequests = new Set();
  const pendingBodyCaptures = new Set();
  let responseBodyTail = Promise.resolve();
  const capturedRequests = [];
  const pageStates = [];
  const sessionSnapshots = [];
  const scriptPages = [];
  const scriptRecords = [];
  const probeResults = [];
  const probeOutcomes = new Map();
  const probeAssociations = new Map();
  const passiveTransports = [];
  const actionResults = [];
  const boundedNetworkSessions = new Set();
  const configuredSessions = new Set();
  let currentActionIndex = -1;
  let currentContext = {
    actionIndex: currentActionIndex,
    attempt: 0,
    checkpoint: args.label ?? "seed-00",
    pageLabel: args.label ?? "seed-00",
    pageUrl: args.url,
  };
  const attributionRegistry = new CdpAttributionRegistry(target, currentContext);
  const sessions = attributionRegistry.sessions;
  let currentLoadResolver = null;
  let lastNetworkActivityAt = Date.now();

  function setCaptureContext(pageLabel, actionIndex = currentActionIndex, pageUrl = null, attempt = 0) {
    currentContext = {
      actionIndex,
      attempt,
      checkpoint: pageLabel,
      pageLabel,
      pageUrl: pageUrl ?? currentContext.pageUrl ?? null,
    };
    attributionRegistry.setRootContext(currentContext);
    attributionRegistry.setActiveSessionContexts(currentContext);
  }

  function resolveEventAttribution(eventName, sessionId, params = {}) {
    return attributionRegistry.resolve({
      documentURL: params.documentURL,
      frameId: params.frameId,
      loaderId: params.loaderId,
      preferSessionContext: shouldPreferActiveSessionAttribution(eventName),
      sessionId,
      targetUrl: sessions.get(sessionId)?.targetUrl ?? null,
    });
  }

  async function configureSession(sessionId = null) {
    const key = sessionId ?? "root";
    if (configuredSessions.has(key)) {
      return;
    }

    try {
      await client.send("Network.enable", {
        maxPostDataSize: 1024 * 128,
        maxResourceBufferSize: responseBodyCaptureLimit,
        maxTotalBufferSize: responseBodyCaptureLimit * 32,
      }, sessionId);
      boundedNetworkSessions.add(key);
    } catch {
      await client.send("Network.enable", { maxPostDataSize: 1024 * 128 }, sessionId);
    }

    for (const [method, params] of [
      ["Runtime.enable", {}],
      ["Network.setCacheDisabled", { cacheDisabled: true }],
      ["Page.enable", {}],
      ["DOM.enable", {}],
    ]) {
      try {
        await client.send(method, params, sessionId);
      } catch {
        // Best effort only.
      }
    }

    configuredSessions.add(key);
  }

  client.on("Page.loadEventFired", (_params, metadata) => {
    if (metadata.sessionId) {
      return;
    }

    currentLoadResolver?.();
  });

  client.on("Target.attachedToTarget", async (params, metadata) => {
    const childSessionId = params.sessionId ?? null;
    if (!childSessionId || childSessionId === metadata.sessionId) {
      return;
    }

    attributionRegistry.registerSession(
      childSessionId,
      params.targetInfo ?? {},
      metadata.sessionId ?? null,
    );

    try {
      await configureSession(childSessionId);
      await client.send("Runtime.runIfWaitingForDebugger", {}, childSessionId);
    } catch {
      // Best effort only.
    }
  });

  client.on("Target.detachedFromTarget", (params, metadata) => {
    const detachedSessionId = params.sessionId ?? null;
    if (detachedSessionId) {
      attributionRegistry.markDetached(detachedSessionId);
    }
  });

  client.on("Target.targetInfoChanged", (params, metadata) => {
    attributionRegistry.updateTarget(metadata.sessionId ?? null, params.targetInfo ?? {});
  });

  client.on("Page.frameAttached", (params, metadata) => {
    attributionRegistry.recordFrameAttached(
      metadata.sessionId ?? null,
      params.frameId,
      params.parentFrameId,
    );
  });

  client.on("Page.frameNavigated", (params, metadata) => {
    attributionRegistry.recordFrameNavigated(metadata.sessionId ?? null, params.frame);
  });

  client.on("Page.frameDetached", (params, metadata) => {
    const sessionId = metadata.sessionId ?? null;
    const entry = sessions.get(sessionId);
    if (entry?.frameId === params.frameId) {
      entry.frameId = null;
      entry.frameUrl = null;
    }
  });

  client.on("Network.requestWillBeSent", (params, metadata) => {
    const resourceType = params.type ?? params.initiator?.type ?? "";
    const requestUrl = params.request?.url;
    const sessionId = metadata.sessionId ?? null;
    const key = requestKey(params.requestId, sessionId);
    const attribution = resolveEventAttribution("Network.requestWillBeSent", sessionId, params);
    const probeId = requestUrl
      ? probeAssociations.get(`${sessionId ?? "root"}:${normalizeAttributionUrl(requestUrl)}`) ?? null
      : null;

    if (requestUrl && !["EventSource", "WebSocket"].includes(resourceType)) {
      inFlightRequests.add(key);
      lastNetworkActivityAt = Date.now();
    }

    if (resourceType === "Script" && requestUrl) {
      scriptRecords.push({
        attribution,
        page: attribution.pageLabel,
        sessionId,
        url: requestUrl,
      });
      scriptRequestMap.set(key, {
        attribution,
        mimeType: null,
        page: attribution.pageLabel,
        sessionId,
        status: null,
        url: requestUrl,
      });
    }

    if (["EventSource", "Ping"].includes(resourceType) && requestUrl) {
      const sanitizedUrl = sanitizeObservedTransportUrl(requestUrl);
      if (!sanitizedUrl) {
        return;
      }
      passiveTransports.push({
        attribution,
        method: params.request?.method ?? "GET",
        page: attribution.pageLabel,
        schemaVersion: captureArtifactSchemaVersion,
        transport: resourceType === "Ping" ? "beacon" : "event-source",
        url: sanitizedUrl,
      });
    }

    if (!["Fetch", "XHR"].includes(resourceType) || !requestUrl) {
      return;
    }

    const sanitizedRequestBody = sanitizeCapturedBody(params.request.postData ?? null);
    requestMap.set(key, {
      attribution,
      evidenceId: buildStableEvidenceId("request", {
        actionIndex: attribution.actionIndex,
        attempt: attribution.attempt,
        frameId: attribution.frameId,
        loaderId: attribution.loaderId,
        method: params.request.method,
        normalizedUrl: normalizeAttributionUrl(requestUrl),
        pageLabel: attribution.pageLabel,
        sessionId: attribution.sessionId,
        targetId: attribution.targetId,
      }),
      headers: params.request.headers ?? {},
      method: params.request.method,
      pageLabel: attribution.pageLabel,
      probeId,
      requestBody: truncate(sanitizedRequestBody),
      requestShapeFingerprint: bodyShapeFingerprint(sanitizedRequestBody),
      resourceType,
      sessionId,
      startedAt: params.timestamp,
      url: requestUrl,
    });
  });

  client.on("Network.responseReceived", (params, metadata) => {
    const key = requestKey(params.requestId, metadata.sessionId);
    const scriptRecord = scriptRequestMap.get(key);
    if (scriptRecord) {
      scriptRecord.mimeType = params.response?.mimeType ?? null;
      scriptRecord.status = params.response?.status ?? null;
    }

    const record = requestMap.get(key);
    if (record) {
      record.mimeType = params.response?.mimeType ?? null;
      record.responseHeaders = params.response?.headers ?? {};
      record.status = params.response?.status ?? null;
    }
  });

  client.on("Network.webSocketCreated", (params, metadata) => {
    const attribution = resolveEventAttribution("Network.webSocketCreated", metadata.sessionId ?? null, params);
    const sanitizedUrl = sanitizeObservedTransportUrl(params.url);
    if (!sanitizedUrl) {
      return;
    }
    passiveTransports.push({
      attribution,
      method: "GET",
      page: attribution.pageLabel,
      schemaVersion: captureArtifactSchemaVersion,
      transport: "websocket",
      url: sanitizedUrl,
    });
  });

  client.on("Network.webTransportCreated", (params, metadata) => {
    const attribution = resolveEventAttribution("Network.webTransportCreated", metadata.sessionId ?? null, params);
    const sanitizedUrl = sanitizeObservedTransportUrl(params.url);
    if (!sanitizedUrl) {
      return;
    }
    passiveTransports.push({
      attribution,
      method: "CONNECT",
      page: attribution.pageLabel,
      schemaVersion: captureArtifactSchemaVersion,
      transport: "webtransport",
      url: sanitizedUrl,
    });
  });

  client.on("Network.loadingFailed", (params, metadata) => {
    const key = requestKey(params.requestId, metadata.sessionId);
    inFlightRequests.delete(key);
    lastNetworkActivityAt = Date.now();
    scriptRequestMap.delete(key);
    const record = requestMap.get(key);
    if (!record) {
      return;
    }

    record.failureText = params.errorText ?? "loading failed";
    capturedRequests.push(record);
    requestMap.delete(key);
  });

  client.on("Network.loadingFinished", (params, metadata) => {
    const key = requestKey(params.requestId, metadata.sessionId);
    const captureResponseBody = async () => {
      scriptRequestMap.delete(key);

      const record = requestMap.get(key);
      if (record) {
        const sessionKey = metadata.sessionId ?? "root";
        if (
          boundedNetworkSessions.has(sessionKey)
          && shouldRequestResponseBody(params.encodedDataLength)
        ) {
          try {
            const body = await client.send("Network.getResponseBody", {
              requestId: params.requestId,
            }, metadata.sessionId);
            const sanitizedResponseBody = sanitizeCapturedBody(decodeBoundedCdpBody(body));
            record.responseBody = truncate(sanitizedResponseBody);
            record.responseShapeFingerprint = bodyShapeFingerprint(sanitizedResponseBody);
          } catch {
            record.responseBody = null;
          }
        } else {
          record.responseBody = null;
        }

        capturedRequests.push(record);
        requestMap.delete(key);
      }
    };
    const bodyCapture = responseBodyTail.then(captureResponseBody).finally(() => {
      inFlightRequests.delete(key);
      lastNetworkActivityAt = Date.now();
      pendingBodyCaptures.delete(bodyCapture);
    });
    responseBodyTail = bodyCapture.catch(() => {});
    pendingBodyCaptures.add(bodyCapture);
  });

  async function waitForNetworkIdle(maxWaitMs) {
    const startedAt = Date.now();
    await delay(Math.min(200, args.networkIdleMs));
    while (Date.now() - startedAt < maxWaitMs) {
      const idleForMs = Date.now() - lastNetworkActivityAt;
      if (
        inFlightRequests.size === 0
        && pendingBodyCaptures.size === 0
        && idleForMs >= args.networkIdleMs
      ) {
        return {
          idleForMs,
          settled: true,
          waitedMs: Date.now() - startedAt,
        };
      }
      await delay(Math.min(100, args.networkIdleMs));
    }
    return {
      inFlightRequestCount: inFlightRequests.size,
      pendingBodyCaptureCount: pendingBodyCaptures.size,
      settled: false,
      waitedMs: Date.now() - startedAt,
    };
  }

  async function getRootUrl() {
    return evaluateJson(client, "location.href");
  }

  async function getRootStateFingerprint() {
    try {
      return stateFingerprintFromSnapshot(
        await evaluateJson(client, buildDomSnapshotExpression()),
      );
    } catch {
      return null;
    }
  }

  async function collectSnapshots() {
    return collectCdpDomSnapshots({
      sessionEntries: sessions.entries(),
      isDomCapableTarget,
      evaluateSnapshot: (sessionId) => evaluateJson(
        client,
        buildDomSnapshotExpression(),
        sessionId,
      ),
      schemaVersion: captureArtifactSchemaVersion,
    });
  }

  let latestBundleSummary = {
    bundleCount: 0,
    candidateCount: 0,
    graphqlOperationCount: 0,
    parseFailureCount: 0,
  };

  async function writeBundleArtifacts() {
    if (!args.captureScripts) {
      await writeFile(
        path.join(args.outDir, "bundle-downloads.json"),
        `${JSON.stringify([], null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(args.outDir, "bundle-candidates.json"),
        `${JSON.stringify({
          bundleCount: 0,
          candidates: [],
          graphqlOperations: [],
          parseFailures: [],
        }, null, 2)}\n`,
        "utf8",
      );
      latestBundleSummary = {
        bundleCount: 0,
        candidateCount: 0,
        graphqlOperationCount: 0,
        parseFailureCount: 0,
      };
      return;
    }

    const bundleDir = path.join(args.outDir, "bundles");
    await mkdir(bundleDir, { recursive: true });
    const downloads = [];
    const bundleFiles = [];

    for (const script of scriptBodies.values()) {
      const contentHash = sha256(script.source);
      const filename = bundleFilename(script.url, contentHash);
      const absolutePath = path.join(bundleDir, filename);
      await writeFile(absolutePath, script.source, "utf8");
      bundleFiles.push(absolutePath);
      downloads.push({
        byteLength: Buffer.byteLength(script.source, "utf8"),
        contentHash,
        localPath: path.relative(args.outDir, absolutePath).replaceAll("\\", "/"),
        mimeType: script.mimeType,
        page: script.page,
        schemaVersion: captureArtifactSchemaVersion,
        targetId: script.attribution?.targetId ?? null,
        sessionId: script.sessionId ?? null,
        sourceMapUrl: sourceMapUrlForScript(script.source, script.url),
        status: script.status,
        url: script.url,
      });
    }

    await writeFile(
      path.join(args.outDir, "bundle-downloads.json"),
      `${JSON.stringify(downloads, null, 2)}\n`,
      "utf8",
    );

    const bundleCandidates = await mineJavascriptBundles({
      bundleFiles,
      cacheDir: args.bundleCacheDir,
      prefixes: uniqueSorted([
        ...args.matchPathPrefixes,
        "/_api/",
        "/admin/",
        "/api/",
        "/apiproxy/",
        "/beta/",
      ]),
    });
    await writeFile(
      path.join(args.outDir, "bundle-candidates.json"),
      `${JSON.stringify(bundleCandidates, null, 2)}\n`,
      "utf8",
    );
    latestBundleSummary = {
      bundleCount: bundleCandidates.bundleCount,
      candidateCount: bundleCandidates.candidates.length,
      graphqlOperationCount: bundleCandidates.graphqlOperations.length,
      parseFailureCount: bundleCandidates.parseFailures.length,
      cache: bundleCandidates.cache,
    };
  }

  async function flushArtifacts({ timeoutMs = args.finalizationTimeoutMs, phase = "artifact-flush" } = {}) {
    return withPhaseTimeout(async () => {
      await withPhaseTimeout(
        () => Promise.allSettled(Array.from(pendingBodyCaptures)),
        Math.min(timeoutMs, args.bodyCaptureTimeoutMs),
        "body-capture",
      );
      const filteredRequests = capturedRequests
        .filter((request) => request.url && request.method)
        .map((request) => ({
          ...request,
          matchesCurrentSpec: shouldMatchRequest(request.url, args),
        }));
      const apiRecords = filteredRequests
        .filter((request) => !request.probeId)
        .map((request) => toApiRecord(request, args.portal));
      const rawRequests = filteredRequests.map((request) => ({
        schemaVersion: captureArtifactSchemaVersion,
        attribution: request.attribution,
        evidenceId: request.evidenceId,
        ...requestEvidence(request),
        ...summarizeHeaderMetadata(request.headers ?? {}),
        ...summarizeResponseHeaderMetadata(request.responseHeaders ?? {}),
        failureText: request.failureText ?? null,
        matchesCurrentSpec: request.matchesCurrentSpec,
        method: request.method,
        mimeType: request.mimeType ?? null,
        pageLabel: request.pageLabel,
        probeId: request.probeId ?? null,
        probeOutcome: request.probeId ? probeOutcomes.get(request.probeId) ?? null : null,
        requestBody: request.requestBody ?? null,
        responseBody: request.responseBody ?? null,
        status: request.status ?? null,
        url: request.url,
      }));

      await withPhaseTimeout(
        writeBundleArtifacts,
        Math.min(timeoutMs, args.scriptCaptureTimeoutMs),
        "script-capture",
      );
      await writeMergedArray(
        path.join(args.outDir, "api-records.json"),
        apiRecords,
        (item) => `${item.method} ${item.path} ${item.requestFingerprint}`,
      );
      await writeMergedArray(
        path.join(args.outDir, "page-states.json"),
        pageStates,
        (item) => item.page,
      );
      await writeMergedArray(
        path.join(args.outDir, "session-snapshots.json"),
        sessionSnapshots,
        (item) => item.page,
      );
      await writeMergedArray(
        path.join(args.outDir, "script-urls.json"),
        scriptPages,
        (item) => item.page,
      );
      await writeMergedArray(
        path.join(args.outDir, "action-results.json"),
        actionResults,
        (item) => item.page,
      );
      await writeMergedArray(
        path.join(args.outDir, "raw-requests.json"),
        rawRequests,
        (item) => item.evidenceId ?? `${item.requestFingerprint} ${item.pageLabel}`,
      );
      await writeMergedArray(
        path.join(args.outDir, "probe-results.json"),
        probeResults,
        (item) => item.probeId ?? `${item.method} ${item.url} ${item.page}`,
      );
      await writeMergedArray(
        path.join(args.outDir, "stream-records.json"),
        passiveTransports,
        (item) => `${item.transport} ${item.url} ${item.page} ${item.attribution?.sessionId ?? "root"}`,
      );
    }, timeoutMs, phase);
  }

  async function capturePageScriptBodies(pageLabel) {
    for (const [sessionId, targetInfo] of sessions.entries()) {
      if (!isDomCapableTarget(sessionId, targetInfo)) {
        continue;
      }

      let resourceTree;
      try {
        resourceTree = await client.send("Page.getResourceTree", {}, sessionId);
      } catch {
        continue;
      }

      const frames = [];
      const visitFrame = (frameTree) => {
        if (!frameTree?.frame?.id) {
          return;
        }
        frames.push(frameTree);
        for (const childFrame of frameTree.childFrames ?? []) {
          visitFrame(childFrame);
        }
      };
      visitFrame(resourceTree.frameTree);

      for (const frameTree of frames) {
        for (const resource of frameTree.resources ?? []) {
          if (
            resource.type !== "Script"
            || !resource.url
            || !shouldRequestResponseBody(resource.contentSize)
          ) {
            continue;
          }
          const scriptRecord = [...scriptRecords]
            .reverse()
            .find((record) =>
              record.page === pageLabel
              && record.sessionId === sessionId
              && record.url === resource.url);
          if (!scriptRecord || scriptBodies.has(resource.url)) {
            continue;
          }
          try {
            const content = await client.send("Page.getResourceContent", {
              frameId: frameTree.frame.id,
              url: resource.url,
            }, sessionId);
            const source = decodeBoundedCdpBody(content);
            if (source) {
              scriptBodies.set(resource.url, {
                ...scriptRecord,
                mimeType: resource.mimeType ?? scriptRecord.mimeType,
                source,
                status: scriptRecord.status ?? 200,
              });
            }
          } catch {
            // Some cross-origin or browser-managed scripts do not expose resource content.
          }
        }
      }
    }
  }

  async function captureCheckpoint(pageLabel) {
    await delay(1000);
    const snapshots = await collectSnapshots();
    const rootSnapshot = snapshots.find((snapshot) => snapshot.sessionId === "root" && !snapshot.error) ?? snapshots[0] ?? {};
    setCaptureContext(pageLabel, currentActionIndex, rootSnapshot.url ?? null);
    const requestInventory = capturedRequests
      .filter((request) => request.pageLabel === pageLabel && !request.probeId)
      .map((request) => ({
        matchesCurrentSpec: shouldMatchRequest(request.url, args),
        attribution: request.attribution,
        method: request.method,
        path: new URL(request.url).pathname,
        sessionId: request.sessionId ?? null,
        status: request.status,
        targetId: request.attribution?.targetId ?? null,
        targetType: request.attribution?.targetType ?? null,
        url: request.url,
      }));
    const combinedLinks = uniqueSorted(
      snapshots.flatMap((snapshot) => (snapshot.sameOriginLinks ?? []).map((item) => item.url)),
    );
    const combinedTabs = uniqueSorted(
      snapshots.flatMap((snapshot) => snapshot.visibleTabs ?? []),
    );
    const combinedControls = uniqueSorted(
      snapshots.flatMap((snapshot) => (snapshot.controls ?? []).map((item) => item.text || item.ariaLabel || item.automationId || item.href)),
    );
    const combinedScriptUrls = uniqueSorted(
      scriptRecords
        .filter((record) => record.page === pageLabel)
        .map((record) => record.url),
    );
    const stateFingerprint = stateFingerprintFromSnapshot({
      controls: combinedControls,
      sameOriginLinks: combinedLinks,
      title: rootSnapshot.title ?? null,
      url: rootSnapshot.url ?? null,
      visibleTabs: combinedTabs,
    });

    pageStates.push({
      schemaVersion: captureArtifactSchemaVersion,
      page: pageLabel,
      readyState: rootSnapshot.readyState ?? null,
      requestInventory,
      sameOriginLinks: combinedLinks,
      scriptUrls: combinedScriptUrls,
      stateFingerprint,
      title: rootSnapshot.title ?? null,
      url: rootSnapshot.url ?? null,
      visibleControls: combinedControls,
      visibleTabs: combinedTabs,
    });
    sessionSnapshots.push({
      schemaVersion: captureArtifactSchemaVersion,
      checkpoint: currentContext,
      page: pageLabel,
      targets: attributionRegistry.snapshot(),
      sessionSnapshots: snapshots,
      url: rootSnapshot.url ?? null,
    });
    scriptPages.push({
      schemaVersion: captureArtifactSchemaVersion,
      page: pageLabel,
      scriptUrls: combinedScriptUrls,
      url: rootSnapshot.url ?? null,
    });

    if (args.captureScripts) {
      await capturePageScriptBodies(pageLabel);
    }
    await flushArtifacts();
    return {
      pageState: pageStates.at(-1),
      snapshots,
    };
  }

  async function navigateRoot(targetUrl) {
    const resolvedUrl = isAbsoluteUrl(targetUrl)
      ? String(targetUrl)
      : resolveMaybeRelativeUrl(targetUrl, await getRootUrl());
    const navigationPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        currentLoadResolver = null;
        resolve(false);
      }, args.navigationTimeoutMs);

      currentLoadResolver = () => {
        clearTimeout(timeout);
        currentLoadResolver = null;
        resolve(true);
      };
    });

    const navigateIssued = await Promise.race([
      client.send("Page.navigate", { url: resolvedUrl }).then(() => true).catch(() => false),
      delay(Math.min(args.navigationTimeoutMs, 5000)).then(() => false),
    ]);

    if (!navigateIssued) {
      await evaluateJson(client, `location.href = ${JSON.stringify(resolvedUrl)}`);
    }

    const didLoad = await navigationPromise;
    let settleResult = await waitForNetworkIdle(args.settleMs);

    let currentUrl = await getRootUrl();
    if (currentUrl !== resolvedUrl) {
      const currentOrigin = new URL(currentUrl).origin;
      const targetOrigin = new URL(resolvedUrl).origin;
      if (currentOrigin === targetOrigin) {
        await evaluateJson(client, `location.href = ${JSON.stringify(resolvedUrl)}`);
        settleResult = await waitForNetworkIdle(args.settleMs);
        currentUrl = await getRootUrl();
      }
    }

    return {
      didLoad,
      resolvedUrl,
      settleResult,
      url: currentUrl,
    };
  }

  function getOrderedSessions(scope) {
    const entries = Array.from(sessions.entries());
    return entries
      .filter(([sessionId, targetInfo]) => {
        if (!isDomCapableTarget(sessionId, targetInfo)) {
          return false;
        }

        if (scope === "root") {
          return sessionId === null;
        }

        if (scope === "iframe") {
          return targetInfo?.targetType === "iframe";
        }

        return true;
      })
      .sort((left, right) => {
        const [leftSessionId, leftInfo] = left;
        const [rightSessionId, rightInfo] = right;
        const leftRank = leftSessionId === null ? 0 : leftInfo?.targetType === "iframe" ? 1 : 2;
        const rightRank = rightSessionId === null ? 0 : rightInfo?.targetType === "iframe" ? 1 : 2;
        return leftRank - rightRank;
      });
  }

  async function runClickAction(action, preActionSnapshots = null) {
    const beforeUrl = await getRootUrl();
    const beforeStateFingerprint = await getRootStateFingerprint();
    const beforeTargetIds = new Set(sessions.keys());
    const beforeSnapshots = preActionSnapshots ?? await collectSnapshots();
    const eligibility = deriveActionEligibility(action, beforeSnapshots);
    for (const [sessionId, targetInfo] of getOrderedSessions(action.scope)) {
      try {
        attributionRegistry.setSessionContext(sessionId, currentContext);
        const result = await evaluateJson(client, buildClickExpression(action), sessionId);
        if (!result?.clicked) {
          continue;
        }

        const settleResult = await waitForNetworkIdle(args.postActionSettleMs);
        const afterUrl = await getRootUrl();
        const afterStateFingerprint = await getRootStateFingerprint();
        return {
          ...result,
          afterStateFingerprint,
          afterUrl,
          beforeUrl,
          beforeStateFingerprint,
          eligibility,
          sessionId: sessionId ?? "root",
          settleResult,
          stateTransition: Boolean(
            beforeStateFingerprint
            && afterStateFingerprint
            && beforeStateFingerprint !== afterStateFingerprint,
          ),
          targetTransition: Array.from(sessions.keys()).some(
            (targetId) => !beforeTargetIds.has(targetId),
          ),
          targetTitle: targetInfo?.targetTitle ?? null,
          targetType: targetInfo?.targetType ?? "page",
          targetUrl: targetInfo?.targetUrl ?? null,
        };
      } catch {
        // Try the next session.
      }
    }

    return {
      afterUrl: beforeUrl,
      beforeUrl,
      clicked: false,
      eligibility,
    };
  }

  async function runSeededReplayAction(action, basePageLabel) {
    if (seedArtifacts.pageStates.length === 0) {
      return {
        replayedCount: 0,
        seedArtifacts: args.seedArtifacts,
        sourcePages: [],
      };
    }

    const rootOrigin = new URL(await getRootUrl()).origin;
    const seededLinks = collectSeededLinkCandidates(seedArtifacts.pageStates, rootOrigin, args, action);
    const replayed = [];

    for (const [linkIndex, seededLink] of seededLinks.entries()) {
      const linkPageLabel = `${basePageLabel}-${String(linkIndex + 1).padStart(2, "0")}-${slugify(seededLink.url)}`;
      setCaptureContext(linkPageLabel);
      const navigationResult = await navigateRoot(seededLink.url);
      actionResults.push({
        actionIndex: currentActionIndex,
        page: linkPageLabel,
        result: {
          ...navigationResult,
          sourcePage: seededLink.sourcePage,
        },
        scope: action.scope,
        sourcePage: seededLink.sourcePage,
        type: action.type,
        value: seededLink.url,
      });
      replayed.push({
        page: linkPageLabel,
        sourcePage: seededLink.sourcePage,
        url: seededLink.url,
      });
      await captureCheckpoint(linkPageLabel);
    }

    setCaptureContext(basePageLabel);

    return {
      replayedCount: replayed.length,
      seedArtifacts: args.seedArtifacts,
      sourcePages: uniqueSorted(replayed.map((item) => item.sourcePage)),
      urls: replayed.map((item) => item.url),
    };
  }

  async function runSeededRouteReplayAction(action, basePageLabel) {
    const rootOrigin = new URL(await getRootUrl()).origin;
    const seededRoutes = collectSeededRouteCandidates(seedArtifacts, rootOrigin, args, action);
    const replayed = [];

    for (const [routeIndex, seededRoute] of seededRoutes.entries()) {
      const routePageLabel = `${basePageLabel}-${String(routeIndex + 1).padStart(2, "0")}-${slugify(seededRoute.url)}`;
      setCaptureContext(routePageLabel);
      const navigationResult = await navigateRoot(seededRoute.url);
      actionResults.push({
        actionIndex: currentActionIndex,
        page: routePageLabel,
        result: {
          ...navigationResult,
          seedValue: seededRoute.seedValue,
          sourceArtifact: seededRoute.sourceArtifact,
        },
        scope: action.scope,
        sourceArtifact: seededRoute.sourceArtifact,
        type: action.type,
        value: seededRoute.url,
      });
      replayed.push(seededRoute);
      await captureCheckpoint(routePageLabel);
    }

    setCaptureContext(basePageLabel);

    return {
      replayedCount: replayed.length,
      seedArtifacts: args.seedArtifacts,
      sourceArtifacts: uniqueSorted(replayed.map((item) => item.sourceArtifact)),
      seedValues: uniqueSorted(replayed.map((item) => item.seedValue)),
      urls: replayed.map((item) => item.url),
    };
  }

  async function runCurrentLinkCrawlAction(action, basePageLabel) {
    const rootOrigin = new URL(await getRootUrl()).origin;
    const linkFilters = String(action.value || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value && value.toLowerCase() !== "all");
    const crawlArgs = {
      ...args,
      seedLinkContains: linkFilters.length > 0 ? linkFilters : args.seedLinkContains,
      seedPages: [],
    };
    const visitedUrls = new Set(
      pageStates.map((pageState) => pageState.url).filter(Boolean),
    );
    const visitedStates = new Set(
      pageStates.map((pageState) => pageState.stateFingerprint).filter(Boolean),
    );
    const queuedUrls = new Set();
    const queue = [];
    const replayed = [];

    function enqueueFrom(states) {
      const candidates = collectSeededLinkCandidates(
        states,
        rootOrigin,
        crawlArgs,
        { ...action, value: "all" },
        Number.MAX_SAFE_INTEGER,
      );
      for (const candidate of candidates) {
        if (
          visitedUrls.has(candidate.url)
          || queuedUrls.has(candidate.url)
          || /(?:log-?out|sign-?out|logoff)/iu.test(candidate.url)
        ) {
          continue;
        }
        queuedUrls.add(candidate.url);
        queue.push(candidate);
      }
    }

    enqueueFrom(pageStates);
    while (queue.length > 0 && replayed.length < args.seedLinkLimit) {
      const candidate = queue.shift();
      queuedUrls.delete(candidate.url);
      visitedUrls.add(candidate.url);
      const pageLabel = `${basePageLabel}-${String(replayed.length + 1).padStart(2, "0")}-${slugify(candidate.url)}`;
      setCaptureContext(pageLabel);
      const navigationResult = await navigateRoot(candidate.url);
      await captureCheckpoint(pageLabel);
      const currentState = pageStates.at(-1);
      const repeatedState = currentState?.stateFingerprint
        ? visitedStates.has(currentState.stateFingerprint)
        : false;
      if (currentState?.stateFingerprint) {
        visitedStates.add(currentState.stateFingerprint);
      }
      replayed.push({
        page: pageLabel,
        repeatedState,
        sourcePage: candidate.sourcePage,
        url: candidate.url,
      });
      actionResults.push({
        actionIndex: currentActionIndex,
        page: pageLabel,
        result: {
          ...navigationResult,
          repeatedState,
          sourcePage: candidate.sourcePage,
        },
        scope: action.scope,
        sourcePage: candidate.sourcePage,
        type: action.type,
        value: candidate.url,
      });
      if (!repeatedState) {
        enqueueFrom([currentState]);
      }
    }

    setCaptureContext(basePageLabel);
    return {
      replayedCount: replayed.length,
      repeatedStateCount: replayed.filter((item) => item.repeatedState).length,
      urls: replayed.map((item) => item.url),
    };
  }

  async function runProbeGetAction(action, pageLabel, actionIndex) {
    for (const [attempt, [sessionId, targetInfo]] of getOrderedSessions(action.scope).entries()) {
      try {
        attributionRegistry.setSessionContext(sessionId, currentContext);
        const probeUrl = await evaluateJson(
          client,
          `new URL(${JSON.stringify(String(action.value || ""))}, location.href).toString()`,
          sessionId,
        );
        const attribution = attributionRegistry.resolve({
          sessionId,
          targetUrl: targetInfo?.targetUrl ?? null,
        });
        const probeId = buildStableEvidenceId("probe", {
          actionIndex,
          attempt,
          frameId: attribution.frameId,
          normalizedUrl: normalizeAttributionUrl(probeUrl),
          pageLabel,
          sessionId: attribution.sessionId,
          targetId: attribution.targetId,
        });
        probeAssociations.set(
          `${sessionId ?? "root"}:${normalizeAttributionUrl(probeUrl)}`,
          probeId,
        );
        const result = await evaluateJson(
          client,
          buildProbeExpression(action.value),
          sessionId,
          Math.max(runtimeEvaluateTimeoutMs, args.navigationTimeoutMs),
        );
        if (!result?.url) {
          probeOutcomes.set(probeId, "probe-failed");
          continue;
        }
        const sanitizedResult = {
          ...result,
          body: truncate(sanitizeCapturedBody(result.body ?? null)),
        };
        const outcome = result.rejected
          ? "rejected"
          : result.redirected
            ? "redirect-blocked"
            : result.ok
              ? "confirmed"
              : result.status === 401 || result.status === 403
                ? "auth-blocked"
                : result.status === 404
                  ? "not-found"
                  : result.error
                    ? "probe-failed"
                    : "http-error";
        probeOutcomes.set(probeId, outcome);
        const parsed = new URL(result.url);
        probeResults.push({
          attribution,
          probeId,
          schemaVersion: captureArtifactSchemaVersion,
          method: "GET",
          outcome,
          page: pageLabel,
          path: parsed.pathname,
          querySamples: parsed.search ? [parsed.search] : [],
          responseBodySample: sanitizedResult.body,
          status: result.status,
          url: result.url,
        });
        return {
          ...sanitizedResult,
          outcome,
          sessionId: sessionId ?? "root",
          targetTitle: targetInfo?.targetTitle ?? null,
          targetType: targetInfo?.targetType ?? "page",
        };
      } catch {
        // Try another DOM-capable target.
      }
    }
    return {
      outcome: "probe-failed",
      url: action.value,
    };
  }

  await client.connect();
  await configureSession();
  await client.send("Target.setAutoAttach", {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: true,
  });

  try {
    setCaptureContext(args.label ?? "seed-00", -1, args.url);
    const initialNavigation = await navigateRoot(args.url);
    actionResults.push({
      actionIndex: -1,
      allowCanonicalRedirect: true,
      page: currentContext.pageLabel,
      required: true,
      result: initialNavigation,
      type: "navigate",
      value: args.url,
    });
    await captureCheckpoint(currentContext.pageLabel);

    for (const [index, action] of args.actions.entries()) {
      const pageLabel = buildActionLabel(action, index);
      currentActionIndex = index;
      setCaptureContext(pageLabel);

      if (action.type === "wait-ms") {
        await delay(Number(action.value));
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: { waitedMs: Number(action.value) },
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await captureCheckpoint(pageLabel);
        continue;
      }

      if (action.type === "capture") {
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: { capturedOnly: true },
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await captureCheckpoint(pageLabel);
        continue;
      }

      if (action.type === "navigate") {
        const navigationResult = await navigateRoot(action.value);
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: navigationResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await captureCheckpoint(pageLabel);
        continue;
      }

      if (action.type === "probe-get") {
        const probeResult = await runProbeGetAction(action, pageLabel, index);
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: probeResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await waitForNetworkIdle(args.postActionSettleMs);
        await captureCheckpoint(pageLabel);
        continue;
      }

      if (action.type === "crawl-links") {
        const crawlResult = await runCurrentLinkCrawlAction(action, pageLabel);
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: crawlResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await flushArtifacts();
        continue;
      }

      if (action.type === "replay-seeded-links") {
        const replayResult = await runSeededReplayAction(action, pageLabel);
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: replayResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await flushArtifacts();
        continue;
      }

      if (action.type === "replay-seeded-routes") {
        const replayResult = await runSeededRouteReplayAction(action, pageLabel);
        actionResults.push({
          actionIndex: index,
          page: pageLabel,
          required: action.required,
          result: replayResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await flushArtifacts();
        continue;
      }

      const beforeSnapshots = await collectSnapshots();
      const beforePageState = pageStates.at(-1);
      const beforeUrl = await getRootUrl();
      const beforeRequestFamilies = new Set(capturedRequests.map(requestFamily));
      const clickResult = await runClickAction(action, beforeSnapshots);
      const actionResult = {
        actionIndex: index,
        highValue: action.highValue === true,
        page: pageLabel,
        required: action.required,
        result: clickResult,
        scope: action.scope,
        type: action.type,
        value: action.value,
      };
      actionResults.push(actionResult);
      const checkpoint = await captureCheckpoint(pageLabel);
      const afterRequestFamilies = new Set(capturedRequests.map(requestFamily));
      actionResult.result.transitionEvidence = buildTransitionEvidence({
        afterPageState: checkpoint?.pageState,
        afterSnapshots: checkpoint?.snapshots,
        afterUrl: clickResult.afterUrl ?? await getRootUrl(),
        beforePageState,
        beforeSnapshots,
        beforeUrl,
        newRequestFamilies: Array.from(afterRequestFamilies)
          .filter((family) => !beforeRequestFamilies.has(family))
          .sort(),
      });
    }

    await waitForNetworkIdle(args.postActionSettleMs);
    await flushArtifacts();
    const filteredRequests = capturedRequests.filter((request) => shouldMatchRequest(request.url, args));
    const scopedHosts = uniqueSorted(filteredRequests.map((request) => {
      try {
        return new URL(request.url).hostname;
      } catch {
        return null;
      }
    }));
    const actionValidation = summarizeActionResults(actionResults, {
      includeInteractionHealth: true,
    });
    const actionBudget = validateActionBudgetResult(actionResults, args.actionBudget);
    const summary = {
      schemaVersion: captureArtifactSchemaVersion,
      actionValidation,
      actions: actionResults.length,
      actionBudget,
      bundleDiscovery: latestBundleSummary,
      capturedApiRequests: capturedRequests.length,
      finalUrl: await getRootUrl(),
      interactionHealth: actionValidation.interactionHealth,
      outDir: args.outDir,
      pageCount: pageStates.length,
      passiveTransportCount: passiveTransports.length,
      portal: args.portal,
      recipePath: args.recipePath,
      reusedExistingTarget: Boolean(target.reusedExistingTarget),
      scopedHosts,
      scopedRequestCount: filteredRequests.length,
      seedArtifacts: args.seedArtifacts,
      startUrl: args.url,
      targetId: target.id ?? args.targetId ?? null,
    };

    await writeFile(
      path.join(args.outDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
    if (target.closeWhenDone) {
      await closeTarget(target.id);
    }
  }
}

main().catch(async (error) => {
  try {
    const argv = process.argv.slice(2);
    const outIndex = argv.findIndex((arg) => arg === "--out");
    const outputPath = argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
      ?? (outIndex >= 0 ? argv[outIndex + 1] : null);
    if (outputPath) {
      await writeCaptureFailure({ outDir: path.resolve(outputPath) }, error);
    }
  } catch (metadataError) {
    console.error("Failed to write capture failure metadata:", metadataError);
  }
  console.error(error);
  process.exitCode = 1;
});
