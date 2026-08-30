import { createHash } from "node:crypto";

export const graphTelemetrySchemaVersion = 1;

const graphHost = "graph.microsoft.com";
const graphTransports = [
  {
    host: graphHost,
    kind: "direct-graph",
    pathPrefix: "",
  },
  {
    host: "security.microsoft.com",
    kind: "defender-purview-msgraph-proxy",
    pathPrefix: "/apiproxy/msgraph",
  },
  {
    host: "purview.microsoft.com",
    kind: "defender-purview-msgraph-proxy",
    pathPrefix: "/apiproxy/msgraph",
  },
  {
    host: "admin.microsoft.com",
    kind: "m365-admin-msgraph-proxy",
    pathPrefix: "/fd/msgraph",
  },
  {
    host: "admin.cloud.microsoft",
    kind: "m365-admin-msgraph-proxy",
    pathPrefix: "/fd/msgraph",
  },
];
const methods = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const stableJson = (value) => `${JSON.stringify(value)}\n`;
const digest = (value) => createHash("sha256").update(stableJson(value), "utf8").digest("hex");
const sorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

function parsedJson(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function parseGraphTransportUrl(value, inheritedVersion = null, inheritedTransport = null) {
  try {
    const relative = !/^[a-z][a-z\d+.-]*:\/\//iu.test(String(value));
    const parsed = new URL(value, inheritedVersion ? `https://${graphHost}/${inheritedVersion}/` : undefined);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/{2,}/gu, "/");
    const configuredTransport = graphTransports.find((entry) => (
      entry.host === host
      && (!entry.pathPrefix || pathname.toLowerCase().startsWith(`${entry.pathPrefix}/`) || pathname.toLowerCase() === entry.pathPrefix)
    ));
    const transport = relative && inheritedTransport ? inheritedTransport : configuredTransport;
    if (!transport) return null;
    const stripPrefix = relative ? "" : transport.pathPrefix;
    const graphPath = stripPrefix
      ? pathname.slice(stripPrefix.length) || "/"
      : pathname;
    const parts = graphPath.split("/").filter(Boolean);
    const version = ["beta", "v1.0"].includes(parts[0]?.toLowerCase()) ? parts.shift().toLowerCase() : inheritedVersion;
    if (!version) return null;
    return {
      version,
      path: `/${parts.join("/")}` || "/",
      queryParameterNames: sorted([...parsed.searchParams.keys()]),
      transport: {
        host: transport.host,
        kind: transport.kind,
        pathPrefix: transport.pathPrefix || "/",
      },
    };
  } catch {
    return null;
  }
}

function canonicalPath(value) {
  let decoded = String(value || "/");
  try { decoded = decodeURIComponent(decoded); } catch { /* retain the observed encoding */ }
  const normalized = decoded
    .replace(/\/{2,}/gu, "/")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, "{id}")
    .replace(/(appId|id)=['"]?[^/'"()]+['"]?/giu, "$1={$1}")
    .replace(/\('(?:[^']+)'\)/gu, "('{id}')")
    .replace(/\(\d+\)/gu, "({id})")
    .replace(/\/$/u, "") || "/";
  return normalized.split("/").map((segment) => {
    if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/iu.test(segment)) return "{id}";
    if (/^\d+$/u.test(segment)) return "{id}";
    if (/^[a-z\d_-]{16,}$/iu.test(segment) && /\d/u.test(segment)) return "{id}";
    return segment;
  }).join("/") || "/";
}

function shape(value, depth = 0) {
  if (depth > 8) return "depth-limit";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0], depth + 1)];
  if (typeof value === "object") {
    const properties = {};
    let hasDynamicProperties = false;
    for (const key of Object.keys(value).sort().slice(0, 128)) {
      if (key.length > 128 || containsSensitiveMaterial(key)) {
        hasDynamicProperties = true;
        continue;
      }
      properties[key] = shape(value[key], depth + 1);
    }
    if (hasDynamicProperties) properties["{dynamicProperty}"] = "unknown";
    return properties;
  }
  return typeof value;
}

function shapeDigest(value) {
  return value === null || value === undefined ? null : digest(shape(value));
}

function contractOperations(specification) {
  if (specification?.schemaVersion === 1 && Array.isArray(specification.operations)) {
    return specification.operations.map(({ method, path }) => {
      const canonical = canonicalPath(path).replace(/\(\)$/u, "");
      const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\\\{[^/{}]+\\\}/gu, "[^/()]+");
      return { method: String(method).toUpperCase(), path: canonical, pattern: new RegExp(`^${escaped}/?$`, "iu") };
    });
  }
  const result = [];
  for (const [pathname, pathItem] of Object.entries(specification?.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!methods.has(method.toUpperCase()) || !operation || typeof operation !== "object") continue;
      const canonical = canonicalPath(pathname).replace(/\(\)$/u, "");
      const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\\\{[^/{}]+\\\}/gu, "[^/()]+");
      result.push({ method: method.toUpperCase(), path: canonical, pattern: new RegExp(`^${escaped}/?$`, "iu") });
    }
  }
  return result;
}

export function buildGraphContractIndex(specification, { version = null, sourceSha256 = null } = {}) {
  const operations = contractOperations(specification).map(({ method, path }) => ({ method, path }));
  return {
    schemaVersion: 1,
    version,
    sourceSha256,
    operations,
  };
}

function contractDisposition(operation, contracts) {
  const comparablePath = operation.path
    .replace(/\('\{id\}'\)/gu, "/{id}")
    .replace(/\(\{id\}\)/gu, "/{id}");
  const comparablePaths = sorted([
    comparablePath,
    comparablePath.replace(/\(\)$/u, ""),
  ]);
  const current = contracts[operation.version] ?? [];
  if (current.some((entry) => entry.method === operation.method && comparablePaths.some((path) => entry.pattern.test(path)))) return "documented-current-version";
  const otherVersion = operation.version === "beta" ? "v1.0" : "beta";
  if ((contracts[otherVersion] ?? []).some((entry) => entry.method === operation.method && comparablePaths.some((path) => entry.pattern.test(path)))) {
    return `documented-${otherVersion}-only`;
  }
  return Object.keys(contracts).length > 0 ? "undocumented-candidate" : "official-contract-not-supplied";
}

function operationCore({ method, graph, status = null, mimeType = null, request = null, response = null, attribution = null, seenOnPages = [], source, portalOwner = null, requestHeaderNames = [], responseHeaderNames = [] }) {
  const core = {
    version: graph.version,
    method: String(method || "GET").toUpperCase(),
    path: canonicalPath(graph.path),
    queryParameterNames: graph.queryParameterNames,
    statuses: status === null || status === undefined ? [] : [Number(status)],
    mimeTypes: mimeType ? [String(mimeType).toLowerCase()] : [],
    requestShapeDigests: request === null ? [] : [shapeDigest(request)],
    responseShapeDigests: response === null ? [] : [shapeDigest(response)],
    requestShapeSummaries: request === null ? [] : [shape(request)],
    responseShapeSummaries: response === null ? [] : [shape(response)],
    actionIndexes: Number.isInteger(attribution?.actionIndex) ? [attribution.actionIndex] : [],
    checkpoints: attribution?.checkpoint ? [String(attribution.checkpoint)] : [],
    seenOnPages: sorted(seenOnPages.map(String)),
    sources: [source],
    portalOwners: portalOwner ? [portalOwner] : [],
    requestHeaderNames: sorted(requestHeaderNames.map((entry) => String(entry).toLowerCase())),
    responseHeaderNames: sorted(responseHeaderNames.map((entry) => String(entry).toLowerCase())),
    transportKinds: [graph.transport.kind],
    transportHosts: [graph.transport.host],
    transportPathPrefixes: [graph.transport.pathPrefix],
  };
  return core;
}

function directOperations(records) {
  return records.flatMap((record) => {
    const graph = parseGraphTransportUrl(record?.url);
    if (!graph || graph.path === "/$batch") return [];
    const operation = operationCore({
      method: record.method,
      graph,
      status: record.status,
      mimeType: record.mimeType,
      request: parsedJson(record.requestBodySamples?.[0]),
      response: parsedJson(record.responseBodySample),
      attribution: record.attribution,
      seenOnPages: record.seenOnPages,
      source: "direct",
      portalOwner: record.portalName,
      requestHeaderNames: record.requestHeaderNames,
      responseHeaderNames: record.responseHeaderNames,
    });
    if (record.requestShapeFingerprint) operation.requestShapeDigests = [record.requestShapeFingerprint];
    if (record.responseShapeFingerprint) operation.responseShapeDigests = [record.responseShapeFingerprint];
    if (record.requestShapeSummary) operation.requestShapeSummaries = [record.requestShapeSummary];
    if (record.responseShapeSummary) operation.responseShapeSummaries = [record.responseShapeSummary];
    return [operation];
  });
}

function batchOperations(records) {
  const operations = [];
  for (const record of records) {
    const parent = parseGraphTransportUrl(record?.url);
    if (!parent || parent.path !== "/$batch") continue;
    const request = parsedJson(record.requestBodySamples?.[0]);
    const response = parsedJson(record.responseBodySample);
    const metadataRequests = record.graphBatch?.requests;
    const requestEntries = Array.isArray(metadataRequests) && metadataRequests.length > 0 ? metadataRequests : (request?.requests ?? []);
    const metadataResponses = record.graphBatch?.responses;
    const responses = new Map((Array.isArray(metadataResponses) && metadataResponses.length > 0 ? metadataResponses : (response?.responses ?? []))
      .map((entry) => [String(entry.idDigest ?? entry.id), entry]));
    for (const entry of requestEntries) {
      const graph = parseGraphTransportUrl(entry.url, parent.version, parent.transport);
      const method = String(entry.method || "GET").toUpperCase();
      if (!graph || !methods.has(method)) continue;
      const matchedResponse = responses.get(String(entry.idDigest ?? entry.id));
      const operation = operationCore({
        method,
        graph,
        status: matchedResponse?.status,
        mimeType: matchedResponse?.mimeType ?? matchedResponse?.headers?.["Content-Type"] ?? matchedResponse?.headers?.["content-type"],
        request: entry.body ?? null,
        response: matchedResponse?.body ?? null,
        attribution: record.attribution,
        seenOnPages: record.seenOnPages,
        source: "batch-member",
        portalOwner: record.portalName,
        requestHeaderNames: entry.headerNames ?? record.requestHeaderNames,
        responseHeaderNames: matchedResponse?.headerNames ?? [],
      });
      if (entry.bodyShapeFingerprint) operation.requestShapeDigests = [entry.bodyShapeFingerprint];
      if (matchedResponse?.bodyShapeFingerprint) operation.responseShapeDigests = [matchedResponse.bodyShapeFingerprint];
      if (entry.bodyShapeSummary) operation.requestShapeSummaries = [entry.bodyShapeSummary];
      if (matchedResponse?.bodyShapeSummary) operation.responseShapeSummaries = [matchedResponse.bodyShapeSummary];
      operations.push(operation);
    }
  }
  return operations;
}

function batchDiagnostics(records) {
  return records.flatMap((record) => {
    const parent = parseGraphTransportUrl(record?.url);
    if (!parent || parent.path !== "/$batch") return [];
    const request = parsedJson(record.requestBodySamples?.[0]);
    const response = parsedJson(record.responseBodySample);
    const requests = Array.isArray(record.graphBatch?.requests) ? record.graphBatch.requests : (Array.isArray(request?.requests) ? request.requests : []);
    const responses = Array.isArray(record.graphBatch?.responses) ? record.graphBatch.responses : (Array.isArray(response?.responses) ? response.responses : []);
    const malformedMemberCount = requests.filter((entry) => {
      const method = String(entry?.method || "GET").toUpperCase();
      return !methods.has(method) || !parseGraphTransportUrl(entry?.url, parent.version, parent.transport);
    }).length;
    return [{
      version: parent.version,
      status: record.status === null || record.status === undefined ? null : Number(record.status),
      requestCount: requests.length,
      responseCount: responses.length,
      memberStatuses: sorted(responses.map((entry) => Number(entry?.status)).filter(Number.isFinite)),
      malformedMemberCount,
      requestParsed: record.graphBatch?.requestParsed ?? request !== null,
      responseParsed: record.graphBatch?.responseParsed ?? response !== null,
      actionIndex: Number.isInteger(record.attribution?.actionIndex) ? record.attribution.actionIndex : null,
      checkpoint: record.attribution?.checkpoint ? String(record.attribution.checkpoint) : null,
      transportKind: parent.transport.kind,
      transportHost: parent.transport.host,
      transportPathPrefix: parent.transport.pathPrefix,
    }];
  });
}

function mergeOperations(values, contracts) {
  const grouped = new Map();
  for (const value of values) {
    const key = `${value.version} ${value.method} ${value.path}`;
    const existing = grouped.get(key) ?? { ...value };
    for (const field of ["queryParameterNames", "statuses", "mimeTypes", "requestShapeDigests", "responseShapeDigests", "actionIndexes", "checkpoints", "seenOnPages", "sources", "portalOwners", "requestHeaderNames", "responseHeaderNames", "transportKinds", "transportHosts", "transportPathPrefixes"]) {
      existing[field] = sorted([...(existing[field] ?? []), ...(value[field] ?? [])]);
    }
    for (const field of ["requestShapeSummaries", "responseShapeSummaries"]) {
      const keyed = new Map([...(existing[field] ?? []), ...(value[field] ?? [])].map((entry) => [JSON.stringify(entry), entry]));
      existing[field] = [...keyed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => entry);
    }
    grouped.set(key, existing);
  }
  return [...grouped.values()].map((operation) => {
    const core = { ...operation, contractDisposition: contractDisposition(operation, contracts) };
    return { ...core, operationId: `graph-observation-${digest(core).slice(0, 24)}` };
  }).sort((left, right) => `${left.version} ${left.method} ${left.path}`.localeCompare(`${right.version} ${right.method} ${right.path}`));
}

export function buildGraphTelemetry({ apiRecords = [], v1Contract = null, betaContract = null, contractSnapshot = null } = {}) {
  const contractValues = Object.fromEntries([
    ["v1.0", v1Contract],
    ["beta", betaContract],
  ].filter(([, value]) => value));
  const contracts = Object.fromEntries(Object.entries(contractValues).map(([version, value]) => [version, contractOperations(value)]));
  const operations = mergeOperations([...directOperations(apiRecords), ...batchOperations(apiRecords)], contracts);
  const batches = batchDiagnostics(apiRecords);
  const core = {
    schemaVersion: graphTelemetrySchemaVersion,
    contractVersions: Object.keys(contracts).sort(),
    contractSources: Object.entries(contractValues)
      .map(([version, value]) => ({
        version,
        operationCount: contracts[version].length,
        sourceSha256: value.sourceSha256 ?? null,
      })),
    contractSnapshot,
    batches,
    operations,
  };
  return {
    ...core,
    telemetryId: `graph-telemetry-${digest(core).slice(0, 24)}`,
    telemetryDigest: digest(core),
    measurements: {
      batchMemberCount: operations.filter((entry) => entry.sources.includes("batch-member")).length,
      batchRequestCount: batches.length,
      batchErrorCount: batches.filter((entry) => entry.status !== null && entry.status >= 400).length,
      directTransportOperationCount: operations.filter((entry) => entry.transportKinds.includes("direct-graph")).length,
      documentedCount: operations.filter((entry) => entry.contractDisposition.startsWith("documented-")).length,
      errorOperationCount: operations.filter((entry) => entry.statuses.some((status) => status >= 400)).length,
      operationCount: operations.length,
      malformedBatchMemberCount: batches.reduce((total, entry) => total + entry.malformedMemberCount, 0),
      proxyTransportOperationCount: operations.filter((entry) => entry.transportKinds.some((kind) => kind.endsWith("-proxy"))).length,
      undocumentedCandidateCount: operations.filter((entry) => entry.contractDisposition === "undocumented-candidate").length,
    },
  };
}

export function validateGraphTelemetry(value) {
  if (!value || value.schemaVersion !== graphTelemetrySchemaVersion || !Array.isArray(value.operations)) throw new Error("Unsupported Graph telemetry schema.");
  const core = Object.fromEntries(Object.entries(value).filter(([key]) => !["telemetryId", "telemetryDigest", "measurements"].includes(key)));
  if (value.telemetryDigest !== digest(core)) throw new Error("Graph telemetry digest mismatch.");
  if (containsSensitiveMaterial(value)) {
    throw new Error("Graph telemetry contains tenant or credential material.");
  }
  return value;
}

function containsSensitiveMaterial(value) {
  const serialized = JSON.stringify(value);
  return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(serialized)
    || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(serialized)
    || /\.onmicrosoft\.com/iu.test(serialized)
    || /\bbearer\s+[A-Za-z0-9._~+/=-]+/iu.test(serialized)
    || /(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/u.test(serialized);
}

export function buildGraphResearchQueue(telemetry) {
  validateGraphTelemetry(telemetry);
  const core = {
    schemaVersion: 1,
    telemetryId: telemetry.telemetryId,
    telemetryDigest: telemetry.telemetryDigest,
    contractSnapshot: telemetry.contractSnapshot,
    undocumentedCandidates: telemetry.operations.filter((entry) => entry.contractDisposition === "undocumented-candidate"),
    errorOperations: telemetry.operations.filter((entry) => entry.statuses.some((status) => status >= 400)),
    batchIssues: telemetry.batches.filter((entry) => (
      (entry.status !== null && entry.status >= 400)
      || entry.malformedMemberCount > 0
      || !entry.requestParsed
      || !entry.responseParsed
    )),
    documentedEnrichment: telemetry.operations.filter((entry) => (
      entry.contractDisposition.startsWith("documented-")
      && entry.statuses.some((status) => status >= 200 && status < 300)
      && (entry.requestShapeDigests.length > 0 || entry.responseShapeDigests.length > 0)
    )),
  };
  return { ...core, queueDigest: digest(core) };
}

export function validateGraphResearchQueue(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.undocumentedCandidates)) throw new Error("Unsupported Graph research queue schema.");
  const core = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "queueDigest"));
  if (value.queueDigest !== digest(core)) throw new Error("Graph research queue digest mismatch.");
  if (containsSensitiveMaterial(value)) throw new Error("Graph research queue contains tenant or credential material.");
  return value;
}
