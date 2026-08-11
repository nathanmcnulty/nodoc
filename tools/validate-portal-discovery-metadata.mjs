import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";
import {
  captureRecipesByTitle,
  coverageOverlayByTitle,
  crawlMetadataByTitle,
  getCoverageOverlay,
} from "./portal-discovery-metadata.mjs";
import {
  canonicalizeRecipeForDispatch,
  normalizeRecipeActions,
  resolvePageTargetCriteria,
} from "./portal-discovery-recipe.mjs";

const portfolioManifestPath = path.join(repoRoot, "tools", "portal-discovery-portfolio.json");

function stripBom(value) {
  return typeof value === "string" ? value.replace(/^\uFEFF/u, "") : value;
}

function fail(errors, message) {
  errors.push(message);
}

function validateKeyCoverage(errors, label, expectedTitles, actualKeys) {
  const actualSet = new Set(actualKeys);
  for (const title of expectedTitles) {
    if (!actualSet.has(title)) {
      fail(errors, `Missing ${label} entry for "${title}".`);
    }
  }

  const expectedSet = new Set(expectedTitles);
  for (const title of actualKeys) {
    if (!expectedSet.has(title)) {
      fail(errors, `Unexpected ${label} entry for "${title}".`);
    }
  }
}

function validateRouteEntries(errors, title, label, entries) {
  const seenRoutes = new Set();

  for (const entry of entries) {
    const method = String(entry?.method || "").toUpperCase();
    const routePath = String(entry?.path || "");
    const note = String(entry?.note || "").trim();

    if (!method) {
      fail(errors, `${title}: ${label} entry is missing an HTTP method.`);
    }

    if (!routePath.startsWith("/")) {
      fail(errors, `${title}: ${label} entry "${method} ${routePath}" must start with "/".`);
    }

    if (!note) {
      fail(errors, `${title}: ${label} entry "${method} ${routePath}" is missing a note.`);
    }

    const routeKey = `${method} ${routePath}`;
    if (seenRoutes.has(routeKey)) {
      fail(errors, `${title}: duplicate ${label} entry "${routeKey}".`);
    }
    seenRoutes.add(routeKey);
  }
}

async function validatePortfolioCoverageGapClasses(errors, specInventory) {
  let portfolio;
  try {
    portfolio = JSON.parse(stripBom(await readFile(portfolioManifestPath, "utf8")));
  } catch (error) {
    fail(errors, `tools/portal-discovery-portfolio.json: failed to read or parse portfolio JSON (${error.message}).`);
    return;
  }

  const portfolioBySpecId = new Map((portfolio.portals ?? []).map((entry) => [entry.specId, entry]));
  for (const spec of specInventory) {
    const overlay = getCoverageOverlay(spec.title);
    if (!Array.isArray(overlay.openGapClasses) || overlay.openGapClasses.length === 0) {
      continue;
    }

    const source = portfolioBySpecId.get(spec.specId);
    const actual = [...(source?.outstandingGapClasses ?? overlay.openGapClasses)].sort();
    const expected = [...overlay.openGapClasses].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(errors, `${spec.title}: portfolio outstandingGapClasses must match the authoritative coverage overlay openGapClasses.`);
    }
  }
}

function validateSeedRouteGroups(errors, recipePath, seedRouteGroups) {
  for (const [groupName, group] of Object.entries(seedRouteGroups ?? {})) {
    const routeTemplates = Array.isArray(group?.routeTemplates) ? group.routeTemplates : [];
    const idSources = Array.isArray(group?.idSources) ? group.idSources : [];

    if (routeTemplates.length === 0) {
      fail(errors, `${recipePath}: seed route group "${groupName}" must include at least one route template.`);
    }

    if (idSources.length === 0) {
      fail(errors, `${recipePath}: seed route group "${groupName}" must include at least one id source.`);
    }

    for (const source of idSources) {
      if (!String(source?.artifactFile || "").trim()) {
        fail(errors, `${recipePath}: seed route group "${groupName}" has an id source without artifactFile.`);
      }

      if (!String(source?.pattern || "").trim()) {
        fail(errors, `${recipePath}: seed route group "${groupName}" has an id source without pattern.`);
      }
    }
  }
}

async function validateRecipeFile(errors, classifications, recipePath) {
  const absolutePath = path.join(repoRoot, recipePath);
  let recipe;

  try {
    recipe = JSON.parse(stripBom(await readFile(absolutePath, "utf8")));
  } catch (error) {
    fail(errors, `${recipePath}: failed to read or parse recipe JSON (${error.message}).`);
    return;
  }

  if (!recipe || typeof recipe !== "object") {
    fail(errors, `${recipePath}: recipe content must be a JSON object.`);
    return;
  }

  if (!String(recipe.portal || "").trim()) {
    fail(errors, `${recipePath}: missing portal.`);
  }

  if (!String(recipe.url || "").trim()) {
    fail(errors, `${recipePath}: missing url.`);
  }

  if (recipe.actions === undefined || recipe.actions === null) {
    fail(errors, `${recipePath}: recipes must include at least one action.`);
  } else {
    try {
      const actions = normalizeRecipeActions(recipe.actions);
      if (actions.length === 0) {
        fail(errors, `${recipePath}: recipes must include at least one action.`);
      }
    } catch (error) {
      fail(errors, `${recipePath}: ${error.message}`);
    }
  }

  if (recipe.matchHosts && !Array.isArray(recipe.matchHosts)) {
    fail(errors, `${recipePath}: matchHosts must be an array when present.`);
  }

  if (recipe.matchPathPrefixes && !Array.isArray(recipe.matchPathPrefixes)) {
    fail(errors, `${recipePath}: matchPathPrefixes must be an array when present.`);
  }

  if (recipe.maxActions !== undefined && (!Number.isInteger(recipe.maxActions) || recipe.maxActions < 0)) {
    fail(errors, `${recipePath}: maxActions must be a non-negative integer when present.`);
  }

  try {
    resolvePageTargetCriteria(recipe);
    const metadata = canonicalizeRecipeForDispatch(recipe);
    classifications.push({
      recipePath,
      status: "dispatchable",
      mode: "live-capture",
      rootUrl: metadata.rootUrl,
      entryUrl: metadata.entryUrl,
    });
  } catch (error) {
    const mode = error.message.includes("pageTarget")
      ? "legacy-target-unmodeled"
      : error.message.includes("navigate action")
        ? "legacy-safety-blocked"
        : "legacy-validation-blocked";
    classifications.push({
      recipePath,
      status: "non-dispatchable",
      mode,
      reason: error.message,
    });
  }
  if (recipe.pageTarget !== undefined && (!recipe.pageTarget || typeof recipe.pageTarget !== "object" || Array.isArray(recipe.pageTarget))) {
    fail(errors, `${recipePath}: pageTarget must be an object when present.`);
  }

  validateSeedRouteGroups(errors, recipePath, recipe.seedRouteGroups);
}

async function main() {
  const specInventory = await buildSpecInventory();
  const specTitles = specInventory.map((record) => record.title);
  const errors = [];
  const classifications = [];

  await validatePortfolioCoverageGapClasses(errors, specInventory);

  validateKeyCoverage(errors, "crawl metadata", specTitles, Object.keys(crawlMetadataByTitle));
  validateKeyCoverage(errors, "coverage overlay", specTitles, Object.keys(coverageOverlayByTitle));

  for (const title of specTitles) {
    const crawlMetadata = crawlMetadataByTitle[title];
    for (const key of ["portalUrl", "authModel", "crawlPriority", "nextPass", "reason"]) {
      if (!String(crawlMetadata?.[key] || "").trim()) {
        fail(errors, `${title}: crawl metadata is missing "${key}".`);
      }
    }

    const overlay = getCoverageOverlay(title);
    validateRouteEntries(errors, title, "knownTelemetryExclusions", overlay.knownTelemetryExclusions ?? []);
    validateRouteEntries(errors, title, "promotedDiscoveries", overlay.promotedDiscoveries ?? []);

    const captureRecipes = captureRecipesByTitle[title] ?? [];
    const seenRecipePaths = new Set();
    for (const recipePath of captureRecipes) {
      if (seenRecipePaths.has(recipePath)) {
        fail(errors, `${title}: duplicate capture recipe "${recipePath}".`);
        continue;
      }
      seenRecipePaths.add(recipePath);
      await validateRecipeFile(errors, classifications, recipePath);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const recipeCount = Object.values(captureRecipesByTitle)
    .flat()
    .filter((value, index, values) => values.indexOf(value) === index)
    .length;
  const uniqueClassifications = [...new Map(classifications.map((entry) => [entry.recipePath, entry])).values()]
    .sort((left, right) => left.recipePath.localeCompare(right.recipePath));
  const dispatchable = uniqueClassifications.filter((entry) => entry.status === "dispatchable").length;
  const nonDispatchable = uniqueClassifications.filter((entry) => entry.status === "non-dispatchable").length;
  const unclassified = recipeCount - uniqueClassifications.length;
  if (unclassified !== 0) {
    throw new Error(`Recipe dispatch classification is incomplete: ${unclassified} recipe(s) are unclassified.`);
  }
  console.log(JSON.stringify({
    specs: specTitles.length,
    recipes: recipeCount,
    dispatchability: { dispatchable, nonDispatchable, unclassified },
    classifications: uniqueClassifications,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
