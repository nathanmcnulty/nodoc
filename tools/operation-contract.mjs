import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// This representation deliberately contains shapes and opaque evidence references,
// never captured values, messages, URLs or headers.
const types = new Set(["string", "number", "integer", "boolean", "null", "unknown"]);
const stable = (value) => JSON.stringify(value);
const hash = (value) => createHash("sha256").update(stable(value)).digest("hex");
const media = (value) => typeof value === "string" && /^[\w.+-]+\/[\w.+-]+(?:\s*;.*)?$/u.test(value)
  ? value.split(";")[0].toLowerCase().trim() : null;
const refs = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string"
  && /^[\w.-]{1,128}$/u.test(value)
  && !/bearer|(?:password|secret|token|cookie)[_-]/iu.test(value)
  && !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(value)))].sort();
const signatures = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)))].sort();

export function normalizeContractShape(value, depth = 0) {
  if (depth > 12 || value == null) return "unknown";
  if (typeof value === "string") return types.has(value) ? value === "integer" ? "number" : value : "unknown";
  if (Array.isArray(value)) return { array: [...new Map(value.slice(0, 20).map((item) => {
    const shape = normalizeContractShape(item, depth + 1);
    return [stable(shape), shape];
  })).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, shape]) => shape) };
  if (typeof value !== "object") return "unknown";
  if (Array.isArray(value.array)) return normalizeContractShape(value.array, depth);
  const properties = {};
  let dynamic = false;
  for (const key of Object.keys(value).sort().slice(0, 128)) {
    if (!/^[A-Za-z_$][\w$.-]{0,127}$/u.test(key)
      || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(key)
      || /\.onmicrosoft\.com/iu.test(key)) {
      dynamic = true;
      continue;
    }
    properties[key] = normalizeContractShape(value[key], depth + 1);
  }
  if (dynamic) properties["{dynamicProperty}"] = "unknown";
  return properties;
}

function schemaShape(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 12 || schema.$ref) return "unknown";
  if (schema.oneOf || schema.anyOf || schema.allOf) return "unknown"; // Composition requires review, not a guessed branch.
  if (schema.type === "array" || schema.items) return { array: [schemaShape(schema.items, depth + 1)] };
  if (schema.type === "object" || schema.properties) return Object.fromEntries(Object.entries(schema.properties ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, schemaShape(value, depth + 1)]));
  return normalizeContractShape(schema.type);
}

export function operationContract(operation = {}) {
  const requests = Object.entries(operation.requestBody?.content ?? {}).map(([contentType, value]) => ({ mediaType: media(contentType), shape: schemaShape(value.schema) }));
  const responses = Object.entries(operation.responses ?? {}).flatMap(([status, response]) => {
    const content = Object.entries(response?.content ?? {});
    return content.length ? content.map(([contentType, value]) => ({ status, mediaType: media(contentType), shape: schemaShape(value.schema) })) : [{ status, mediaType: null, shape: "unknown" }];
  });
  return { requests, responses };
}

export function contractObservation(record = {}) {
  const status = /^[1-5]\d\d$/u.test(String(record.status)) ? String(record.status) : null;
  const requestShape = normalizeContractShape(record.requestShape ?? record.requestShapeSummary);
  const responseShape = normalizeContractShape(record.responseShape ?? record.responseShapeSummary);
  const allowedStates = new Set(["captured", "empty", "omitted", "failed", "unavailable", "unknown", "size-limit", "policy-excluded"]);
  const state = (value) => allowedStates.has(value?.state ?? value) ? value?.state ?? value : "unknown";
  const observation = {
    status,
    mediaType: media(record.mediaType ?? record.responseContentType ?? record.mimeType),
    requestMediaType: media(record.requestMediaType ?? record.requestContentType),
    requestShape,
    responseShape,
    requestShapeComplete: typeof record.requestShapeComplete === "boolean" ? record.requestShapeComplete : null,
    responseShapeComplete: typeof record.responseShapeComplete === "boolean" ? record.responseShapeComplete : null,
    requestBodyState: state(record.requestBodyState ?? record.requestBodyCapture),
    responseBodyState: state(record.responseBodyState ?? record.responseBodyCapture),
    observationIds: refs(record.observationIds ?? [record.observationId ?? record.requestFingerprint]),
    errorSignatures: signatures(record.errorSignatures ?? [record.errorSignature ?? record.semanticErrorSignature ?? record.responseErrorSignature]),
    ...(Number.isInteger(record.omittedVariantCount) && record.omittedVariantCount > 0 ? { omittedVariantCount: record.omittedVariantCount } : {}),
  };
  return observation;
}

export function mergeContractObservations(...groups) {
  const merged = new Map();
  for (const raw of groups.flat()) {
    const observation = contractObservation(raw);
    const key = stable({ ...observation, observationIds: [] });
    const prior = merged.get(key);
    merged.set(key, prior ? { ...observation, observationIds: refs([...prior.observationIds, ...observation.observationIds]) } : observation);
  }
  // A deterministic bound; overflow stays explicit instead of silently implying completeness.
  const observations = [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, observation]) => observation);
  if (observations.length <= 128) return observations;
  const omitted = observations.slice(127);
  return [...observations.slice(0, 127), contractObservation({
    responseBodyState: "omitted",
    omittedVariantCount: omitted.reduce((count, item) => count + (item.omittedVariantCount ?? 1), 0),
    observationIds: [`omitted-${hash(omitted)}`],
  })];
}

export function assertPublishableEvidenceInput(value, label = "input", unsafe = /tenant|bearer|cookie|authorization|password|secret|credential|https?:\/\/|[A-Za-z]:\\/iu) {
  const serialized = JSON.stringify(value, (key, entry) => {
    if (key !== "contractObservations") return entry;
    if (!Array.isArray(entry) || entry.length > 128 || entry.some((observation) => !isDeepStrictEqual(observation, contractObservation(observation)))) {
      throw new Error(`${label} contains noncanonical contract observations or prohibited sensitive data.`);
    }
    // API vocabulary in canonical typed shape keys is allowed. Every other field
    // still passes through the original sensitive-data check.
    return "[validated-contract-observations]";
  });
  if (unsafe.test(serialized)) throw new Error(`${label} contains prohibited sensitive data.`);
}

function compareShape(expected, observed) {
  if (expected === "unknown" || observed === "unknown" || observed === "null") return "unverified";
  if (typeof expected === "string" || typeof observed === "string") return expected === observed ? "exact" : "conflict";
  if (Array.isArray(expected.array) || Array.isArray(observed.array)) {
    if (!Array.isArray(expected.array) || !Array.isArray(observed.array)) return "conflict";
    if (!expected.array.length || !observed.array.length) return "unverified";
    const results = observed.array.map((item) => {
      const alternatives = expected.array.map((target) => compareShape(target, item));
      return alternatives.includes("exact") ? "exact" : alternatives.includes("unverified") ? "unverified" : "conflict";
    });
    return results.includes("conflict") ? "conflict" : results.includes("unverified") ? "unverified" : "exact";
  }
  const results = Object.entries(observed).map(([key, value]) => key === "{dynamicProperty}" ? "unverified" : Object.hasOwn(expected, key) ? compareShape(expected[key], value) : "enrichment");
  if (!Object.keys(observed).length || Object.keys(expected).some((key) => !Object.hasOwn(observed, key))) results.push("unverified");
  return results.includes("conflict") ? "conflict" : results.includes("enrichment") ? "enrichment" : results.includes("unverified") ? "unverified" : "exact";
}

export function compareOperationContract(existing, inputObservations) {
  const observations = mergeContractObservations(inputObservations);
  const reasons = new Set();
  for (const observation of observations) {
    if (observation.omittedVariantCount) reasons.add("contract-observation-retention-incomplete");
    const matchesStatus = (item) => item.status === observation.status || item.status === "default" || item.status === `${observation.status?.[0]}XX`;
    const emptyResponse = observation.responseBodyState === "empty" ? existing.responses?.find((item) => matchesStatus(item) && item.mediaType === null) : undefined;
    if ((!emptyResponse && observation.responseShapeComplete !== true) || (observation.requestShape !== "unknown" && observation.requestShapeComplete !== true)) reasons.add("contract-evidence-incomplete");
    const response = emptyResponse ?? existing.responses?.find((item) => matchesStatus(item) && item.mediaType === observation.mediaType);
    if (!observation.status) reasons.add("contract-evidence-incomplete");
    else if (!response) reasons.add("new-response-variant");
    else if (!emptyResponse) {
      const result = compareShape(response.shape, observation.responseShape);
      if (result === "conflict") reasons.add("architecture-schema-conflict");
      if (result === "enrichment") reasons.add("response-shape-enrichment");
      if (result === "unverified") reasons.add("contract-evidence-incomplete");
    }
    if (observation.requestShape !== "unknown") {
      const request = existing.requests?.find((item) => item.mediaType === observation.requestMediaType);
      if (!request) reasons.add("new-request-variant");
      else {
        const result = compareShape(request.shape, observation.requestShape);
        if (result === "conflict") reasons.add("architecture-schema-conflict");
        if (result === "enrichment") reasons.add("request-shape-enrichment");
        if (result === "unverified") reasons.add("contract-evidence-incomplete");
      }
    }
    if (observation.errorSignatures.length) reasons.add("conditional-error-evidence-review");
  }
  const reasonCodes = [...reasons].sort();
  return {
    kind: reasons.has("architecture-schema-conflict") ? "conflict" : reasons.has("contract-observation-retention-incomplete") || reasons.has("contract-evidence-incomplete") ? "unverified" : reasonCodes.some((code) => /variant|enrichment|conditional-error/u.test(code)) ? "enrichment" : "exact",
    reasonCodes: reasonCodes.length ? reasonCodes : ["already-documented"],
    observations,
    contractFingerprint: hash(existing),
  };
}
