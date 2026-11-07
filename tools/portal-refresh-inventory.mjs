import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildSpecInventory, getEffectiveServerUrls, loadBundledSpecification, repoRoot } from "./spec-quality-lib.mjs";
import { crawlMetadataByTitle, getCaptureRecipes } from "./portal-discovery-metadata.mjs";
import { hasUnmaterializedKnownOperationApproval } from "./portal-discovery-evidence-contract.mjs";

const methods = new Set(["get", "put", "post", "patch", "delete", "head", "options", "trace"]);
const day = 86400000;
const identifier = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value) ? value : null;
const json = value => JSON.parse(value.replace(/^\uFEFF/u, ""));
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
function validCalendarDate(value) {
  const date = value.slice(0, 10);
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

function asOfTime(asOf) {
  if (typeof asOf !== "string" || (!/^\d{4}-\d{2}-\d{2}$/u.test(asOf) && !timestampPattern.test(asOf)) || !Number.isFinite(Date.parse(asOf))) throw new Error("asOf must be an ISO date or timestamp.");
  if (!validCalendarDate(asOf)) throw new Error("asOf has an invalid calendar date.");
  // A date-only inventory includes that complete UTC day.
  return Date.parse(asOf.length === 10 ? `${asOf}T23:59:59.999Z` : asOf);
}

function observedTime(value) {
  if (typeof value !== "string" || !timestampPattern.test(value) || !validCalendarDate(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function examplePresent(media) {
  const schema = media?.schema;
  return media && (Object.hasOwn(media, "example") || Object.keys(media.examples ?? {}).length > 0
    || (schema && (Object.hasOwn(schema, "example") || (Array.isArray(schema.examples) && schema.examples.length > 0))));
}

// This diagnoses authored model gaps, never evidence of a complete contract.
export function hasSchemaGap(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || depth > 32) return true;
  if (schema.$ref) return false;
  const composition = ["oneOf", "anyOf", "allOf"].flatMap(key => schema[key] ?? []);
  if (composition.length) return composition.some(item => hasSchemaGap(item, depth + 1));
  if (Array.isArray(schema.type)) return schema.type.length === 0;
  if (!schema.type) return !schema.enum && !Object.hasOwn(schema, "const");
  if (schema.type === "array") return hasSchemaGap(schema.items, depth + 1);
  if (schema.type === "object") {
    const fields = Object.values(schema.properties ?? {});
    if (!fields.length) return !schema.additionalProperties || schema.additionalProperties === true || hasSchemaGap(schema.additionalProperties, depth + 1);
    return fields.some(item => hasSchemaGap(item, depth + 1));
  }
  return false;
}

function authoredGaps(operation) {
  const schema = [], examples = [];
  const inspect = (content, prefix) => {
    for (const [mediaType, media] of Object.entries(content ?? {})) {
      const pointer = `${prefix}/${mediaType.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (hasSchemaGap(media?.schema)) schema.push(pointer);
      if (!examplePresent(media)) examples.push(pointer);
    }
  };
  inspect(operation.requestBody?.content, "requestBody/content");
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    inspect(response?.content, `responses/${status}/content`);
    // These statuses explicitly prohibit a body; other missing media remain unknown.
    if (!response?.$ref && !["204", "205", "304"].includes(status) && !Object.keys(response?.content ?? {}).length) schema.push(`responses/${status}/content-unknown`);
  }
  if (!Object.keys(operation.responses ?? {}).length) schema.push("responses");
  return { schema, examples };
}

export function summarizeRefreshOperation({ specId, method, path: operationPath, operation, observations = [], asOf, freshnessDays = 30 }) {
  const cutoff = asOfTime(asOf);
  if (!Number.isFinite(freshnessDays) || freshnessDays < 0) throw new Error("freshnessDays must be nonnegative.");
  const matches = observations.filter(entry => entry.specId === specId && entry.method === method && entry.path === operationPath);
  const valid = matches.map(entry => ({ entry, time: observedTime(entry.observedAt) }))
    .filter(({ entry, time }) => entry.attributed === true && entry.captureComplete === true && time !== null && time <= cutoff)
    .sort((a, b) => b.time - a.time || String(a.entry.evidenceId ?? "").localeCompare(String(b.entry.evidenceId ?? "")));
  const latest = valid[0];
  const gaps = authoredGaps(operation);
  const healthStates = {
    "healthy-observed": "healthy-observed", "successful-body-observed": "healthy-observed", "no-content-observed": "healthy-observed",
    "error-observed": "error-observed", "http-error-observed": "error-observed", "semantic-error-observed": "error-observed",
    "incomplete": "incomplete", "body-unverified": "incomplete", "unknown": "unknown",
    "not-executed": "unknown", "transport-unverified": "unknown",
  };
  const health = Object.hasOwn(healthStates, latest?.entry.health) ? healthStates[latest.entry.health] : "unknown";
  return {
    method, path: operationPath, operationId: operation.operationId ?? null,
    freshness: {
      status: !latest ? "not-observed" : cutoff - latest.time <= freshnessDays * day ? "current-observation" : "stale-observation",
      observedAt: latest ? new Date(latest.time).toISOString() : null,
      evidenceId: identifier(latest?.entry.evidenceId), captureId: identifier(latest?.entry.captureId),
      excludedObservationCount: matches.length - valid.length,
    },
    health: { status: health, removalSupported: false },
    schema: { definition: gaps.schema.length ? "gap" : "present-unverified", gapLocations: gaps.schema,
      evidence: valid.some(({ entry }) => entry.bodyVerified === true) ? "complete-body-observed" : "unknown" },
    examples: { definition: gaps.examples.length ? "gap" : "present-or-not-applicable", gapLocations: gaps.examples, evidence: "unknown" },
    checkedInCaptureAnnotation: operation["x-nodoc-live-capture"] ? "historical-unverified" : "absent",
    checkedInContextAnnotation: operation["x-nodoc-operation-context"] ? "historical-unverified" : "absent",
  };
}

async function evidenceFiles(specPath) {
  const directory = path.resolve(repoRoot, path.dirname(path.dirname(specPath)), "evidence");
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => path.relative(repoRoot, path.join(directory, entry.name)).replaceAll("\\", "/")).sort();
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function counts(operations) {
  return {
    currentObservations: operations.filter(op => op.freshness.status === "current-observation").length,
    staleObservations: operations.filter(op => op.freshness.status === "stale-observation").length,
    notObserved: operations.filter(op => op.freshness.status === "not-observed").length,
    errorObserved: operations.filter(op => op.health.status === "error-observed").length,
    schemaGaps: operations.filter(op => op.schema.definition === "gap").length,
    exampleGaps: operations.filter(op => op.examples.definition === "gap").length,
    historicalCaptureAnnotations: operations.filter(op => op.checkedInCaptureAnnotation !== "absent").length,
    completeBodyObserved: operations.filter(op => op.schema.evidence === "complete-body-observed").length,
  };
}

export async function buildRefreshInventory({ asOf = new Date().toISOString().slice(0, 10), freshnessDays = 30, observations = [] } = {}) {
  asOfTime(asOf);
  if (!Number.isFinite(freshnessDays) || freshnessDays < 0) throw new Error("freshnessDays must be nonnegative.");
  if (!Array.isArray(observations)) throw new Error("observations must be an array.");
  const inventory = await buildSpecInventory();
  const evaluationManifest = json(await readFile(path.join(repoRoot, "tools/recipe-evaluations.json"), "utf8"));
  const evaluations = new Map(evaluationManifest.evaluations.map(entry => [entry.recipePath, entry]));
  const specs = [];
  for (const spec of inventory) {
    const bundled = await loadBundledSpecification(path.resolve(repoRoot, spec.specPath));
    const operations = Object.entries(bundled.paths ?? {}).flatMap(([operationPath, pathItem]) => Object.entries(pathItem ?? {})
      .filter(([method, operation]) => methods.has(method) && operation && typeof operation === "object")
      .map(([method, operation]) => ({ ...summarizeRefreshOperation({ specId: spec.specId, method: method.toUpperCase(), path: operationPath, operation, observations, asOf, freshnessDays }),
        serverUrls: getEffectiveServerUrls(bundled, pathItem, operation) })))
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    const recipes = [];
    for (const recipePath of getCaptureRecipes(spec.title)) {
      const raw = await readFile(path.resolve(repoRoot, recipePath), "utf8");
      const recipe = json(raw), evaluation = evaluations.get(recipePath);
      const bindingValid = evaluation?.specId === spec.specId && evaluation.recipeSha256 === createHash("sha256").update(raw).digest("hex");
      const expires = observedTime(recipe.knownOperationRefresh?.approvalExpiresAt);
      const blockers = [];
      if (recipe.capturePrerequisite?.status === "blocked") blockers.push("capture-prerequisite-blocked");
      if (bindingValid && evaluation.disposition === "blocked-prerequisite") blockers.push("reviewed-prerequisite-blocked");
      if (recipe.knownOperationRefresh && (expires === null || expires < asOfTime(asOf))) blockers.push("refresh-approval-expired-or-invalid");
      if (recipe.knownOperationRefresh) {
        try {
          const approvalPath = path.resolve(repoRoot, recipe.knownOperationRefresh.approvalArtifact);
          const relative = path.relative(repoRoot, approvalPath);
          if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Refresh approval escapes the repository.");
          const approvalSource = await readFile(approvalPath, "utf8");
          if (hasUnmaterializedKnownOperationApproval(json(approvalSource))) blockers.push("refresh-approval-unmaterialized");
          if (createHash("sha256").update(approvalSource).digest("hex") !== recipe.knownOperationRefresh.approvalDigest) blockers.push("refresh-approval-binding-invalid");
        } catch { blockers.push("refresh-approval-unavailable-or-invalid"); }
      }
      if (evaluation && !bindingValid) blockers.push("evaluation-recipe-binding-stale");
      recipes.push({ recipePath, knownRefresh: Boolean(recipe.knownOperationRefresh),
        discoveryFrontier: Boolean(recipe.noveltyFrontier),
        disposition: bindingValid ? evaluation.disposition : "not-evaluated-for-current-bytes",
        blockers, nextRequirement: bindingValid ? evaluation.nextRequirement : null,
        targetRoutes: recipe.knownOperationRefresh?.routes ?? [],
        objectives: recipe.knownOperationRefresh?.documentationObjectives ?? [],
      });
    }
    const summary = counts(operations);
    specs.push({ specId: spec.specId, title: spec.title, specPath: spec.specPath, operationCount: operations.length,
      freshness: { ...summary, wholeSpecCurrent: false, reason: "operation-observations-do-not-establish-whole-spec-or-state-coverage" },
      authPattern: crawlMetadataByTitle[spec.title]?.authModel ?? "unknown",
      discovery: { nextPass: crawlMetadataByTitle[spec.title]?.nextPass ?? "unknown", reason: crawlMetadataByTitle[spec.title]?.reason ?? null,
        recipeCount: recipes.length, frontierRecipeCount: recipes.filter(recipe => recipe.discoveryFrontier).length },
      evidenceFiles: await evidenceFiles(spec.specPath), recipes,
      blockers: [...new Set(recipes.flatMap(recipe => recipe.blockers))].sort(), operations });
  }
  const allOperations = specs.flatMap(spec => spec.operations);
  return { schemaVersion: 1, asOf, freshnessDays,
    limitations: ["Freshness is per exact operation observation from a complete capture with verified action attribution, independent of health, schema and example coverage.",
      "Checked-in capture/context annotations and recipe evaluations are historical claims until private artifacts are verified.",
      "Auth patterns are authored metadata, not tested access, minimum roles or standalone execution proof.",
      "An unobserved operation or observed error never establishes removal."],
    summary: { specCount: specs.length, operationCount: allOperations.length, ...counts(allOperations),
      recipeCount: new Set(specs.flatMap(spec => spec.recipes.map(recipe => recipe.recipePath))).size,
      recipeAssignmentCount: specs.reduce((sum, spec) => sum + spec.recipes.length, 0) }, specs };
}
