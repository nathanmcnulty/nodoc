import { classifyGetProbeUrl } from "./discovery-safety.mjs";

function actionTypeAndValue(action) {
  if (typeof action === "string") {
    const separator = action.indexOf("=");
    return separator > 0
      ? { type: action.slice(0, separator).replace(/-(root|iframe)$/u, ""), value: action.slice(separator + 1) }
      : { type: action.replace(/-(root|iframe)$/u, ""), value: "" };
  }

  if (action && typeof action === "object") {
    return { type: String(action.type || ""), value: String(action.value ?? "") };
  }

  return { type: "", value: "" };
}

export function getRecipeEntryUrl(recipe) {
  const firstNavigate = (recipe?.actions ?? [])
    .map(actionTypeAndValue)
    .find((action) => action.type === "navigate" && action.value);
  return firstNavigate?.value || recipe?.url || "";
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
  const entryUrlValue = getRecipeEntryUrl(recipe);
  let entryUrl;
  let recipeUrl;
  try {
    entryUrl = new URL(entryUrlValue);
    recipeUrl = new URL(recipe?.url);
  } catch {
    throw new Error("recipe entry and declared root URLs must be valid URLs.");
  }
  if (entryUrl.protocol !== "https:" || entryUrl.username || entryUrl.password || entryUrl.search || entryUrl.hash) {
    throw new Error("recipe entry URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  const classification = classifyGetProbeUrl(entryUrl.href, recipeUrl.href);
  if (!classification.allowed) {
    throw new Error(`recipe entry URL is not a safe same-origin GET (${classification.code}).`);
  }
  const featureCriteria = resolvePageTargetCriteria(recipe);
  if (!recipeEntryMatchesPageTarget(recipe)) {
    throw new Error("recipe entry URL does not match pageTarget host/path criteria.");
  }
  const bootstrapCriteria = resolvePageTargetBootstrapCriteria(recipe);
  if (bootstrapCriteria && (
    !bootstrapCriteria.matchHosts.includes(recipeUrl.hostname.toLowerCase())
    || !bootstrapCriteria.matchPathnames.includes(recipeUrl.pathname)
  )) {
    throw new Error("declared root URL does not match pageTarget.bootstrap host/path criteria.");
  }
  return {
    entryUrl: entryUrl.href,
    featureCriteria,
    bootstrapCriteria,
  };
}

export function recipeEntryMatchesPageTarget(recipe) {
  let entryUrl;
  try {
    entryUrl = new URL(getRecipeEntryUrl(recipe));
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
