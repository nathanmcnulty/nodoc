import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";
import {
  captureRecipesByTitle,
  coverageOverlayByTitle,
  crawlMetadataByTitle,
  getCoverageOverlay,
} from "./portal-discovery-metadata.mjs";

const supportedRecipeActionTypes = new Set([
  "capture",
  "click",
  "click-contains",
  "click-href",
  "click-label",
  "navigate",
  "replay-seeded-links",
  "replay-seeded-routes",
  "wait-ms",
]);

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

function validateRecipeAction(errors, recipePath, action) {
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    const rawType = separator > 0 ? action.slice(0, separator) : action;
    const normalizedType = rawType.replace(/-(root|iframe)$/u, "");
    if (!supportedRecipeActionTypes.has(normalizedType)) {
      fail(errors, `${recipePath}: unsupported recipe action "${rawType}".`);
    }
    return;
  }

  if (!action || typeof action !== "object") {
    fail(errors, `${recipePath}: recipe actions must be strings or objects.`);
    return;
  }

  const rawType = String(action.type || "");
  if (!supportedRecipeActionTypes.has(rawType)) {
    fail(errors, `${recipePath}: unsupported recipe action "${rawType}".`);
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

async function validateRecipeFile(errors, recipePath) {
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

  if (!Array.isArray(recipe.actions) || recipe.actions.length === 0) {
    fail(errors, `${recipePath}: recipes must include at least one action.`);
  } else {
    for (const action of recipe.actions) {
      validateRecipeAction(errors, recipePath, action);
    }
  }

  if (recipe.matchHosts && !Array.isArray(recipe.matchHosts)) {
    fail(errors, `${recipePath}: matchHosts must be an array when present.`);
  }

  if (recipe.matchPathPrefixes && !Array.isArray(recipe.matchPathPrefixes)) {
    fail(errors, `${recipePath}: matchPathPrefixes must be an array when present.`);
  }

  validateSeedRouteGroups(errors, recipePath, recipe.seedRouteGroups);
}

async function main() {
  const specInventory = await buildSpecInventory();
  const specTitles = specInventory.map((record) => record.title);
  const errors = [];

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
      await validateRecipeFile(errors, recipePath);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const recipeCount = Object.values(captureRecipesByTitle)
    .flat()
    .filter((value, index, values) => values.indexOf(value) === index)
    .length;
  console.log(`Validated portal discovery metadata for ${specTitles.length} specs and ${recipeCount} capture recipes.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
