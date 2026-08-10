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
