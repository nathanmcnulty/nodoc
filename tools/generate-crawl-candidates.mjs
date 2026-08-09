import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

import { sanitizeObservedHostFamily } from "./discovery-safety.mjs";
import { getCandidateSuppressions } from "./portal-discovery-metadata.mjs";
import { buildSpecRouteInventory } from "./spec-quality-lib.mjs";

const httpMethods = new Set([
  "GET",
  "PUT",
  "POST",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
]);
const evidencePriority = {
  confirmed: 3,
  probed: 2,
  "bundle-discovered": 1,
};
const artifactFiles = {
  apiRecords: "api-records.json",
  pageStates: "page-states.json",
  probeResults: "probe-results.json",
  scriptUrls: "script-urls.json",
  bundleCandidates: "bundle-candidates.json",
  bundleDownloads: "bundle-downloads.json",
};

function stripBom(value) {
  return typeof value === "string" ? value.replace(/^\uFEFF/u, "") : value;
}

function parseArgs(argv) {
  const args = {
    artifacts: null,
    bundleDir: null,
    includeAdjacent: false,
    includeDocumented: false,
    json: false,
    output: null,
    spec: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--include-documented") {
      args.includeDocumented = true;
      continue;
    }

    if (arg === "--include-adjacent") {
      args.includeAdjacent = true;
      continue;
    }

    if (arg === "--artifacts" && next) {
      args.artifacts = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifacts=")) {
      args.artifacts = arg.slice("--artifacts=".length);
      continue;
    }

    if (arg === "--bundle-dir" && next) {
      args.bundleDir = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--bundle-dir=")) {
      args.bundleDir = arg.slice("--bundle-dir=".length);
      continue;
    }

    if (arg === "--output" && next) {
      args.output = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length);
      continue;
    }

    if (arg === "--spec" && next) {
      args.spec = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--spec=")) {
      args.spec = arg.slice("--spec=".length);
      continue;
    }
  }

  if (!args.spec) {
    throw new Error("Missing required --spec <title-or-spec-id> argument.");
  }

  if (!args.artifacts) {
    throw new Error("Missing required --artifacts <directory> argument.");
  }

  return {
    ...args,
    artifacts: path.resolve(args.artifacts),
    bundleDir: args.bundleDir ? path.resolve(args.bundleDir) : null,
    output: args.output ? path.resolve(args.output) : null,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(stripBom(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function normalizePath(pathValue) {
  return `/${String(pathValue || "")
    .replace(/^\/+/u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/$/u, "")}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function pathTemplateToRegex(pathTemplate) {
  return new RegExp(
    `^${escapeRegex(normalizePath(pathTemplate)).replace(/\\\{[^}]+\\\}/gu, "[^/]+")}$`,
    "u",
  );
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function isLikelyEmail(value) {
  return /^[^/@"'\s]+@[^/@"'\s]+\.[^/@"'\s]+$/u.test(value);
}

function isLikelyIdentifier(value) {
  const candidate = String(value || "").trim();
  return (
    /^\{[^}]+\}$/u.test(candidate)
    || /^[0-9]{4,}$/u.test(candidate)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)
    || /^[0-9a-f]{16,}$/iu.test(candidate)
    || /^[A-Za-z0-9_-]{20,}$/u.test(candidate) && /\d/u.test(candidate)
    || /^https?:/iu.test(candidate)
    || /%2F/iu.test(candidate)
  );
}

function normalizeParenthesizedValue(inner) {
  const trimmed = String(inner || "").trim();
  if (!trimmed) {
    return "";
  }

  const quote =
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith("\"") && trimmed.endsWith("\""))
      ? trimmed[0]
      : "";
  const unquoted = quote ? trimmed.slice(1, -1) : trimmed;
  let normalized = unquoted;

  if (isLikelyEmail(unquoted)) {
    normalized = "{email}";
  } else if (isLikelyIdentifier(unquoted)) {
    normalized = "{id}";
  }

  return quote ? `${quote}${normalized}${quote}` : normalized;
}

function normalizeSegment(segment) {
  if (!segment) {
    return segment;
  }

  let normalized = segment;
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original value when it is not valid URL encoding.
  }

  normalized = normalized.replace(/\(([^)]*)\)/gu, (_match, inner) => (
    `(${normalizeParenthesizedValue(inner)})`
  ));

  if (isLikelyEmail(normalized)) {
    return "{email}";
  }

  if (isLikelyIdentifier(normalized)) {
    return "{id}";
  }

  return normalized;
}

function normalizeRoutePath(pathValue) {
  if (!pathValue) {
    return null;
  }

  let pathname = String(pathValue).trim();
  try {
    if (/^https?:\/\//iu.test(pathname)) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    // Leave non-URL strings untouched and normalize below.
  }

  pathname = pathname.split("?")[0];
  const normalized = normalizePath(pathname);
  const segments = normalized.replace(/^\/+/u, "").split("/").filter(Boolean);

  if (segments.length === 0) {
    return "/";
  }

  return `/${segments.map((segment) => normalizeSegment(segment)).join("/")}`;
}

const scopeIdentifierParents = new Set([
  "environments",
  "organizations",
  "resourcegroups",
  "subscriptions",
  "tenants",
]);

function sanitizeScopeReviewPath(pathValue) {
  const segments = String(pathValue || "").replace(/^\/+/u, "").split("/").filter(Boolean);
  return `/${segments.map((segment, index) => {
    const normalized = normalizeSegment(segment);
    const parent = String(segments[index - 1] || "").toLowerCase();
    if (
      normalized !== "{id}"
      && (
        scopeIdentifierParents.has(parent)
        || /^[A-Za-z0-9_-]{12,}$/u.test(normalized) && /\d/u.test(normalized)
      )
    ) {
      return "{id}";
    }
    return normalized;
  }).join("/")}`;
}

function extractHostname(value) {
  if (typeof value !== "string" || !/^https?:\/\//iu.test(value.trim())) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeMethod(method) {
  const normalized = String(method || "").trim().toUpperCase();
  return httpMethods.has(normalized) ? normalized : null;
}

function deriveFeatureFamily(pathname) {
  const segments = String(pathname || "").split("/").filter(Boolean);
  if (segments.length === 0) {
    return "/";
  }

  const genericRoots = new Set([
    "api",
    "apiproxy",
    "beta",
    "odata",
    "v1",
    "v1.0",
    "v2",
    "v2.0",
    "v3",
    "v3.0",
  ]);

  if (segments.length >= 2 && genericRoots.has(segments[0].toLowerCase())) {
    return `/${segments[0]}/${segments[1]}`;
  }

  return `/${segments[0]}`;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function collectQueryParameterNames(record) {
  const names = new Set();

  for (const candidate of [
    record?.url,
    ...(Array.isArray(record?.querySamples) ? record.querySamples : []),
  ]) {
    if (typeof candidate !== "string" || !candidate.includes("?")) {
      continue;
    }

    const queryString = /^https?:\/\//iu.test(candidate)
      ? new URL(candidate).search
      : candidate.slice(candidate.indexOf("?"));
    const params = new URLSearchParams(queryString);
    for (const key of params.keys()) {
      names.add(key);
    }
  }

  if (record?.query && typeof record.query === "object" && !Array.isArray(record.query)) {
    for (const key of Object.keys(record.query)) {
      names.add(key);
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function extractRequiredInputs(observation) {
  const inputs = new Set(observation.queryParameters);
  if (observation.normalizedPath.includes("{id}") || observation.normalizedPath.includes("{email}")) {
    inputs.add("path-identifiers");
  }

  return Array.from(inputs).sort((left, right) => left.localeCompare(right));
}

function safeMethodToTest(method) {
  if (!method) {
    return "GET";
  }

  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return method;
  }

  return `${method} (manual review)`;
}

function confidenceForObservation(evidence, pageCount, queryCount) {
  const baseScore = {
    confirmed: 0.95,
    probed: 0.8,
    "bundle-discovered": 0.55,
  }[evidence] ?? 0.5;
  const pageBoost = Math.min(pageCount, 3) * 0.03;
  const queryBoost = Math.min(queryCount, 3) * 0.01;
  return Math.min(0.99, Number((baseScore + pageBoost + queryBoost).toFixed(2)));
}

function shouldTreatAsObservation(value) {
  return (
    value
    && typeof value === "object"
    && (typeof value.method === "string" || typeof value.requestMethod === "string")
    && (typeof value.path === "string" || typeof value.url === "string")
  );
}

function mergePageContext(context, value) {
  const next = { ...context };
  const label = [
    value?.page,
    value?.pageName,
    value?.routeName,
    value?.route,
    value?.hashRoute,
    value?.pageId,
  ].find((candidate) => typeof candidate === "string" && candidate.trim());

  if (label) {
    next.page = label.trim();
  }

  return next;
}

function walkArtifact(value, handler, context = {}) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkArtifact(item, handler, context));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const nextContext = mergePageContext(context, value);
  handler(value, nextContext);

  for (const child of Object.values(value)) {
    walkArtifact(child, handler, nextContext);
  }
}

function buildObservation(record, sourceFile, evidence, context = {}) {
  const rawPath = typeof record.path === "string" && record.path.trim()
    ? record.path.trim()
    : record.url;
  const normalizedPath = normalizeRoutePath(rawPath);
  const method = normalizeMethod(record.method ?? record.requestMethod);
  const hostname = extractHostname(record.url) ?? extractHostname(rawPath);

  if (!normalizedPath || !method) {
    return null;
  }

  const seenOnPages = new Set([
    ...normalizeStringArray(record.seenOnPages),
    ...normalizeStringArray(record.pages),
    ...normalizeStringArray(record.page),
    ...normalizeStringArray(context.page),
  ]);

  const queryParameters = collectQueryParameterNames(record);

  return {
    evidence,
    method,
    normalizedPath,
    rawPath,
    seenOnPages: Array.from(seenOnPages),
    queryParameters,
    sourceArtifacts: [sourceFile],
    featureFamily:
      typeof record.featureFamily === "string" && record.featureFamily.trim()
        ? record.featureFamily.trim()
        : deriveFeatureFamily(normalizedPath),
    hostname,
    confidenceScore: confidenceForObservation(
      evidence,
      seenOnPages.size,
      queryParameters.length,
    ),
  };
}

function collectObservations(data, sourceFile, evidence) {
  const observations = [];

  walkArtifact(data, (value, context) => {
    if (!shouldTreatAsObservation(value)) {
      return;
    }

    const observation = buildObservation(value, sourceFile, evidence, context);
    if (observation) {
      observations.push(observation);
    }
  });

  return observations;
}

function looksLikeBundleUrl(value) {
  return typeof value === "string"
    && /\.(?:js|mjs)(?:\?|$)/iu.test(value)
    && (value.includes("/") || value.includes("\\"));
}

function collectScriptUrls(data) {
  const scriptUrls = new Set();

  walkArtifact(data, (value) => {
    if (typeof value?.scriptUrl === "string" && looksLikeBundleUrl(value.scriptUrl)) {
      scriptUrls.add(value.scriptUrl);
    }

    if (Array.isArray(value?.scriptUrls)) {
      for (const url of value.scriptUrls) {
        if (looksLikeBundleUrl(url)) {
          scriptUrls.add(url);
        }
      }
    }

    if (typeof value?.url === "string" && looksLikeBundleUrl(value.url)) {
      scriptUrls.add(value.url);
    }
  });

  return Array.from(scriptUrls).sort((left, right) => left.localeCompare(right));
}

function collectGraphqlOperations(data) {
  const operations = new Map();
  walkArtifact(data, (value) => {
    if (
      typeof value?.name !== "string"
      || !["mutation", "query", "subscription"].includes(value?.operationType)
    ) {
      return;
    }
    const operation = {
      name: value.name,
      operationType: value.operationType,
      sourceFile:
        typeof value.sourceFile === "string" ? value.sourceFile : null,
    };
    operations.set(
      `${operation.operationType} ${operation.name} ${operation.sourceFile ?? ""}`,
      operation,
    );
  });
  return Array.from(operations.values()).sort((left, right) =>
    `${left.operationType} ${left.name}`.localeCompare(
      `${right.operationType} ${right.name}`,
    ));
}

function pathStartsWithKnownPrefix(value, allowedPrefixes) {
  return allowedPrefixes.some((prefix) => matchesPathPrefix(value, prefix));
}

function collectBundleCandidateRecords(data, allowedPrefixes) {
  const candidates = new Map();

  function addCandidate(value, record = {}) {
    if (typeof value !== "string") {
      return;
    }

    const normalizedPath = normalizeRoutePath(value);
    if (!normalizedPath || !pathStartsWithKnownPrefix(normalizedPath, allowedPrefixes)) {
      return;
    }

    const method = normalizeMethod(record.method);
    const hostname = extractHostname(record.url) ?? extractHostname(value);
    candidates.set(`${hostname ?? "NO_HOST"} ${method ?? "ANY"} ${normalizedPath}`, {
      hostname,
      method,
      normalizedPath,
      sourceFile:
        typeof record.sourceFile === "string" && record.sourceFile.trim()
          ? record.sourceFile.trim()
          : null,
    });
  }

  walkArtifact(data, (value) => {
    addCandidate(value?.candidatePath, value);
    addCandidate(value?.path, value);

    for (const key of ["candidatePaths", "routes", "apiPaths", "paths"]) {
      if (!Array.isArray(value?.[key])) {
        continue;
      }

      for (const item of value[key]) {
        if (typeof item === "string") {
          addCandidate(item, value);
        } else {
          addCandidate(item?.candidatePath ?? item?.path, item);
        }
      }
    }
  });

  return Array.from(candidates.values()).sort((left, right) =>
    `${left.normalizedPath} ${left.method ?? ""}`.localeCompare(
      `${right.normalizedPath} ${right.method ?? ""}`,
    ));
}

function extractBundleMatches(text, allowedPrefixes) {
  const normalizedText = text
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u002f", "/");
  const matches = new Set();

  for (const prefix of allowedPrefixes) {
    const matcher = new RegExp(
      `${escapeRegex(prefix)}(?=$|[/(])[A-Za-z0-9%{}().,'_\\-/]*`,
      "gu",
    );
    for (const match of normalizedText.matchAll(matcher)) {
      const cleaned = match[0]
        .split("?")[0]
        .replace(/[)"'`,;]+$/u, "");
      const normalizedPath = normalizeRoutePath(cleaned);
      if (normalizedPath && pathStartsWithKnownPrefix(normalizedPath, allowedPrefixes)) {
        matches.add(normalizedPath);
      }
    }
  }

  return Array.from(matches).sort((left, right) => left.localeCompare(right));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveContainedFile(rootDirectory, candidatePath) {
  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(rootDirectory),
      realpath(candidatePath),
    ]);
    const relativePath = path.relative(realRoot, realCandidate);
    if (
      !relativePath
      || relativePath.startsWith(`..${path.sep}`)
      || relativePath === ".."
      || path.isAbsolute(relativePath)
    ) {
      return null;
    }
    return realCandidate;
  } catch {
    return null;
  }
}

async function resolveBundleFiles({ artifactDir, bundleDir, bundleDownloads, scriptUrls }) {
  const discovered = new Set();
  const scriptBasenames = new Set(
    scriptUrls.map((url) => {
      try {
        return path.posix.basename(new URL(url).pathname);
      } catch {
        return path.basename(url);
      }
    }),
  );

  if (bundleDir && await pathExists(bundleDir)) {
    const files = await fg("**/*.{js,mjs}", {
      absolute: true,
      cwd: bundleDir,
      onlyFiles: true,
    });
    for (const filePath of files) {
      const containedFile = await resolveContainedFile(artifactDir, filePath);
      if (
        containedFile
        && (scriptBasenames.size === 0 || scriptBasenames.has(path.basename(containedFile)))
      ) {
        discovered.add(containedFile);
      }
    }
  }

  if (bundleDownloads) {
    const candidatePaths = new Set();
    walkArtifact(bundleDownloads, (value) => {
      for (const key of ["localPath", "filePath", "path", "downloadPath"]) {
        if (typeof value?.[key] === "string" && /\.(?:js|mjs)$/iu.test(value[key])) {
          candidatePaths.add(value[key]);
        }
      }
    });

    for (const candidatePath of candidatePaths) {
      const resolvedPath = path.isAbsolute(candidatePath)
        ? candidatePath
        : path.join(artifactDir, candidatePath);
      const containedFile = await resolveContainedFile(artifactDir, resolvedPath);
      if (containedFile) {
        discovered.add(containedFile);
      }
    }
  }

  return Array.from(discovered).sort((left, right) => left.localeCompare(right));
}

async function collectBundleObservations(options) {
  const {
    allowedPrefixes,
    artifactDir,
    bundleCandidates,
    bundleDir,
    bundleDownloads,
    scriptUrls,
  } = options;
  const observations = [];
  const candidateRecords = new Map(
    collectBundleCandidateRecords(bundleCandidates, allowedPrefixes)
      .map((record) => [
        `${record.hostname ?? "NO_HOST"} ${record.method ?? "ANY"} ${record.normalizedPath}`,
        record,
      ]),
  );
  const structuredPaths = new Set(
    Array.from(candidateRecords.values()).map((record) => record.normalizedPath),
  );
  const bundleFiles = await resolveBundleFiles({
    artifactDir,
    bundleDir,
    bundleDownloads,
    scriptUrls,
  });

  for (const bundleFile of bundleFiles) {
    const text = await readFile(bundleFile, "utf8");
    for (const candidatePath of extractBundleMatches(text, allowedPrefixes)) {
      const key = `NO_HOST ANY ${candidatePath}`;
      if (!candidateRecords.has(key) && !structuredPaths.has(candidatePath)) {
        candidateRecords.set(key, {
          method: null,
          normalizedPath: candidatePath,
          sourceFile: path.basename(bundleFile),
        });
      }
    }
  }

  for (const record of candidateRecords.values()) {
    observations.push({
      evidence: "bundle-discovered",
      method: record.method,
      normalizedPath: record.normalizedPath,
      rawPath: record.normalizedPath,
      seenOnPages: [],
      queryParameters: [],
      sourceArtifacts: [
        artifactFiles.bundleCandidates,
        record.sourceFile,
        ...(bundleFiles.length > 0 ? [artifactFiles.scriptUrls, artifactFiles.bundleDownloads] : []),
      ].filter(Boolean),
      featureFamily: deriveFeatureFamily(record.normalizedPath),
      hostname: record.hostname,
      confidenceScore: confidenceForObservation("bundle-discovered", 0, 0),
    });
  }

  return observations;
}

function strongestEvidence(evidenceSet) {
  return Array.from(evidenceSet).sort(
    (left, right) => (evidencePriority[right] ?? 0) - (evidencePriority[left] ?? 0),
  )[0] ?? "bundle-discovered";
}

function resolveSpec(routeInventory, specInput) {
  const normalizedInput = specInput.trim().toLowerCase();
  const match = routeInventory.find((record) => (
    record.title.toLowerCase() === normalizedInput
    || record.specId.toLowerCase() === normalizedInput
    || (record.nodocRoute ?? "").toLowerCase() === normalizedInput
  ));

  if (!match) {
    throw new Error(`Unable to find a published spec matching "${specInput}".`);
  }

  return match;
}

function extractServerHostTemplate(serverUrl) {
  if (typeof serverUrl !== "string") {
    return null;
  }

  const match = serverUrl.trim().match(/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractServerPath(serverUrl) {
  if (typeof serverUrl !== "string") {
    return "/";
  }

  try {
    return normalizePath(new URL(serverUrl).pathname || "/");
  } catch {
    return "/";
  }
}

function joinRoutePath(serverPath, routePath) {
  const normalizedServerPath = normalizePath(serverPath);
  const normalizedRoutePath = normalizePath(routePath);

  if (
    normalizedServerPath === "/"
    || matchesPathPrefix(normalizedRoutePath, normalizedServerPath)
  ) {
    return normalizedRoutePath;
  }

  return normalizePath(`${normalizedServerPath}/${normalizedRoutePath}`);
}

function hostTemplateToRegex(hostTemplate) {
  return new RegExp(
    `^${escapeRegex(hostTemplate).replace(/\\\{[^}]+\\\}/gu, "[^.]+")}$`,
    "u",
  );
}

function buildSpecContext(specRecord) {
  const scopeServerUrls = Array.isArray(specRecord.scopeServerUrls)
    ? specRecord.scopeServerUrls
    : specRecord.serverUrls;
  const hostTemplates = uniqueSorted(
    scopeServerUrls
      .map((serverUrl) => extractServerHostTemplate(serverUrl))
      .filter(Boolean),
  );
  const serverPathPrefixes = uniqueSorted(
    scopeServerUrls
      .map((serverUrl) => extractServerPath(serverUrl))
      .filter(Boolean),
  );
  const templateOperations = [];

  for (const operation of specRecord.operations) {
    const operationServerPathPrefixes = uniqueSorted(
      (Array.isArray(operation.serverUrls)
        ? operation.serverUrls
        : specRecord.serverUrls)
        .map((serverUrl) => extractServerPath(serverUrl))
        .filter(Boolean),
    );
    const expandedPaths = uniqueSorted(
      [
        normalizeRoutePath(operation.path),
        ...operationServerPathPrefixes.map((serverPath) => normalizeRoutePath(
          joinRoutePath(serverPath, operation.path),
        )),
      ].filter(Boolean),
    );

    for (const expandedPath of expandedPaths) {
      templateOperations.push({
        method: operation.method,
        path: expandedPath,
        pathRegex: pathTemplateToRegex(expandedPath),
      });
    }
  }

  return {
    hostPatterns: hostTemplates.map((hostname) => hostTemplateToRegex(hostname)),
    hostTemplates,
    pathPrefixes: uniqueSorted(
      specRecord.pathPrefixes.flatMap((prefix) => (
        [
          normalizePath(prefix),
          ...serverPathPrefixes.map((serverPath) => joinRoutePath(serverPath, prefix)),
        ]
      )),
    ),
    specId: specRecord.specId,
    templateOperations,
    title: specRecord.title,
  };
}

function getMatchingTemplateOperations(specContext, normalizedPath) {
  return specContext.templateOperations.filter((operation) => (
    operation.pathRegex.test(normalizedPath)
  ));
}

function matchesPathPrefix(normalizedPath, prefix) {
  return normalizedPath === prefix
    || normalizedPath.startsWith(`${prefix}/`)
    || normalizedPath.startsWith(`${prefix}(`);
}

function classifyObservationScope(observation, specContext) {
  const matchesHostname = !observation.hostname
    || specContext.hostPatterns.length === 0
    || specContext.hostPatterns.some((pattern) => pattern.test(observation.hostname));
  const matchesPrefix = specContext.pathPrefixes.length === 0
    || specContext.pathPrefixes.some((prefix) => matchesPathPrefix(observation.normalizedPath, prefix));

  return {
    inScope: matchesHostname && matchesPrefix,
    matchesHostname,
    matchesPrefix,
  };
}

function isObservationInScope(observation, specContext) {
  return classifyObservationScope(observation, specContext).inScope;
}

function partitionObservationsByScope(observations, specContext) {
  return observations.reduce((result, observation) => {
    if (isObservationInScope(observation, specContext)) {
      result.inScope.push(observation);
    } else {
      result.adjacent.push(observation);
    }

    return result;
  }, {
    adjacent: [],
    inScope: [],
  });
}

const knownStaticAssetPrefixes = [
  "/entracopilot/Content/",
  "/Content/Dynamic/",
  "/Content/ExtensionManifest/",
  "/Scripts/",
  "/AzureHubs/Content/",
  "/iam/Content/",
  "/erm/Content/",
];

function isKnownStaticAssetPath(normalizedPath) {
  const lowerPath = normalizedPath.toLowerCase();
  return knownStaticAssetPrefixes.some((prefix) => lowerPath.startsWith(prefix.toLowerCase()))
    || /(?:^|\/)[^/]*(?:[.-])[a-f0-9]{8,}(?:\.[^/]+)?$/iu.test(normalizedPath);
}

function partitionAdjacentStaticAssets(observations) {
  return observations.reduce((result, observation) => {
    result[isKnownStaticAssetPath(observation.normalizedPath) ? "staticAssets" : "actionable"]
      .push(observation);
    return result;
  }, {
    actionable: [],
    staticAssets: [],
  });
}

function buildScopeReviewContext(observation, specContext, specContexts) {
  const scope = classifyObservationScope(observation, specContext);
  const scopeReason = !scope.matchesHostname && !scope.matchesPrefix
    ? "host-and-path-out-of-scope"
    : scope.matchesHostname
      ? "path-out-of-scope"
      : "host-out-of-scope";
  const trustedHostTemplates = specContexts.flatMap((context) => context.hostTemplates);
  const matchingSpecIds = observation.hostname
    ? specContexts
        .filter((context) => isObservationInScope(observation, context))
        .map((context) => context.specId)
    : [];

  return {
    hostFamily: observation.hostname
      ? sanitizeObservedHostFamily(observation.hostname, trustedHostTemplates)
      : "[host-not-observed]",
    matchingSpecIds: uniqueSorted(matchingSpecIds),
    scopeReason,
  };
}

function aggregateCandidates(
  observations,
  specContext,
  includeDocumented,
  { scopeReview = false, specContexts = [] } = {},
) {
  const aggregated = new Map();

  for (const observation of observations) {
    const scopeReviewContext = scopeReview
      ? buildScopeReviewContext(observation, specContext, specContexts)
      : null;
    const candidatePath = scopeReview
      ? sanitizeScopeReviewPath(observation.normalizedPath)
      : observation.normalizedPath;
    const key = [
      scopeReviewContext?.hostFamily,
      observation.method ?? "ANY",
      candidatePath,
    ].filter(Boolean).join(" ");
    const matchingTemplateOperations = getMatchingTemplateOperations(
      specContext,
      observation.normalizedPath,
    );
    const matchedSpecMethods = uniqueSorted(
      matchingTemplateOperations.map((operation) => operation.method),
    );
    const documentedPath = matchingTemplateOperations.length > 0;
    const documentedMethod = observation.method
      ? matchingTemplateOperations.some((operation) => operation.method === observation.method)
      : documentedPath;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        candidateType: "api-endpoint",
        confidenceScore: observation.confidenceScore,
        documentationStatus:
          documentedMethod
            ? "documented"
            : documentedPath
              ? "path-documented-missing-method"
              : "undocumented",
        evidence: new Set([observation.evidence]),
        featureFamily: scopeReview
          ? deriveFeatureFamily(candidatePath)
          : observation.featureFamily,
        matchedSpecMethods,
        method: observation.method,
        normalizedPath: candidatePath,
        rawPaths: new Set([observation.rawPath]),
        requiredInputs: new Set(extractRequiredInputs(observation)),
        safeMethodToTest: safeMethodToTest(observation.method),
        seenOnPages: new Set(observation.seenOnPages),
        sourceArtifacts: new Set(observation.sourceArtifacts),
        ...(scopeReviewContext
          ? {
              hostFamily: scopeReviewContext.hostFamily,
              matchingSpecIds: new Set(scopeReviewContext.matchingSpecIds),
              requiresSpecAssignment: true,
              scopeReasons: new Set([scopeReviewContext.scopeReason]),
            }
          : {}),
      });
    } else {
      const candidate = aggregated.get(key);
      candidate.confidenceScore = Math.max(candidate.confidenceScore, observation.confidenceScore);
      candidate.evidence.add(observation.evidence);
      candidate.featureFamily = candidate.featureFamily || observation.featureFamily;
      candidate.matchedSpecMethods = uniqueSorted([
        ...candidate.matchedSpecMethods,
        ...matchedSpecMethods,
      ]);
      for (const rawPath of [observation.rawPath]) {
        candidate.rawPaths.add(rawPath);
      }
      for (const requiredInput of extractRequiredInputs(observation)) {
        candidate.requiredInputs.add(requiredInput);
      }
      for (const page of observation.seenOnPages) {
        candidate.seenOnPages.add(page);
      }
      for (const sourceArtifact of observation.sourceArtifacts) {
        candidate.sourceArtifacts.add(sourceArtifact);
      }
      if (scopeReviewContext) {
        for (const matchingSpecId of scopeReviewContext.matchingSpecIds) {
          candidate.matchingSpecIds.add(matchingSpecId);
        }
        candidate.scopeReasons.add(scopeReviewContext.scopeReason);
      }
    }
  }

  return Array.from(aggregated.values())
    .map((candidate) => ({
      ...candidate,
      evidence: strongestEvidence(candidate.evidence),
      rawPaths: Array.from(candidate.rawPaths).sort((left, right) => left.localeCompare(right)),
      requiredInputs: Array.from(candidate.requiredInputs).sort((left, right) => left.localeCompare(right)),
      seenOnPages: Array.from(candidate.seenOnPages).sort((left, right) => left.localeCompare(right)),
      sourceArtifacts: Array.from(candidate.sourceArtifacts).sort((left, right) => left.localeCompare(right)),
      ...(scopeReview
        ? {
            matchingSpecIds: Array.from(candidate.matchingSpecIds)
              .sort((left, right) => left.localeCompare(right)),
            scopeReasons: Array.from(candidate.scopeReasons)
              .sort((left, right) => left.localeCompare(right)),
          }
        : {}),
    }))
    .filter((candidate) => (
      scopeReview
      || includeDocumented
      || candidate.documentationStatus !== "documented"
    ))
    .sort((left, right) => {
      if (evidencePriority[left.evidence] !== evidencePriority[right.evidence]) {
        return (evidencePriority[right.evidence] ?? 0) - (evidencePriority[left.evidence] ?? 0);
      }

      if (left.documentationStatus !== right.documentationStatus) {
        return left.documentationStatus.localeCompare(right.documentationStatus);
      }

      if (left.method !== right.method) {
        return String(left.method).localeCompare(String(right.method));
      }

      return left.normalizedPath.localeCompare(right.normalizedPath);
    });
}

function sanitizeScopeReviewCandidate(candidate) {
  return {
    documentationStatus: candidate.documentationStatus,
    evidence: candidate.evidence,
    featureFamily: candidate.featureFamily,
    hostFamily: candidate.hostFamily,
    matchingSpecIds: candidate.matchingSpecIds,
    method: candidate.method,
    normalizedPath: candidate.normalizedPath,
    requiresSpecAssignment: true,
    scopeReasons: candidate.scopeReasons,
  };
}

function countCandidatesByAction(candidates) {
  return candidates.reduce((counts, candidate) => {
    if (candidate.evidence === "confirmed") {
      if (candidate.method === "GET") {
        counts.confirmedRead += 1;
      } else {
        counts.confirmedSafetyReview += 1;
      }
    } else if (candidate.evidence === "probed") {
      counts.successfullyProbed += 1;
    } else {
      counts.bundleOnly += 1;
    }
    return counts;
  }, {
    bundleOnly: 0,
    confirmedRead: 0,
    confirmedSafetyReview: 0,
    successfullyProbed: 0,
  });
}

function matchesSuppression(candidate, suppression) {
  if (!suppression?.path) {
    return false;
  }

  return candidate.normalizedPath === suppression.path
    && (!suppression.method || suppression.method === candidate.method);
}

function partitionSuppressedCandidates(candidates, suppressions) {
  if (suppressions.length === 0) {
    return {
      active: candidates,
      suppressed: [],
    };
  }

  return candidates.reduce((result, candidate) => {
    const suppression = suppressions.find((entry) => matchesSuppression(candidate, entry));
    if (suppression) {
      result.suppressed.push({
        ...candidate,
        suppressionNote: suppression.note ?? null,
      });
      return result;
    }

    result.active.push(candidate);
    return result;
  }, {
    active: [],
    suppressed: [],
  });
}

function buildSummary({
  adjacentObservationCount,
  adjacentStaticAssetObservationCount,
  candidates,
  includeAdjacentRequested,
  observations,
  scopeReviewCandidates,
  scopedObservationCount,
  specRecord,
  scriptUrls,
  suppressedCandidateCount,
}) {
  const countsByEvidence = candidates.reduce((counts, candidate) => ({
    ...counts,
    [candidate.evidence]: (counts[candidate.evidence] ?? 0) + 1,
  }), {});
  const documentedMatches = candidates.filter(
    (candidate) => candidate.documentationStatus === "documented",
  ).length;

  return {
    candidateCount: candidates.length,
    countsByEvidence,
    documentedMatches,
    adjacentObservationCount,
    adjacentStaticAssetObservationCount,
    adjacentCandidatesPromoted: false,
    includeAdjacentRequested,
    inScopeObservationCount: scopedObservationCount,
    observationCount: observations.length,
    scopeReviewCandidateCount: scopeReviewCandidates.length,
    scopeReviewCounts: countCandidatesByAction(scopeReviewCandidates),
    scriptUrlCount: scriptUrls.length,
    specId: specRecord.specId,
    specPath: specRecord.specPath,
    specTitle: specRecord.title,
    suppressedCandidateCount,
  };
}

function printHumanSummary(summary, candidates) {
  console.log(`Spec: ${summary.specTitle} (${summary.specId})`);
  console.log(`Observations processed: ${summary.observationCount}`);
  console.log(`In-scope observations: ${summary.inScopeObservationCount}`);
  if (summary.adjacentObservationCount > 0) {
    console.log(`Adjacent observations retained for scope review: ${summary.adjacentObservationCount}`);
  }
  if (summary.includeAdjacentRequested) {
    console.log("--include-adjacent is compatibility-only; adjacent evidence remains outside active candidates.");
  }
  console.log(`Loaded scripts observed: ${summary.scriptUrlCount}`);
  if (summary.suppressedCandidateCount > 0) {
    console.log(`Suppressed known telemetry exclusions: ${summary.suppressedCandidateCount}`);
  }
  console.log(
    `Candidates: ${summary.candidateCount} (confirmed: ${summary.countsByEvidence.confirmed ?? 0}, probed: ${summary.countsByEvidence.probed ?? 0}, bundle-discovered: ${summary.countsByEvidence["bundle-discovered"] ?? 0})`,
  );

  if (candidates.length === 0) {
    console.log("No unresolved candidates found.");
    return;
  }

  console.table(candidates.map((candidate) => ({
    evidence: candidate.evidence,
    method: candidate.method ?? "ANY",
    status: candidate.documentationStatus,
    path: candidate.normalizedPath,
    family: candidate.featureFamily,
    inputs: candidate.requiredInputs.join(", "),
    pages: candidate.seenOnPages.length,
    confidence: candidate.confidenceScore,
  })));
}

async function maybeWriteOutput(outputPath, payload) {
  if (!outputPath) {
    return;
  }

  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outputPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const routeInventory = await buildSpecRouteInventory();
  const specRecord = resolveSpec(routeInventory, args.spec);
  const specContext = buildSpecContext(specRecord);
  const specContexts = routeInventory.map((record) => buildSpecContext(record));
  const artifactPaths = Object.fromEntries(
    Object.entries(artifactFiles).map(([key, filename]) => [
      key,
      path.join(args.artifacts, filename),
    ]),
  );
  const [
    apiRecords,
    pageStates,
    probeResults,
    scriptUrlsData,
    bundleCandidates,
    bundleDownloads,
  ] = await Promise.all([
    readJsonIfExists(artifactPaths.apiRecords),
    readJsonIfExists(artifactPaths.pageStates),
    readJsonIfExists(artifactPaths.probeResults),
    readJsonIfExists(artifactPaths.scriptUrls),
    readJsonIfExists(artifactPaths.bundleCandidates),
    readJsonIfExists(artifactPaths.bundleDownloads),
  ]);

  if (!apiRecords && !pageStates && !probeResults && !scriptUrlsData && !bundleCandidates && !bundleDownloads) {
    throw new Error(`No supported crawl artifacts found under "${args.artifacts}".`);
  }

  const scriptUrls = scriptUrlsData ? collectScriptUrls(scriptUrlsData) : [];
  const graphqlOperations = bundleCandidates
    ? collectGraphqlOperations(bundleCandidates)
    : [];
  const observations = [
    ...(apiRecords ? collectObservations(apiRecords, artifactFiles.apiRecords, "confirmed") : []),
    ...(pageStates ? collectObservations(pageStates, artifactFiles.pageStates, "confirmed") : []),
    ...(probeResults
      ? collectObservations(
          probeResults.filter((record) => (
            record?.outcome === "confirmed"
            || (
              !record?.outcome
              && Number(record?.status) >= 200
              && Number(record?.status) < 300
            )
          )),
          artifactFiles.probeResults,
          "probed",
        )
      : []),
    ...await collectBundleObservations({
      allowedPrefixes: specContext.pathPrefixes,
      artifactDir: args.artifacts,
      bundleCandidates,
      bundleDir: args.bundleDir,
      bundleDownloads,
      scriptUrls,
    }),
  ];
  const { adjacent, inScope } = partitionObservationsByScope(observations, specContext);
  const adjacentPartitions = partitionAdjacentStaticAssets(adjacent);
  const candidateSuppressions = getCandidateSuppressions(specRecord.title);
  const candidatePartitions = partitionSuppressedCandidates(aggregateCandidates(
    inScope,
    specContext,
    args.includeDocumented,
  ), candidateSuppressions);
  const candidates = candidatePartitions.active;
  const scopeReviewCandidates = aggregateCandidates(
    adjacentPartitions.actionable,
    specContext,
    true,
    { scopeReview: true, specContexts },
  ).map((candidate) => sanitizeScopeReviewCandidate(candidate));
  const staticAssetCandidates = aggregateCandidates(
    adjacentPartitions.staticAssets,
    specContext,
    true,
  ).map((candidate) => ({
    ...candidate,
    suppressionNote: "Known static portal asset; retained as analyzer evidence but excluded from adjacent scope review.",
  }));
  const suppressedCandidates = [
    ...candidatePartitions.suppressed,
    ...staticAssetCandidates,
  ];
  const summary = buildSummary({
    adjacentObservationCount: adjacent.length,
    adjacentStaticAssetObservationCount: adjacentPartitions.staticAssets.length,
    candidates,
    includeAdjacentRequested: args.includeAdjacent,
    observations,
    scopeReviewCandidates,
    scopedObservationCount: inScope.length,
    specRecord,
    scriptUrls,
    suppressedCandidateCount: suppressedCandidates.length,
  });
  const payload = {
    summary,
    candidates,
    graphqlOperations,
    scopeReviewCandidates,
    suppressedCandidates,
  };
  summary.graphqlOperationCount = graphqlOperations.length;

  await maybeWriteOutput(args.output, payload);

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHumanSummary(summary, candidates);
}

await main();
