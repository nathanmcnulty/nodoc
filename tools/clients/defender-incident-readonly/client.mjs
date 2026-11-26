import { operationContract } from "../../operation-contract.mjs";
import {
  getNormalizedOperationContextRecords,
} from "../../spec-quality-lib.mjs";
import {
  normalizeAutomationEvidence,
  normalizeBehavior,
} from "../../operation-behavior.mjs";

const httpMethods = new Set([
  "get", "put", "post", "patch", "delete", "head", "options", "trace",
]);

export function findOperation(specification, operationId) {
  for (const [route, pathItem] of Object.entries(specification.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (httpMethods.has(method.toLowerCase()) && operation?.operationId === operationId) {
        return { method: method.toUpperCase(), route, pathItem, operation };
      }
    }
  }
  throw new Error(`Operation ${operationId} is not in the bundled specification.`);
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parameterDefinitions(pathItem, operation) {
  const parameters = new Map();
  for (const parameter of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    parameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...parameters.values()];
}

function assertMatchesSchema(schema, value, label) {
  if (!schema || typeof schema !== "object" || schema.$ref || schema.oneOf || schema.anyOf || schema.allOf) {
    throw new Error(`${label} uses a schema composition the offline client does not validate.`);
  }
  if (value === null && schema.nullable) return;
  const type = schema.type ?? (schema.properties ? "object" : undefined);
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} does not match the documented object response.`);
    }
    for (const property of schema.required ?? []) {
      if (!Object.hasOwn(value, property)) throw new Error(`${label} is missing documented property ${property}.`);
    }
    for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, property)) assertMatchesSchema(propertySchema, value[property], `${label}.${property}`);
    }
    if (schema.additionalProperties === false) {
      for (const property of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, property)) throw new Error(`${label} contains undocumented property ${property}.`);
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) throw new Error(`${label} does not match the documented array response.`);
    for (const [index, item] of value.entries()) assertMatchesSchema(schema.items, item, `${label}[${index}]`);
  } else if (type === "string" && typeof value !== "string") {
    throw new Error(`${label} does not match the documented string response.`);
  } else if (type === "integer" && !Number.isInteger(value)) {
    throw new Error(`${label} does not match the documented integer response.`);
  } else if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label} does not match the documented number response.`);
  } else if (type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${label} does not match the documented boolean response.`);
  } else if (type === "null" && value !== null) {
    throw new Error(`${label} does not match the documented null response.`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${label} is outside the documented enum.`);
  }
}

export function createOfflineReadOnlyClient({ specification, baseUrl, fetchImplementation = fetch }) {
  const localBase = new URL(baseUrl);
  if (localBase.protocol !== "http:"
    || !isLoopbackHostname(localBase.hostname)
    || localBase.username
    || localBase.password
    || localBase.search
    || localBase.hash) {
    throw new Error("Offline acceptance only permits a plain HTTP loopback mock server.");
  }

  async function get(operationId, { pathParameters = {}, queryParameters = {} } = {}) {
    const definition = findOperation(specification, operationId);
    if (definition.method !== "GET") {
      throw new Error(`Offline read-only client refuses ${definition.method} operation ${operationId}.`);
    }

    const parameters = parameterDefinitions(definition.pathItem, definition.operation);
    let route = definition.route.replace(/\{([^}]+)\}/gu, (match, name) => {
      const parameter = parameters.find((candidate) => candidate.in === "path" && candidate.name === name);
      if (!parameter) throw new Error(`Path parameter ${name} is not documented for ${operationId}.`);
      const value = pathParameters[name];
      if (value === undefined || value === null || value === "") {
        if (parameter.required) throw new Error(`Required path parameter ${name} is missing for ${operationId}.`);
        return match;
      }
      return encodeURIComponent(String(value));
    });
    if (/\{[^}]+\}/u.test(route)) throw new Error(`A path parameter is unresolved for ${operationId}.`);

    for (const name of Object.keys(pathParameters)) {
      if (!parameters.some((parameter) => parameter.in === "path" && parameter.name === name)) {
        throw new Error(`Path parameter ${name} is not documented for ${operationId}.`);
      }
    }

    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(queryParameters)) {
      const parameter = parameters.find((candidate) => candidate.in === "query" && candidate.name === name);
      if (!parameter) throw new Error(`Query parameter ${name} is not documented for ${operationId}.`);
      if (value && typeof value === "object") {
        throw new Error(`Query parameter ${name} requires an explicit scalar value.`);
      }
      if (value !== undefined && value !== null) query.set(name, String(value));
    }
    for (const parameter of parameters.filter((candidate) => candidate.in === "query" && candidate.required)) {
      if (!query.has(parameter.name)) throw new Error(`Required query parameter ${parameter.name} is missing for ${operationId}.`);
    }

    const url = new URL(route, localBase);
    url.search = query.toString();
    const contract = operationContract(definition.operation);
    const acceptedMediaTypes = [...new Set(contract.responses.map((response) => response.mediaType).filter(Boolean))];
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: acceptedMediaTypes.length ? { Accept: acceptedMediaTypes.join(", ") } : {},
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw new Error(`${operationId} returned HTTP ${response.status}.`);

    const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? null;
    const matchingResponses = contract.responses.filter((entry) => entry.status === String(response.status)
      || entry.status === "default"
      || entry.status === `${String(response.status)[0]}XX`);
    if (matchingResponses.length && !matchingResponses.some((entry) => entry.mediaType === mediaType)) {
      throw new Error(`${operationId} returned an undocumented media type for HTTP ${response.status}.`);
    }
    const responseBody = await response.json();
    const responseSchema = definition.operation.responses?.[String(response.status)]?.content;
    const matchingSchema = Object.entries(responseSchema ?? {}).find(([contentType]) => contentType.toLowerCase() === mediaType)?.[1]?.schema;
    if (matchingSchema) assertMatchesSchema(matchingSchema, responseBody, operationId);
    return responseBody;
  }

  return { get };
}

export async function inspectIncident(client, incidentId) {
  if (typeof incidentId !== "string" || !incidentId.trim()) {
    throw new Error("A nonempty incident ID is required.");
  }
  const incident = await client.get("Incidents.Get", {
    pathParameters: { IncidentId: incidentId },
  });
  const alerts = await client.get("Incidents.GetAssociatedAlerts", {
    queryParameters: { incidentId },
  });
  return { incident, alerts };
}

export async function buildAcceptanceEvidence(specification, operationIds) {
  const title = specification.info?.title ?? "Bundled specification";
  const contextRecords = getNormalizedOperationContextRecords(specification, title);
  const contextByOperation = new Map(contextRecords.operations.map((entry) => [
    `${entry.method} ${entry.path}`,
    entry.operationContext,
  ]));

  const operations = operationIds.map((operationId) => {
    const definition = findOperation(specification, operationId);
    const operationContext = contextByOperation.get(`${definition.method} ${definition.route}`) ?? {};
    const behavior = normalizeBehavior(operationContext.behavior ?? { methodKnowledge: "unknown" });
    const automationEvidence = normalizeAutomationEvidence(operationContext.automationEvidence ?? {});
    const contract = operationContract(definition.operation);
    const security = definition.operation.security ?? specification.security;
    const securitySchemes = (security ?? []).flatMap((requirement) => Object.keys(requirement).map((name) => {
      const scheme = specification.components?.securitySchemes?.[name];
      return scheme ? { name, type: scheme.type, in: scheme.in ?? null, parameterName: scheme.name ?? null } : { name, state: "unknown" };
    }));
    const documentedErrors = contract.responses.filter((response) => /^[45]\d\d$/u.test(response.status));
    const observedErrorOutcomes = (behavior.outcomes ?? []).map((outcome) => ({
      httpStatus: outcome.httpStatus,
      confidence: outcome.confidence,
      observationIds: outcome.observationIds,
    }));
    const observed = {
      method: behavior.methodKnowledge ?? "unknown",
      auth: automationEvidence.auth,
      statusMediaTypes: { state: "unknown" },
      errors: observedErrorOutcomes.length
        ? { state: "observed", outcomes: observedErrorOutcomes }
        : { state: "unknown" },
      pagination: automationEvidence.pagination,
      concurrency: { state: "unknown" },
      async: behavior.async
        ? { state: "observed", ...behavior.async }
        : automationEvidence.async,
    };
    const documented = {
      parameters: parameterDefinitions(definition.pathItem, definition.operation).map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        required: parameter.required === true,
        type: parameter.schema?.type ?? "unknown",
      })),
      bodyVariants: contract.requests.length
        ? { state: "documented", variants: contract.requests }
        : { state: "unknown", variants: [] },
      auth: securitySchemes.length ? { state: "documented", schemes: securitySchemes } : { state: "unknown" },
      statusMediaTypes: contract.responses,
      errors: documentedErrors,
      pagination: operationContext.pagination ?? { state: "unknown" },
      concurrency: { state: "unknown" },
      async: { state: "unknown" },
    };
    const unknown = [
      ...Object.entries(observed)
        .filter(([, value]) => value === "unknown" || value?.state === "unknown")
        .map(([dimension]) => `observed.${dimension}`),
      ...["pagination", "concurrency", "async"]
        .filter((dimension) => documented[dimension]?.state === "unknown")
        .map((dimension) => `documented.${dimension}`),
      ...(documented.bodyVariants.state === "unknown" ? ["documented.bodyVariants"] : []),
    ];
    return {
      operationId,
      method: definition.method,
      path: definition.route,
      documented,
      observed,
      unknown,
    };
  });

  return {
    source: "published bundled specification plus x-nodoc behavior metadata",
    observedEvidenceSource: "published typed behavior evidence only; synthetic replay is not observation evidence",
    operations,
  };
}
