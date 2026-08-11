import { planActionBudget } from "./portal-discovery-action-budget.mjs";
import {
  buildEffectiveActions,
  normalizeRecipeAction,
  pathMatchesCriteria,
  resolveStrictNavigationUrl,
  validateSelectedReplayRouteTemplates,
  validateEffectiveActions,
} from "./portal-discovery-actions.mjs";

function actionTypeAndValue(action) {
  try {
    const normalized = normalizeRecipeAction(action);
    return { type: normalized.type, value: normalized.value };
  } catch {
    return { type: "", value: "" };
  }
}

export function getRecipeEntryUrl(recipe) {
  const firstNavigate = (recipe?.actions ?? [])
    .map(actionTypeAndValue)
    .find((action) => action.type === "navigate" && action.value);
  return firstNavigate?.value || recipe?.url || "";
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

export function validateRecipeTargetMetadata(recipe, { enforcePageTargetForAll = true } = {}) {
  const featureCriteria = resolvePageTargetCriteria(recipe);
  const bootstrapCriteria = resolvePageTargetBootstrapCriteria(recipe);
  const recipeUrl = resolveStrictNavigationUrl(recipe?.url, recipe?.url, {
    label: "declared root",
  });
  const effectiveActions = buildEffectiveActions({
    recipeActions: recipe?.actions ?? [],
    includeInitialNavigation: true,
    initialUrl: recipeUrl,
  });
  const validatedActions = validateEffectiveActions(effectiveActions, {
    rootUrl: recipeUrl,
    pageTarget: recipe?.pageTarget === undefined ? null : featureCriteria,
    bootstrapTarget: recipe?.pageTarget === undefined ? null : bootstrapCriteria,
    enforcePageTargetForAll,
  });
  validateSelectedReplayRouteTemplates(recipe?.seedRouteGroups, validatedActions, {
    rootUrl: recipeUrl,
    criteria: recipe?.pageTarget === undefined ? null : featureCriteria,
  });
  const entryUrl = validatedActions.find((action) => action.source !== "initial" && action.type === "navigate")?.resolvedUrl
    ?? validatedActions[0].resolvedUrl;
  if (
    recipe?.pageTarget !== undefined
    && !recipeEntryMatchesPageTarget({ ...recipe, actions: [{ type: "navigate", value: entryUrl }] })
  ) {
    throw new Error("recipe entry URL does not match pageTarget host/path criteria.");
  }
  return {
    entryUrl,
    featureCriteria,
    bootstrapCriteria,
  };
}

export function recipeEntryMatchesPageTarget(recipe) {
  let entryUrl;
  try {
    entryUrl = new URL(getRecipeEntryUrl(recipe), recipe?.url);
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
  const pathMatches = pathMatchesCriteria(entryUrl.pathname, matchPathPrefixes);
  return hostMatches && pathMatches;
}
