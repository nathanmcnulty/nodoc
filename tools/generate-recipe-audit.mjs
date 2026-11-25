import { createHash } from "node:crypto";
import { validateRecipeEvaluationManifest } from "./recipe-evaluation-dispositions.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";
import {
  captureRecipesByTitle,
  crawlMetadataByTitle,
  hasRecorderSupport,
  readRecorderPortalIds,
} from "./portal-discovery-metadata.mjs";
import { buildNoveltyPlan } from "./portal-discovery-novelty.mjs";
import { buildKnownOperationRefreshPlan, evaluateEvidenceAxes } from "./portal-discovery-evidence-contract.mjs";

function stripBom(value) {
  return typeof value === "string" ? value.replace(/^\uFEFF/u, "") : value;
}

function toActionDescriptor(action) {
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    const rawType = separator > 0 ? action.slice(0, separator) : action;
    return {
      scope: rawType.endsWith("-root")
        ? "root"
        : rawType.endsWith("-iframe")
          ? "iframe"
          : "any",
      type: rawType.replace(/-(root|iframe)$/u, ""),
    };
  }

  const rawType = String(action?.type || "").trim();
  const scope = String(action?.scope || "any").trim() || "any";
  return {
    scope,
    type: rawType,
  };
}

async function readRecipeMetrics(recipePath, evaluations) {
  const absolutePath = path.join(repoRoot, recipePath);
  const source = stripBom(await readFile(absolutePath, "utf8"));
  const recipe = JSON.parse(source);
  const actions = Array.isArray(recipe.actions) ? recipe.actions : [];
  const descriptors = actions.map(toActionDescriptor);
  const noveltyPlan = buildNoveltyPlan(recipe);
  const knownOperationRefreshPlan = buildKnownOperationRefreshPlan(recipe);
  if (recipe.capturePrerequisite?.status === "blocked"
      && (typeof recipe.capturePrerequisite.nextRequirement !== "string" || !recipe.capturePrerequisite.nextRequirement.trim())) {
    throw new Error(`Blocked prerequisite in ${recipePath} must state the evidence needed to reopen capture.`);
  }

  return {
    actionCount: descriptors.length,
    captureActions: descriptors.filter((entry) => entry.type === "capture").length,
    iframeClicks: descriptors.filter((entry) => entry.scope === "iframe" && entry.type.startsWith("click")).length,
    navigateActions: descriptors.filter((entry) => entry.type === "navigate").length,
    noveltyTargetCount: noveltyPlan?.measurements.frontierTargetCount ?? 0,
    noveltyTargetedActionCount: noveltyPlan?.measurements.frontierTargetedActionCount ?? 0,
    knownOperationRefreshCount: knownOperationRefreshPlan ? 1 : 0,
    reviewedRefreshCount: knownOperationRefreshPlan && evaluations.has(recipePath) ? 1 : 0,
    evidenceAxes: evaluateEvidenceAxes(recipe),
    blockedPrerequisiteCount: recipe.capturePrerequisite?.status === "blocked" ? 1 : 0,
    satisfiedNoveltyCount: recipe.noveltyStatus?.status === "satisfied" ? 1 : 0,
    rootClicks: descriptors.filter((entry) => entry.scope === "root" && entry.type.startsWith("click")).length,
    seededLinkActions: descriptors.filter((entry) => entry.type === "replay-seeded-links").length,
    seededRouteActions: descriptors.filter((entry) => entry.type === "replay-seeded-routes").length,
    usesVariables: source.includes("${"),
    waitActions: descriptors.filter((entry) => entry.type === "wait-ms").length,
  };
}

function sumRecipeMetrics(recipePaths, metricsByPath) {
  const aggregate = recipePaths.reduce((aggregate, recipePath) => {
    const metrics = metricsByPath.get(recipePath) ?? {};
    for (const key of [
      "actionCount",
      "blockedPrerequisiteCount",
      "captureActions",
      "iframeClicks",
      "navigateActions",
      "noveltyTargetCount",
      "noveltyTargetedActionCount",
      "knownOperationRefreshCount",
      "reviewedRefreshCount",
      "satisfiedNoveltyCount",
      "rootClicks",
      "seededLinkActions",
      "seededRouteActions",
      "waitActions",
    ]) {
      aggregate[key] += metrics[key] ?? 0;
    }

    if (metrics.usesVariables) {
      aggregate.variableRecipes += 1;
    }
    for (const axis of ["freshness", "discovery", "schema", "usage"]) {
      aggregate.evidenceAxes[axis].add(metrics.evidenceAxes?.[axis]?.status ?? "unknown");
    }

    return aggregate;
  }, {
    actionCount: 0,
    blockedPrerequisiteCount: 0,
    captureActions: 0,
    iframeClicks: 0,
    navigateActions: 0,
    noveltyTargetCount: 0,
    noveltyTargetedActionCount: 0,
    knownOperationRefreshCount: 0,
    reviewedRefreshCount: 0,
    satisfiedNoveltyCount: 0,
    rootClicks: 0,
    seededLinkActions: 0,
    seededRouteActions: 0,
    variableRecipes: 0,
    waitActions: 0,
    evidenceAxes: { freshness: new Set(), discovery: new Set(), schema: new Set(), usage: new Set() },
  });
  aggregate.evidenceAxes = Object.fromEntries(Object.entries(aggregate.evidenceAxes).map(([axis, states]) => [axis, [...states].sort()]));
  return aggregate;
}

function buildMissingAxes(summary) {
  const missing = [];

  if (summary.recipeCount === 0 && !summary.derivedResearchSurface) {
    missing.push("recipe");
  }

  if (summary.derivedResearchSurface) {
    return missing;
  }

  if (summary.recipeCount > 0 && summary.rootClicks + summary.navigateActions === 0) {
    missing.push("base-nav");
  }

  if (summary.captureActions + summary.waitActions === 0) {
    missing.push("interaction-checkpoints");
  }

  if (
    summary.recipeCount > 0
    && summary.noveltyTargetCount === 0
    && summary.satisfiedNoveltyCount === 0
    && summary.blockedPrerequisiteCount === 0
  ) {
    missing.push("novelty-frontier");
  }

  return missing;
}

export function buildRecommendedNext(summary, specTitle, operationCount) {
  if (summary.derivedResearchSurface) {
    return "collect-through-owning-portals";
  }

  if (summary.recipeCount === 0) {
    return "add-base-recipe";
  }

  if (summary.blockedPrerequisiteCount > 0) {
    return "blocked-prerequisite-await-new-approved-frontier";
  }

  if (summary.noveltyTargetCount === 0 && summary.satisfiedNoveltyCount > 0) {
    return "blocked-satisfied-await-new-approved-frontier";
  }

  if (summary.noveltyTargetCount === 0) {
    return "add-novelty-frontier";
  }

  if (specTitle.startsWith("Entra") && summary.iframeClicks === 0) {
    return "add-iframe-actions";
  }

  if (summary.captureActions + summary.waitActions === 0) {
    return "add-checkpoints";
  }

  if (summary.seededLinkActions + summary.seededRouteActions === 0 && operationCount <= 50) {
    return "add-seeded-detail-replay";
  }

  if (summary.seededLinkActions + summary.seededRouteActions === 0) {
    return "add-targeted-followup";
  }

  return "maintain-and-diff";
}

export function buildEvaluationStatus(summary) {
  if (summary.derivedResearchSurface) {
    return "derived-current";
  }

  if (summary.noveltyTargetCount > 0) {
    return "active-frontier";
  }

  if (summary.blockedPrerequisiteCount > 0) {
    return "blocked-prerequisite";
  }

  if (summary.knownOperationRefreshCount > 0) {
    return summary.reviewedRefreshCount === summary.knownOperationRefreshCount ? "evaluated-with-gaps" : "refresh-contract-present";
  }

  const axes = summary.evidenceAxes ?? {};
  if ((axes.freshness ?? []).some((state) => ["gap", "unknown"].includes(state))) {
    return "freshness-gap";
  }
  if (summary.satisfiedNoveltyCount > 0) {
    return "evaluated-with-gaps";
  }

  return "needs-frontier";
}

async function main() {
  const specInventory = await buildSpecInventory();
  const recorderSource = await readFile(
    path.join(repoRoot, "tools", "nodoc-recorder", "background.js"),
    "utf8",
  );
  const recorderPortalIds = readRecorderPortalIds(recorderSource);
  const recipePaths = Object.values(captureRecipesByTitle)
    .flat()
    .filter((value, index, values) => values.indexOf(value) === index);
  const currentBindings = new Map();
  for (const specRecord of specInventory) {
    for (const recipePath of captureRecipesByTitle[specRecord.title] ?? []) {
      const bytes = await readFile(path.join(repoRoot, recipePath));
      const recipe = JSON.parse(stripBom(bytes.toString("utf8")));
      currentBindings.set(recipePath, { specId: specRecord.specId, sha256: createHash("sha256").update(bytes).digest("hex"), knownOperationRefresh: Boolean(recipe.knownOperationRefresh) });
    }
  }
  const evaluations = validateRecipeEvaluationManifest(JSON.parse(stripBom(await readFile(path.join(repoRoot, "tools/recipe-evaluations.json"), "utf8"))), currentBindings);
  const metricsByPath = new Map();
  for (const recipePath of recipePaths) {
    metricsByPath.set(recipePath, await readRecipeMetrics(recipePath, evaluations));
  }

  const rows = specInventory
    .map((specRecord) => {
      const recipePathsForTitle = captureRecipesByTitle[specRecord.title] ?? [];
      const recipeSummary = sumRecipeMetrics(recipePathsForTitle, metricsByPath);
      const derivedResearchSurface = specRecord.specId === "graph-research";
      const summary = {
        ...recipeSummary,
        crawlPriority: crawlMetadataByTitle[specRecord.title]?.crawlPriority ?? "unknown",
        missingAxes: buildMissingAxes({
          ...recipeSummary,
          derivedResearchSurface,
          recipeCount: recipePathsForTitle.length,
        }),
        derivedResearchSurface,
        evaluationStatus: buildEvaluationStatus({
          ...recipeSummary,
          derivedResearchSurface,
        }),
        nextPass: crawlMetadataByTitle[specRecord.title]?.nextPass ?? "unknown",
        operationCount: specRecord.operationCount,
        recorderSupported: hasRecorderSupport(specRecord.specId, recorderPortalIds),
        recipeCount: recipePathsForTitle.length,
        recipePaths: recipePathsForTitle,
        recommendedNext: buildRecommendedNext({
          ...recipeSummary,
          derivedResearchSurface,
          recipeCount: recipePathsForTitle.length,
        }, specRecord.title, specRecord.operationCount),
        score: [
          recipePathsForTitle.length > 0,
          recipeSummary.rootClicks + recipeSummary.navigateActions > 0,
          recipeSummary.iframeClicks > 0,
          recipeSummary.seededLinkActions + recipeSummary.seededRouteActions > 0,
          recipeSummary.captureActions + recipeSummary.waitActions > 0,
          recipeSummary.noveltyTargetCount > 0,
        ].filter(Boolean).length,
        scoreMeaning: "recipe-capability-inventory-not-api-execution-coverage",
        title: specRecord.title,
      };

      return summary;
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const unevaluated = rows.filter((row) => ["active-frontier", "needs-frontier", "refresh-contract-present", "freshness-gap"].includes(row.evaluationStatus));
  if (process.argv.includes("--require-evaluated") && unevaluated.length > 0) {
    process.exitCode = 1;
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.table(rows.map((row) => ({
    title: row.title,
    ops: row.operationCount,
    recorder: row.recorderSupported ? "yes" : "no",
    recipes: row.recipeCount,
    capabilities: `${row.score}/6`,
    root: row.rootClicks,
    iframe: row.iframeClicks,
    seeded: row.seededLinkActions + row.seededRouteActions,
    checkpoints: row.captureActions + row.waitActions,
    novelty: row.noveltyTargetCount,
    refresh: row.knownOperationRefreshCount,
    freshness: row.evidenceAxes.freshness.join("/") || "unknown",
    schema: row.evidenceAxes.schema.join("/") || "unknown",
    usage: row.evidenceAxes.usage.join("/") || "unknown",
    evaluation: row.evaluationStatus,
    next: row.recommendedNext,
    missing: row.missingAxes.join(", ") || "none",
  })));

  const noRecipe = rows
    .filter((row) => row.recipeCount === 0 && !row.derivedResearchSurface)
    .map((row) => row.title);
  console.log(`Missing checked-in recipes (${noRecipe.length}): ${noRecipe.join(", ") || "none"}`);

  console.log(`Specifications awaiting evaluation (${unevaluated.length}): ${unevaluated.map((row) => row.title).join(", ") || "none"}`);
  if (process.argv.includes("--require-evaluated") && unevaluated.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
