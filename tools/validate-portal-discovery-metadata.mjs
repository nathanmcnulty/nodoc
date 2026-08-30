import { createHash } from "node:crypto";
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
  resolvePageTargetCriteria,
  validateRecipeTargetMetadata,
} from "./portal-discovery-recipe.mjs";
import { buildNoveltyPlan } from "./portal-discovery-novelty.mjs";
import { validateActiveOperationPlan } from "./portal-discovery-operation-safety.mjs";

const portfolioManifestPath = path.join(repoRoot, "tools", "portal-discovery-portfolio.json");

const supportedRecipeActionTypes = new Set([
  "capture",
  "click",
  "click-automation-id",
  "click-contains",
  "click-href",
  "click-label",
  "crawl-links",
  "navigate",
  "probe-get",
  "reload",
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

  if (recipe.activeOperations !== undefined && !Array.isArray(recipe.activeOperations)) {
    fail(errors, `${recipePath}: activeOperations must be an array when present.`);
  } else if ((recipe.activeOperations?.length ?? 0) > 1) {
    fail(errors, `${recipePath}: a recipe may contain at most one active operation plan.`);
  } else {
    for (const operation of recipe.activeOperations ?? []) {
      try {
        validateActiveOperationPlan(operation, { actions: recipe.actions });
      } catch (error) {
        fail(errors, `${recipePath}: invalid active operation plan (${error.message}).`);
      }
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
    validateRecipeTargetMetadata(recipe);
    buildNoveltyPlan(recipe);
    if (recipe.noveltyFrontier) {
      const approvalPath = String(recipe.noveltyFrontier.approvalArtifact || "").trim();
      if (!approvalPath) {
        fail(errors, `${recipePath}: active noveltyFrontier requires approvalArtifact.`);
      } else {
        const approvalAbsolute = path.resolve(repoRoot, approvalPath);
        const relativeApproval = path.relative(repoRoot, approvalAbsolute);
        if (relativeApproval.startsWith("..") || path.isAbsolute(relativeApproval)) {
          fail(errors, `${recipePath}: approvalArtifact must remain inside the repository.`);
        } else {
          const approvalSource = await readFile(approvalAbsolute, "utf8");
          const approval = JSON.parse(stripBom(approvalSource));
          const approvalDigest = createHash("sha256").update(approvalSource, "utf8").digest("hex");
          if (approvalDigest !== recipe.noveltyFrontier.approvalDigest) fail(errors, `${recipePath}: approvalArtifact digest does not match approvalDigest.`);
          if (approval.workerModel !== "gpt-5.6-luna" || !["xhigh", "max"].includes(approval.workerReasoning) || approval.decision !== "accept-bounded-frontier" || !Array.isArray(approval.acceptedItems) || approval.acceptedItems.length === 0) fail(errors, `${recipePath}: approvalArtifact is not an exact Luna xhigh/max bounded-frontier approval.`);
          const sourceArtifactPath = String(approval.source?.artifactPath || "").trim();
          if (!sourceArtifactPath) {
            fail(errors, `${recipePath}: approvalArtifact requires a checked-in source.artifactPath.`);
          } else {
            const sourceAbsolute = path.resolve(repoRoot, sourceArtifactPath);
            const sourceRelative = path.relative(repoRoot, sourceAbsolute);
            if (sourceRelative.startsWith("..") || path.isAbsolute(sourceRelative)) {
              fail(errors, `${recipePath}: approval source artifact must remain inside the repository.`);
            } else {
              const sourceText = await readFile(sourceAbsolute, "utf8");
              const sourceSha256 = createHash("sha256").update(sourceText, "utf8").digest("hex");
              const sourceArtifact = JSON.parse(stripBom(sourceText));
              if (approval.source?.artifactSha256 !== sourceSha256) fail(errors, `${recipePath}: approval source artifact hash mismatch.`);
              if (approval.source?.frontierSetId !== sourceArtifact.frontierSetId || approval.source?.frontierSetDigest !== sourceArtifact.frontierSetDigest) fail(errors, `${recipePath}: approval source frontier identity mismatch.`);
              const approvedItems = (sourceArtifact.items ?? []).filter((item) => item.status === "approved");
              const accepted = approval.acceptedItems ?? [];
              if (accepted.length !== approvedItems.length || accepted.some((item) => !approvedItems.some((sourceItem) => sourceItem.frontierId === item.frontierId && sourceItem.frontierDigest === item.frontierDigest && sourceItem.canonicalKey === item.canonicalKey))) fail(errors, `${recipePath}: approval acceptedItems do not exactly match the approved source frontier.`);
            }
          }
        }
      }
    }
    if (recipe.noveltyStatus?.status === "satisfied") {
      let blockedBeforeBrowser = false;
      try {
        buildNoveltyPlan(recipe, {
          required: true,
          derivedBaseline: { source: "checked-in-openapi", operations: [] },
        });
      } catch (error) {
        blockedBeforeBrowser = error?.code === "novelty-frontier-invalid"
          && /prior novelty frontier is satisfied/u.test(error.message);
      }
      if (!blockedBeforeBrowser) fail(errors, `${recipePath}: satisfied novelty state does not block pre-browser planning.`);
    }
  } catch (error) {
    fail(errors, `${recipePath}: ${error.message}`);
  }

  validateSeedRouteGroups(errors, recipePath, recipe.seedRouteGroups);
}

async function main() {
  const specInventory = await buildSpecInventory();
  const specTitles = specInventory.map((record) => record.title);
  const errors = [];

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
