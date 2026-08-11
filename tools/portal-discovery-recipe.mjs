import { createHash } from "node:crypto";

import { classifyGetProbeUrl } from "./discovery-safety.mjs";
import { planActionBudget } from "./portal-discovery-action-budget.mjs";
import {
  buildEffectiveRecipeActions,
  normalizeRecipeAction,
  normalizeRecipeActions,
  validateEffectiveRecipeActions,
} from "./portal-discovery-actions.mjs";

export {
  buildEffectiveRecipeActions,
  normalizeRecipeAction,
  normalizeRecipeActions,
  validateEffectiveRecipeActions,
} from "./portal-discovery-actions.mjs";

function getRecipeNavigateActions(recipe) {
  return normalizeRecipeActions(recipe?.actions).map((action, index) => ({ ...action, index }))
    .filter((action) => action.type === "navigate");
}

function getRecipeEntry(recipe) {
  const navigateActions = getRecipeNavigateActions(recipe);
  return {
    isDeclaredRoot: navigateActions.length === 0,
    value: navigateActions.find((action) => action.value)?.value || recipe?.url || "",
  };
}

function canonicalizeRecipeRoot(recipe, actions = normalizeRecipeActions(recipe?.actions)) {
  try {
    const rootUrl = new URL(recipe?.url);
    const rootClassification = classifyGetProbeUrl(rootUrl.href, rootUrl.href);
    if (
      recipe?.pageTarget?.bootstrap === undefined
      && !actions.some((action) => action.type === "navigate")
      && rootClassification.allowed
    ) {
      rootUrl.hash = "";
    }
    return rootUrl.href;
  } catch {
    return recipe?.url ?? "";
  }
}

export function getRecipeEntryUrl(recipe) {
  return getRecipeEntry(recipe).value;
}

export function planRecipeActionBudget(recipe, options = {}) {
  return planActionBudget(recipe, options);
}

export function resolvePageTargetCriteria(recipe) {
  if (recipe?.pageTarget === undefined) {
    return {
      matchHosts: Array.isArray(recipe?.matchHosts) ? [...recipe.matchHosts] : [],
      matchPathPrefixes: Array.isArray(recipe?.matchPathPrefixes) ? [...recipe.matchPathPrefixes] : [],
    };
  }

  const pageTarget = recipe.pageTarget;
  if (!pageTarget || typeof pageTarget !== "object" || Array.isArray(pageTarget)) {
    throw new Error("pageTarget must be an object.");
  }
  if (!Array.isArray(pageTarget.matchHosts) || pageTarget.matchHosts.length === 0) {
    throw new Error("pageTarget.matchHosts must include at least one host.");
  }
  if (!Array.isArray(pageTarget.matchPathPrefixes) || pageTarget.matchPathPrefixes.length === 0) {
    throw new Error("pageTarget.matchPathPrefixes must include at least one path prefix.");
  }
  if (pageTarget.matchHosts.some((host) => typeof host !== "string" || !host.trim())) {
    throw new Error("pageTarget.matchHosts must contain non-empty strings.");
  }
  if (pageTarget.matchPathPrefixes.some((prefix) => typeof prefix !== "string" || !prefix.trim())) {
    throw new Error("pageTarget.matchPathPrefixes must contain non-empty strings.");
  }

  return {
    matchHosts: [...pageTarget.matchHosts],
    matchPathPrefixes: [...pageTarget.matchPathPrefixes],
  };
}

export function resolvePageTargetBootstrapCriteria(recipe) {
  if (recipe?.pageTarget === undefined) return null;
  const pageTarget = recipe.pageTarget;
  if (!pageTarget || typeof pageTarget !== "object" || Array.isArray(pageTarget)) {
    throw new Error("pageTarget must be an object.");
  }
  const bootstrap = pageTarget.bootstrap;
  if (bootstrap === undefined) return null;
  if (!bootstrap || typeof bootstrap !== "object" || Array.isArray(bootstrap)) {
    throw new Error("pageTarget.bootstrap must be an object.");
  }
  if (!Array.isArray(bootstrap.matchHosts) || bootstrap.matchHosts.length === 0) {
    throw new Error("pageTarget.bootstrap.matchHosts must include at least one host.");
  }
  if (!Array.isArray(bootstrap.matchPathnames) || bootstrap.matchPathnames.length === 0) {
    throw new Error("pageTarget.bootstrap.matchPathnames must include at least one pathname.");
  }
  if (bootstrap.matchHosts.some((host) => typeof host !== "string" || !host.trim())) {
    throw new Error("pageTarget.bootstrap.matchHosts must contain non-empty strings.");
  }
  if (bootstrap.matchPathnames.some((pathname) => (
    typeof pathname !== "string"
    || !pathname.startsWith("/")
    || pathname.includes("?")
    || pathname.includes("#")
  ))) {
    throw new Error("pageTarget.bootstrap.matchPathnames must contain clean absolute pathnames.");
  }

  const featureCriteria = resolvePageTargetCriteria(recipe);
  const featureHosts = new Set(featureCriteria.matchHosts.map((host) => host.toLowerCase()));
  if (bootstrap.matchHosts.some((host) => !featureHosts.has(host.toLowerCase()))) {
    throw new Error("pageTarget.bootstrap.matchHosts must be a subset of pageTarget.matchHosts.");
  }

  return {
    matchHosts: [...bootstrap.matchHosts].map((host) => host.toLowerCase()),
    matchPathnames: [...bootstrap.matchPathnames],
  };
}

export function validateRecipeTargetMetadata(recipe, { actions = buildEffectiveRecipeActions(recipe?.actions) } = {}) {
  const normalizedActions = normalizeRecipeActions(actions);
  const entry = getRecipeEntry({ ...recipe, actions: normalizedActions });
  const entryUrlValue = entry.value;
  let entryUrl;
  let recipeUrl;
  try {
    recipeUrl = new URL(recipe?.url);
    entryUrl = new URL(entryUrlValue, recipeUrl.href);
  } catch {
    throw new Error("recipe entry and declared root URLs must be valid URLs.");
  }
  const bootstrapCriteria = resolvePageTargetBootstrapCriteria(recipe);
  if (entryUrl.protocol !== "https:" || entryUrl.username || entryUrl.password || entryUrl.search) {
    throw new Error("recipe entry URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  validateEffectiveRecipeActions(normalizedActions, recipeUrl.href);
  const rootClassification = classifyGetProbeUrl(recipeUrl.href, recipeUrl.href);
  if (!rootClassification.allowed) {
    throw new Error(`declared root URL is not a safe same-origin GET (${rootClassification.code}).`);
  }
  const classification = classifyGetProbeUrl(entryUrl.href, recipeUrl.href);
  if (!classification.allowed) {
    throw new Error(`recipe entry URL is not a safe same-origin GET (${classification.code}).`);
  }
  if ((bootstrapCriteria || normalizedActions.some((action) => action.type === "navigate")) && recipeUrl.hash) {
    throw new Error("declared root URL must be an HTTPS URL without credentials, query, or fragment when explicit navigation is configured.");
  }
  if (!bootstrapCriteria && entry.isDeclaredRoot) {
    entryUrl.hash = "";
  }
  if (entryUrl.hash) {
    throw new Error("recipe entry URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  const featureCriteria = resolvePageTargetCriteria(recipe);
  if (!recipeEntryMatchesPageTarget(recipe)) {
    throw new Error("recipe entry URL does not match pageTarget host/path criteria.");
  }
  if (bootstrapCriteria && (
    !bootstrapCriteria.matchHosts.includes(recipeUrl.hostname.toLowerCase())
    || !bootstrapCriteria.matchPathnames.includes(recipeUrl.pathname)
  )) {
    throw new Error("declared root URL does not match pageTarget.bootstrap host/path criteria.");
  }
  const rootUrl = canonicalizeRecipeRoot(recipe, normalizedActions);
  return {
    entryUrl: entryUrl.href,
    rootUrl,
    featureCriteria,
    bootstrapCriteria,
  };
}

export function canonicalizeRecipeForDispatch(recipe, { actionOverrides = [] } = {}) {
  const actions = buildEffectiveRecipeActions(recipe?.actions, actionOverrides);
  const metadata = validateRecipeTargetMetadata(recipe, { actions });
  return {
    ...metadata,
    actions,
    recipe: {
      ...recipe,
      url: metadata.rootUrl,
    },
  };
}

export function canonicalRecipeDigest(recipe) {
  const actions = normalizeRecipeActions(recipe?.actions);
  const canonicalRecipe = {
    ...recipe,
    actions,
    url: canonicalizeRecipeRoot(recipe, actions),
  };
  return createHash("sha256")
    .update(`${JSON.stringify(canonicalRecipe)}\n`, "utf8")
    .digest("hex");
}

export function recipeEntryMatchesPageTarget(recipe) {
  let entryUrl;
  try {
    const rootUrl = new URL(recipe?.url);
    entryUrl = new URL(getRecipeEntryUrl(recipe), rootUrl.href);
  } catch {
    return false;
  }

  let criteria;
  try {
    criteria = resolvePageTargetCriteria(recipe);
  } catch {
    return false;
  }
  const { matchHosts, matchPathPrefixes } = criteria;
  const normalizedHost = entryUrl.hostname.toLowerCase();
  const hostMatches = matchHosts.length === 0
    || matchHosts.some((host) => String(host).toLowerCase() === normalizedHost);
  const pathMatches = matchPathPrefixes.length === 0
    || matchPathPrefixes.some((prefix) => entryUrl.pathname.startsWith(String(prefix)));
  return hostMatches && pathMatches;
}
