import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";
import {
  captureRecipesByTitle,
  crawlMetadataByTitle,
  hasRecorderSupport,
  readRecorderPortalIds,
} from "./portal-discovery-metadata.mjs";

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

async function readRecipeMetrics(recipePath) {
  const absolutePath = path.join(repoRoot, recipePath);
  const source = stripBom(await readFile(absolutePath, "utf8"));
  const recipe = JSON.parse(source);
  const actions = Array.isArray(recipe.actions) ? recipe.actions : [];
  const descriptors = actions.map(toActionDescriptor);

  return {
    actionCount: descriptors.length,
    captureActions: descriptors.filter((entry) => entry.type === "capture").length,
    iframeClicks: descriptors.filter((entry) => entry.scope === "iframe" && entry.type.startsWith("click")).length,
    navigateActions: descriptors.filter((entry) => entry.type === "navigate").length,
    rootClicks: descriptors.filter((entry) => entry.scope === "root" && entry.type.startsWith("click")).length,
    seededLinkActions: descriptors.filter((entry) => entry.type === "replay-seeded-links").length,
    seededRouteActions: descriptors.filter((entry) => entry.type === "replay-seeded-routes").length,
    usesVariables: source.includes("${"),
    waitActions: descriptors.filter((entry) => entry.type === "wait-ms").length,
  };
}

function sumRecipeMetrics(recipePaths, metricsByPath) {
  return recipePaths.reduce((aggregate, recipePath) => {
    const metrics = metricsByPath.get(recipePath) ?? {};
    for (const key of [
      "actionCount",
      "captureActions",
      "iframeClicks",
      "navigateActions",
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

    return aggregate;
  }, {
    actionCount: 0,
    captureActions: 0,
    iframeClicks: 0,
    navigateActions: 0,
    rootClicks: 0,
    seededLinkActions: 0,
    seededRouteActions: 0,
    variableRecipes: 0,
    waitActions: 0,
  });
}

function buildMissingAxes(summary) {
  const missing = [];

  if (summary.recipeCount === 0) {
    missing.push("recipe");
  }

  if (summary.recipeCount > 0 && summary.rootClicks + summary.navigateActions === 0) {
    missing.push("base-nav");
  }

  if (summary.iframeClicks === 0) {
    missing.push("iframe");
  }

  if (summary.seededLinkActions + summary.seededRouteActions === 0) {
    missing.push("seeded-replay");
  }

  if (summary.captureActions + summary.waitActions === 0) {
    missing.push("interaction-checkpoints");
  }

  return missing;
}

function buildRecommendedNext(summary, specTitle, operationCount) {
  if (summary.recipeCount === 0) {
    return "add-base-recipe";
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
  const metricsByPath = new Map();
  for (const recipePath of recipePaths) {
    metricsByPath.set(recipePath, await readRecipeMetrics(recipePath));
  }

  const rows = specInventory
    .map((specRecord) => {
      const recipePathsForTitle = captureRecipesByTitle[specRecord.title] ?? [];
      const recipeSummary = sumRecipeMetrics(recipePathsForTitle, metricsByPath);
      const summary = {
        ...recipeSummary,
        crawlPriority: crawlMetadataByTitle[specRecord.title]?.crawlPriority ?? "unknown",
        missingAxes: buildMissingAxes({
          ...recipeSummary,
          recipeCount: recipePathsForTitle.length,
        }),
        nextPass: crawlMetadataByTitle[specRecord.title]?.nextPass ?? "unknown",
        operationCount: specRecord.operationCount,
        recorderSupported: hasRecorderSupport(specRecord.specId, recorderPortalIds),
        recipeCount: recipePathsForTitle.length,
        recipePaths: recipePathsForTitle,
        recommendedNext: buildRecommendedNext({
          ...recipeSummary,
          recipeCount: recipePathsForTitle.length,
        }, specRecord.title, specRecord.operationCount),
        score: [
          recipePathsForTitle.length > 0,
          recipeSummary.rootClicks + recipeSummary.navigateActions > 0,
          recipeSummary.iframeClicks > 0,
          recipeSummary.seededLinkActions + recipeSummary.seededRouteActions > 0,
          recipeSummary.captureActions + recipeSummary.waitActions > 0,
        ].filter(Boolean).length,
        title: specRecord.title,
      };

      return summary;
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.table(rows.map((row) => ({
    title: row.title,
    ops: row.operationCount,
    recorder: row.recorderSupported ? "yes" : "no",
    recipes: row.recipeCount,
    score: `${row.score}/5`,
    root: row.rootClicks,
    iframe: row.iframeClicks,
    seeded: row.seededLinkActions + row.seededRouteActions,
    checkpoints: row.captureActions + row.waitActions,
    next: row.recommendedNext,
    missing: row.missingAxes.join(", ") || "none",
  })));

  const noRecipe = rows.filter((row) => row.recipeCount === 0).map((row) => row.title);
  console.log(`Missing checked-in recipes (${noRecipe.length}): ${noRecipe.join(", ") || "none"}`);
}

await main();