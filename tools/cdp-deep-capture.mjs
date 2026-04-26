import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const apiBase = "http://127.0.0.1:9222";
const defaultNavigationTimeoutMs = 15000;
const defaultSeedLinkLimit = 12;
const defaultSeedRouteLimit = 8;
const defaultSettleMs = 8000;
const defaultPostActionSettleMs = 6000;
const defaultEvaluateTimeoutMs = 10000;
let runtimeEvaluateTimeoutMs = defaultEvaluateTimeoutMs;

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
    "navigate",
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
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

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

  try {
    const placeholderOrigin = "https://placeholder.invalid";
    const parsed = new URL(value, placeholderOrigin);

    for (const [key] of parsed.searchParams) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
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
  return parseActionSpec(`${scopedType}=${action.value ?? ""}`);
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

  if (Number.isFinite(Number(recipeConfig.evaluateTimeoutMs))) {
    args.evaluateTimeoutMs = Number(recipeConfig.evaluateTimeoutMs);
  }

  if (recipeConfig.actions) {
    args.actions = ensureArray(recipeConfig.actions).map(normalizeRecipeAction);
  }

  args.seedRouteGroups = normalizeSeedRouteGroups(recipeConfig.seedRouteGroups);
}

async function parseArgs(argv) {
  const args = {
    actions: [],
    evaluateTimeoutMs: defaultEvaluateTimeoutMs,
    label: null,
    matchHosts: [],
    matchPathPrefixes: [],
    navigationTimeoutMs: defaultNavigationTimeoutMs,
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

    if (arg === "--out" && next) {
      args.outDir = path.resolve(next);
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

  if (!args.portal) {
    throw new Error("Missing required --portal argument.");
  }

  if (!args.outDir) {
    throw new Error("Missing required --out argument.");
  }

  for (const key of ["evaluateTimeoutMs", "navigationTimeoutMs", "postActionSettleMs", "settleMs"]) {
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

  await writeFile(filePath, `${JSON.stringify(Array.from(merged.values()), null, 2)}\n`, "utf8");
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
  }

  rejectPending(error) {
    for (const { reject } of this.pending.values()) {
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

    this.socket.addEventListener("close", () => {
      this.socketClosed = true;
      this.rejectPending(new Error("CDP WebSocket closed."));
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
      throw new Error("CDP WebSocket is not open.");
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
      this.pending.set(key, { resolve, reject });
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
        this.socket.close();
      }
    });

    this.socketClosed = true;
  }
}

function requestKey(requestId, sessionId = null) {
  return `${sessionId ?? ""}:${requestId}`;
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

function toApiRecord(request, portalName) {
  try {
    const parsed = new URL(request.url);
    const querySample = parsed.search ? parsed.search : null;
    return {
      confidence: "confirmed-traffic",
      method: request.method,
      path: parsed.pathname,
      portalName,
      querySamples: querySample ? [querySample] : [],
      requestBodySamples: request.requestBody ? [request.requestBody] : [],
      responseBodySample: request.responseBody ?? null,
      seenOnPages: [request.pageLabel],
      url: request.url,
    };
  } catch {
    return {
      confidence: "confirmed-traffic",
      method: request.method,
      path: request.url,
      portalName,
      querySamples: [],
      requestBodySamples: request.requestBody ? [request.requestBody] : [],
      responseBodySample: request.responseBody ?? null,
      seenOnPages: [request.pageLabel],
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

function collectSeededLinkCandidates(seedPageStates, rootOrigin, args, action) {
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
        if (parsed.origin !== rootOrigin || excludedLinks.has(normalizedUrlLower)) {
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

  return candidates.slice(0, args.seedLinkLimit);
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
          if (seenUrls.has(normalizedUrl)) {
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
  const capturedRequests = [];
  const pageStates = [];
  const sessionSnapshots = [];
  const scriptPages = [];
  const scriptRecords = [];
  const actionResults = [];
  const configuredSessions = new Set();
  const sessions = new Map([
    [null, { targetTitle: target.title ?? null, targetType: "page", targetUrl: target.url ?? null }],
  ]);
  let activePageLabel = args.label ?? "seed-00";
  let currentLoadResolver = null;

  async function configureSession(sessionId = null) {
    const key = sessionId ?? "root";
    if (configuredSessions.has(key)) {
      return;
    }

    for (const [method, params] of [
      ["Runtime.enable", {}],
      ["Network.enable", { maxPostDataSize: 1024 * 128 }],
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
    if (metadata.sessionId) {
      return;
    }

    const childSessionId = params.sessionId ?? null;
    if (!childSessionId) {
      return;
    }

    sessions.set(childSessionId, {
      targetTitle: params.targetInfo?.title ?? null,
      targetType: params.targetInfo?.type ?? null,
      targetUrl: params.targetInfo?.url ?? null,
    });

    try {
      await configureSession(childSessionId);
      await client.send("Runtime.runIfWaitingForDebugger", {}, childSessionId);
    } catch {
      // Best effort only.
    }
  });

  client.on("Network.requestWillBeSent", (params, metadata) => {
    const resourceType = params.type ?? params.initiator?.type ?? "";
    const requestUrl = params.request?.url;
    const sessionId = metadata.sessionId ?? null;

    if (resourceType === "Script" && requestUrl) {
      scriptRecords.push({
        page: activePageLabel,
        sessionId,
        url: requestUrl,
      });
    }

    if (!["Fetch", "XHR"].includes(resourceType) || !requestUrl) {
      return;
    }

    requestMap.set(requestKey(params.requestId, sessionId), {
      headers: params.request.headers ?? {},
      method: params.request.method,
      pageLabel: activePageLabel,
      requestBody: truncate(sanitizeCapturedBody(params.request.postData ?? null)),
      resourceType,
      sessionId,
      startedAt: params.timestamp,
      url: requestUrl,
    });
  });

  client.on("Network.responseReceived", (params, metadata) => {
    const record = requestMap.get(requestKey(params.requestId, metadata.sessionId));
    if (!record) {
      return;
    }

    record.mimeType = params.response?.mimeType ?? null;
    record.responseHeaders = params.response?.headers ?? {};
    record.status = params.response?.status ?? null;
  });

  client.on("Network.loadingFailed", (params, metadata) => {
    const record = requestMap.get(requestKey(params.requestId, metadata.sessionId));
    if (!record) {
      return;
    }

    record.failureText = params.errorText ?? "loading failed";
    capturedRequests.push(record);
    requestMap.delete(requestKey(params.requestId, metadata.sessionId));
  });

  client.on("Network.loadingFinished", async (params, metadata) => {
    const record = requestMap.get(requestKey(params.requestId, metadata.sessionId));
    if (!record) {
      return;
    }

    try {
      const body = await client.send("Network.getResponseBody", {
        requestId: params.requestId,
      }, metadata.sessionId);
      record.responseBody = truncate(
        sanitizeCapturedBody(
          body?.base64Encoded
            ? Buffer.from(body.body, "base64").toString("utf8")
            : body?.body ?? null,
        ),
      );
    } catch {
      record.responseBody = null;
    }

    capturedRequests.push(record);
    requestMap.delete(requestKey(params.requestId, metadata.sessionId));
  });

  async function getRootUrl() {
    return evaluateJson(client, "location.href");
  }

  async function collectSnapshots() {
    const snapshots = [];
    for (const [sessionId, targetInfo] of sessions.entries()) {
      if (!isDomCapableTarget(sessionId, targetInfo)) {
        continue;
      }

      try {
        const snapshot = await evaluateJson(client, buildDomSnapshotExpression(), sessionId);
        if (!snapshot) {
          continue;
        }

        snapshots.push({
          sessionId: sessionId ?? "root",
          targetTitle: targetInfo?.targetTitle ?? null,
          targetType: targetInfo?.targetType ?? "page",
          targetUrl: targetInfo?.targetUrl ?? null,
          ...snapshot,
        });
      } catch (error) {
        snapshots.push({
          error: error instanceof Error ? error.message : String(error),
          sessionId: sessionId ?? "root",
          targetTitle: targetInfo?.targetTitle ?? null,
          targetType: targetInfo?.targetType ?? "page",
          targetUrl: targetInfo?.targetUrl ?? null,
        });
      }
    }

    return snapshots;
  }

  async function flushArtifacts() {
    const filteredRequests = capturedRequests
      .filter((request) => request.url && request.method)
      .map((request) => ({
        ...request,
        matchesCurrentSpec: shouldMatchRequest(request.url, args),
      }));
    const apiRecords = filteredRequests.map((request) => toApiRecord(request, args.portal));
    const rawRequests = filteredRequests.map((request) => ({
      ...summarizeHeaderMetadata(request.headers ?? {}),
      ...summarizeResponseHeaderMetadata(request.responseHeaders ?? {}),
      failureText: request.failureText ?? null,
      matchesCurrentSpec: request.matchesCurrentSpec,
      method: request.method,
      mimeType: request.mimeType ?? null,
      pageLabel: request.pageLabel,
      requestBody: request.requestBody ?? null,
      responseBody: request.responseBody ?? null,
      status: request.status ?? null,
      url: request.url,
    }));

    await writeMergedArray(
      path.join(args.outDir, "api-records.json"),
      apiRecords,
      (item) => `${item.method} ${item.path}`,
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
      (item) => `${item.method} ${item.url} ${item.pageLabel}`,
    );
  }

  async function captureCheckpoint(pageLabel) {
    await delay(1000);
    const snapshots = await collectSnapshots();
    const rootSnapshot = snapshots.find((snapshot) => snapshot.sessionId === "root" && !snapshot.error) ?? snapshots[0] ?? {};
    const requestInventory = capturedRequests
      .filter((request) => request.pageLabel === pageLabel)
      .map((request) => ({
        matchesCurrentSpec: shouldMatchRequest(request.url, args),
        method: request.method,
        path: new URL(request.url).pathname,
        status: request.status,
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

    pageStates.push({
      page: pageLabel,
      readyState: rootSnapshot.readyState ?? null,
      requestInventory,
      sameOriginLinks: combinedLinks,
      scriptUrls: combinedScriptUrls,
      title: rootSnapshot.title ?? null,
      url: rootSnapshot.url ?? null,
      visibleControls: combinedControls,
      visibleTabs: combinedTabs,
    });
    sessionSnapshots.push({
      page: pageLabel,
      sessionSnapshots: snapshots,
      url: rootSnapshot.url ?? null,
    });
    scriptPages.push({
      page: pageLabel,
      scriptUrls: combinedScriptUrls,
      url: rootSnapshot.url ?? null,
    });

    await flushArtifacts();
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
    await delay(args.settleMs);

    let currentUrl = await getRootUrl();
    if (currentUrl !== resolvedUrl) {
      const currentOrigin = new URL(currentUrl).origin;
      const targetOrigin = new URL(resolvedUrl).origin;
      if (currentOrigin === targetOrigin) {
        await evaluateJson(client, `location.href = ${JSON.stringify(resolvedUrl)}`);
        await delay(args.settleMs);
        currentUrl = await getRootUrl();
      }
    }

    return {
      didLoad,
      resolvedUrl,
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

  async function runClickAction(action) {
    const beforeUrl = await getRootUrl();
    for (const [sessionId, targetInfo] of getOrderedSessions(action.scope)) {
      try {
        const result = await evaluateJson(client, buildClickExpression(action), sessionId);
        if (!result?.clicked) {
          continue;
        }

        await delay(args.postActionSettleMs);
        return {
          ...result,
          afterUrl: await getRootUrl(),
          beforeUrl,
          sessionId: sessionId ?? "root",
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
      activePageLabel = linkPageLabel;
      const navigationResult = await navigateRoot(seededLink.url);
      actionResults.push({
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

    activePageLabel = basePageLabel;

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
      activePageLabel = routePageLabel;
      const navigationResult = await navigateRoot(seededRoute.url);
      actionResults.push({
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

    activePageLabel = basePageLabel;

    return {
      replayedCount: replayed.length,
      seedArtifacts: args.seedArtifacts,
      sourceArtifacts: uniqueSorted(replayed.map((item) => item.sourceArtifact)),
      seedValues: uniqueSorted(replayed.map((item) => item.seedValue)),
      urls: replayed.map((item) => item.url),
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
    activePageLabel = args.label ?? "seed-00";
    const initialNavigation = await navigateRoot(args.url);
    actionResults.push({
      page: activePageLabel,
      result: initialNavigation,
      type: "navigate",
      value: args.url,
    });
    await captureCheckpoint(activePageLabel);

    for (const [index, action] of args.actions.entries()) {
      const pageLabel = buildActionLabel(action, index);
      activePageLabel = pageLabel;

      if (action.type === "wait-ms") {
        await delay(Number(action.value));
        actionResults.push({
          page: pageLabel,
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
          page: pageLabel,
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
          page: pageLabel,
          result: navigationResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await captureCheckpoint(pageLabel);
        continue;
      }

      if (action.type === "replay-seeded-links") {
        const replayResult = await runSeededReplayAction(action, pageLabel);
        actionResults.push({
          page: pageLabel,
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
          page: pageLabel,
          result: replayResult,
          scope: action.scope,
          type: action.type,
          value: action.value,
        });
        await flushArtifacts();
        continue;
      }

      const clickResult = await runClickAction(action);
      actionResults.push({
        page: pageLabel,
        result: clickResult,
        scope: action.scope,
        type: action.type,
        value: action.value,
      });
      await captureCheckpoint(pageLabel);
    }

    const filteredRequests = capturedRequests.filter((request) => shouldMatchRequest(request.url, args));
    const scopedHosts = uniqueSorted(filteredRequests.map((request) => {
      try {
        return new URL(request.url).hostname;
      } catch {
        return null;
      }
    }));
    const summary = {
      actions: actionResults.length,
      capturedApiRequests: capturedRequests.length,
      outDir: args.outDir,
      pageCount: pageStates.length,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
