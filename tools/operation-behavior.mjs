// Evidence assertions are deliberately independent of presentation maturity.
export const evidenceDimensions = ["existence", "method", "input", "populatedResponse", "conditionalErrors", "auth", "pagination", "retry", "async", "freshness"];
const states = new Set(["known", "unknown", "inferred", "verified"]);
const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error(`${label} must be a bounded nonempty string.`);
  return value.trim();
};
const texts = (value, label) => {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw new Error(`${label} must be a bounded nonempty array.`);
  return [...new Set(value.map((entry) => text(entry, label)))];
};
const date = (value, label) => {
  const result = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)) throw new Error(`${label} must be a UTC timestamp.`);
  return result;
};
const refs = (value, label) => {
  const ids = texts(value, label);
  if (ids.some((id) => !/^[\w.-]{1,128}$/u.test(id))) throw new Error(`${label} requires opaque observation identifiers.`);
  return ids;
};
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}.`);
}

export function normalizeAutomationEvidence(value, label = "automationEvidence") {
  object(value, label);
  keys(value, evidenceDimensions, label);
  return Object.fromEntries(evidenceDimensions.map((dimension) => {
    const entry = value[dimension];
    if (entry === undefined) return [dimension, { state: "unknown" }];
    object(entry, `${label}.${dimension}`);
    keys(entry, ["state", "observationIds", "notes", "verifiedAt"], `${label}.${dimension}`);
    if (!states.has(entry.state)) throw new Error(`${label}.${dimension} has invalid state.`);
    const normalized = { state: entry.state };
    if (entry.observationIds !== undefined) normalized.observationIds = refs(entry.observationIds, "observationIds");
    if (entry.notes !== undefined) normalized.notes = texts(entry.notes, "notes");
    if (entry.verifiedAt !== undefined) normalized.verifiedAt = date(entry.verifiedAt, "verifiedAt");
    if (entry.state !== "unknown" && !normalized.observationIds) throw new Error(`${label}.${dimension} requires supporting observationIds.`);
    if (entry.state === "verified" && !normalized.verifiedAt) throw new Error(`${label}.${dimension} requires verifiedAt.`);
    return [dimension, normalized];
  }));
}

export function normalizeBehavior(value, label = "behavior") {
  object(value, label);
  keys(value, ["methodKnowledge", "supportedMethods", "methodObservationIds", "logicalOperation", "outcomes", "retry", "async"], label);
  const normalized = {};
  if (value.methodKnowledge !== undefined) {
    if (!["observed", "validated-set", "unknown"].includes(value.methodKnowledge)) throw new Error(`${label} has invalid methodKnowledge.`);
    normalized.methodKnowledge = value.methodKnowledge;
  }
  if (value.methodObservationIds !== undefined) normalized.methodObservationIds = refs(value.methodObservationIds, "methodObservationIds");
  if (value.supportedMethods !== undefined) {
    normalized.supportedMethods = texts(value.supportedMethods, "supportedMethods");
    if (normalized.supportedMethods.some((method) => !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)$/u.test(method))) throw new Error("supportedMethods has an invalid method.");
    if (value.methodKnowledge !== "validated-set" || !normalized.methodObservationIds) throw new Error("supportedMethods requires validated-set and methodObservationIds.");
  }
  if (value.methodKnowledge === "validated-set" && !normalized.supportedMethods) throw new Error("validated-set requires supportedMethods.");
  if (value.logicalOperation !== undefined) {
    const operation = object(value.logicalOperation, "logicalOperation");
    keys(operation, ["kind", "name"], "logicalOperation");
    if (!["graphql", "rpc"].includes(operation.kind)) throw new Error("logicalOperation has invalid kind.");
    normalized.logicalOperation = { kind: operation.kind, name: text(operation.name, "logicalOperation.name") };
  }
  if (value.outcomes !== undefined) {
    if (!Array.isArray(value.outcomes) || value.outcomes.length > 100) throw new Error(`${label}.outcomes must be a bounded array.`);
    normalized.outcomes = value.outcomes.map((entry) => {
      object(entry, "outcome");
      keys(entry, ["conditions", "httpStatus", "serviceCode", "messageSignature", "interpretation", "confidence", "observationIds", "counterexampleIds", "observedAt"], "outcome");
      if (!/^[1-5]\d\d$/u.test(String(entry.httpStatus))) throw new Error("outcome has invalid httpStatus.");
      if (!["high", "medium", "low"].includes(entry.confidence)) throw new Error("outcome has invalid confidence.");
      const outcome = {
        conditions: texts(entry.conditions, "outcome.conditions"),
        httpStatus: Number(entry.httpStatus),
        interpretation: text(entry.interpretation, "outcome.interpretation"),
        confidence: entry.confidence,
        observationIds: refs(entry.observationIds, "outcome.observationIds"),
        observedAt: date(entry.observedAt, "outcome.observedAt"),
      };
      for (const field of ["serviceCode", "messageSignature"]) if (entry[field] !== undefined) outcome[field] = text(entry[field], `outcome.${field}`);
      if (entry.counterexampleIds !== undefined) outcome.counterexampleIds = refs(entry.counterexampleIds, "counterexampleIds");
      return outcome;
    });
  }
  for (const field of ["retry", "async"]) if (value[field] !== undefined) {
    const entry = object(value[field], `${label}.${field}`);
    keys(entry, ["notes", "observationIds"], `${label}.${field}`);
    normalized[field] = { notes: texts(entry.notes, `${field}.notes`), observationIds: refs(entry.observationIds, `${field}.observationIds`) };
  }
  if (!Object.keys(normalized).length) throw new Error(`${label} must include a behavior field.`);
  return normalized;
}
