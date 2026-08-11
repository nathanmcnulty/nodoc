import { createHash } from "node:crypto";

import { classifyGetProbeUrl } from "./discovery-safety.mjs";
import { planActionBudget } from "./portal-discovery-action-budget.mjs";

const supportedActionTypes = new Set([
  "capture",
  "click-contains",
  "click-href",
  "click-label",
  "crawl-links",
  "navigate",
  "probe-get",
  "replay-seeded-links",
  "replay-seeded-routes",
  "wait-ms",
]);

export function normalizeRecipeAction(action) {
  let rawType;
  let rawValue;
  let requestedScope = "any";
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid action "${action}". Expected type=value.`);
    }
    rawType = action.slice(0, separator).trim();
    rawValue = action.slice(separator + 1).trim();
  } else if (action && typeof action === "object" && !Array.isArray(action)) {
    rawType = String(action.type ?? "").trim();
    rawValue = String(action.value ?? "").trim();
    requestedScope = String(action.scope ?? "any").trim().toLowerCase() || "any";
    if (!rawType) {
      throw new Error("Recipe action objects must include a type.");
    }
  } else {
    throw new Error("Recipe actions must be strings or objects.");
  }

  const normalizedRawType = rawType.toLowerCase();
  if (!["any", "root", "iframe"].includes(requestedScope)) {
    throw new Error(`Unsupported action scope "${requestedScope}".`);
  }
  const scopedType = requestedScope !== "any"
    && !normalizedRawType.endsWith(`-${requestedScope}`)
    ? `${normalizedRawType}-${requestedScope}`
    : normalizedRawType;
  const scope = scopedType.endsWith("-root")
    ? "root"
    : scopedType.endsWith("-iframe")
      ? "iframe"
      : "any";
  const normalizedType = scopedType.replace(/-(root|iframe)$/u, "");
  const type = normalizedType === "click" ? "click-label" : normalizedType;
  if (!supportedActionTypes.has(type)) {
    throw new Error(`Unsupported action type "${rawType}".`);
  }
  return {
    raw: typeof action === "string" ? action : JSON.stringify(action),
    scope,
    type,
    value: rawValue,
    ...(action && typeof action === "object" && !Array.isArray(action)
      ? {
        highValue: action.highValue === true,
        optional: action.optional === true,
        required: Boolean(action.required),
      }
      : {}),
  };
}

export function normalizeRecipeActions(actions) {
  return (Array.isArray(actions) ? actions : []).map(normalizeRecipeAction);
}

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

function canonicalizeRecipeRoot(recipe) {
  try {
    const rootUrl = new URL(recipe?.url);
    const rootClassification = classifyGetProbeUrl(rootUrl.href, rootUrl.href);
    if (
      recipe?.pageTarget?.bootstrap === undefined
      && getRecipeNavigateActions(recipe).length === 0
      && rootClassification.allowed
    ) {
      rootUrl.hash = "";
    }
    return rootUrl.href;
  } catch {
    return recipe?.url ?? "";
  }
}

function validateRecipeNavigateActions(recipe, recipeUrl) {
  for (const action of getRecipeNavigateActions(recipe)) {
    if (!action.value) {
      throw new Error(`recipe navigate action ${action.index} must include a URL.`);
    }
    const actionUrl = new URL(action.value, recipeUrl.href);
    const classification = classifyGetProbeUrl(action.value, recipeUrl.href);
    if (!classification.allowed) {
      throw new Error(`recipe navigate action ${action.index} is not a safe same-origin GET (${classification.code}).`);
    }
    if (actionUrl.protocol !== "https:" || actionUrl.username || actionUrl.password || actionUrl.search) {
      throw new Error(`recipe navigate action ${action.index} must be an HTTPS URL without credentials, query, or fragment.`);
    }
    if (actionUrl.hash) {
      throw new Error(`recipe navigate action ${action.index} must be an HTTPS URL without fragment.`);
    }
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

export function validateRecipeTargetMetadata(recipe) {
  const entry = getRecipeEntry(recipe);
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
  validateRecipeNavigateActions(recipe, recipeUrl);
  const rootClassification = classifyGetProbeUrl(recipeUrl.href, recipeUrl.href);
  if (!rootClassification.allowed) {
    throw new Error(`declared root URL is not a safe same-origin GET (${rootClassification.code}).`);
  }
  const classification = classifyGetProbeUrl(entryUrl.href, recipeUrl.href);
  if (!classification.allowed) {
    throw new Error(`recipe entry URL is not a safe same-origin GET (${classification.code}).`);
  }
  if ((bootstrapCriteria || getRecipeNavigateActions(recipe).length > 0) && recipeUrl.hash) {
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
  const rootUrl = canonicalizeRecipeRoot(recipe);
  return {
    entryUrl: entryUrl.href,
    rootUrl,
    featureCriteria,
    bootstrapCriteria,
  };
}

export function canonicalizeRecipeForDispatch(recipe) {
  const metadata = validateRecipeTargetMetadata(recipe);
  return {
    ...metadata,
    recipe: {
      ...recipe,
      url: metadata.rootUrl,
    },
  };
}

export function canonicalRecipeDigest(recipe) {
  const canonicalRecipe = {
    ...recipe,
    url: canonicalizeRecipeRoot(recipe),
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
