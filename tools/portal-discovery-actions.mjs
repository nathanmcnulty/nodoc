import { classifyGetProbeUrl } from "./discovery-safety.mjs";

export const supportedActionTypes = new Set([
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

const destructiveClickPattern =
  /(?:^|[\s/_-])(?:delete|execute|export|generate|invoke|log-?out|publish|remove|run|save|sign-?out|start|submit|sync|trigger)(?:$|[\s/_.?&=-])/iu;
const defaultSeedLinkLimit = 12;

function actionError(message, code = "invalid-action") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeScope(value) {
  const scope = String(value ?? "any").trim().toLowerCase();
  if (!["any", "root", "iframe"].includes(scope)) {
    throw actionError(`Unsupported action scope "${value}".`);
  }
  return scope;
}

export function normalizeActionType(value) {
  const rawType = String(value ?? "").trim().toLowerCase();
  if (!rawType) {
    throw actionError("Action type must be a non-empty string.");
  }
  const scopeMatch = rawType.match(/-(root|iframe)$/u);
  const scope = scopeMatch?.[1] ?? "any";
  const baseType = scopeMatch ? rawType.slice(0, -scopeMatch[0].length) : rawType;
  const type = baseType === "click" ? "click-label" : baseType;
  if (!supportedActionTypes.has(type)) {
    throw actionError(`Unsupported action type "${value}".`);
  }
  return { scope, type };
}

export function parseActionSpec(value, provenance = {}) {
  if (typeof value !== "string") {
    throw actionError("String action specifications must be strings.");
  }
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw actionError(`Invalid action value "${value}". Expected type=value.`);
  }
  const rawType = value.slice(0, separator).trim();
  const rawValue = value.slice(separator + 1);
  const normalized = normalizeActionType(rawType);
  const normalizedValue = rawValue.trim();
  if (normalized.type.startsWith("click") && isDestructiveClickValue(normalizedValue)) {
    throw actionError(
      "Click actions must contain a non-destructive, non-empty value.",
      "unsafe-click",
    );
  }
  return {
    ...provenance,
    raw: value,
    scope: normalized.scope,
    type: normalized.type,
    value: normalizedValue,
  };
}

export function normalizeRecipeAction(action, provenance = {}) {
  if (typeof action === "string") {
    return parseActionSpec(action, provenance);
  }
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw actionError("Recipe actions must be strings or objects.");
  }
  const normalized = normalizeActionType(action.type);
  const scope = action.scope === undefined ? normalized.scope : normalizeScope(action.scope);
  const value = String(action.value ?? "").trim();
  if (normalized.type.startsWith("click") && isDestructiveClickValue(value)) {
    throw actionError(
      "Click actions must contain a non-destructive, non-empty value.",
      "unsafe-click",
    );
  }
  return {
    ...provenance,
    raw: action,
    scope: scope === "any" ? normalized.scope : scope,
    type: normalized.type,
    value,
    highValue: action.highValue === true,
    optional: action.optional === true,
    required: Boolean(action.required),
  };
}

export function buildEffectiveActions({
  recipeActions = [],
  cliActions = [],
  includeInitialNavigation = false,
  initialUrl = null,
} = {}) {
  const recipe = (Array.isArray(recipeActions) ? recipeActions : [recipeActions])
    .filter((action) => action !== undefined && action !== null)
    .map((action, index) => normalizeRecipeAction(action, {
      source: "recipe",
      sourceIndex: index,
    }));
  const cli = (Array.isArray(cliActions) ? cliActions : [cliActions])
    .filter((action) => action !== undefined && action !== null)
    .map((action, index) => (
      typeof action === "string"
        ? parseActionSpec(action, { source: "cli", sourceIndex: index })
        : normalizeRecipeAction(action, { source: "cli", sourceIndex: index })
    ));
  const actions = [...recipe, ...cli];
  if (includeInitialNavigation) {
    if (!initialUrl) {
      throw actionError("An initial URL is required for the effective action stream.");
    }
    actions.unshift({
      source: "initial",
      sourceIndex: -1,
      raw: initialUrl,
      scope: "root",
      type: "navigate",
      value: String(initialUrl).trim(),
      required: true,
    });
  }
  return actions.map((action, index) => ({ ...action, effectiveIndex: index }));
}

function hostnameMatchesPattern(hostname, pattern) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  const normalizedPattern = String(pattern || "").trim().toLowerCase();
  if (!normalizedHostname || !normalizedPattern) return false;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHostname.length > suffix.length && normalizedHostname.endsWith(suffix);
  }
  return normalizedHostname === normalizedPattern;
}

function pathMatchesCriteria(pathname, prefixes) {
  return prefixes.length === 0 || prefixes.some((prefix) => {
    const normalized = String(prefix).trim().replace(/\/+$/u, "") || "/";
    return normalized === "/"
      ? pathname.startsWith("/")
      : pathname === normalized || pathname.startsWith(`${normalized}/`);
  });
}

function pathnameMatchesCriteria(pathname, pathnames) {
  return pathnames.length === 0 || pathnames.includes(pathname);
}

function isRelativeNavigationToken(value) {
  return !/^[a-z][a-z0-9+.-]*:/iu.test(value) && !value.startsWith("//");
}

function validateRelativeNavigationToken(value, rootUrl, label) {
  const token = String(value).trim();
  if (
    !token
    || token.includes("\\")
    || token.includes("?")
    || token.includes("#")
    || /(?:^|[/])\.\.(?:[/]|$)/u.test(token)
  ) {
    throw actionError(
      `${label} relative route contains a forbidden traversal, query, or fragment.`,
      "unsafe-navigation",
    );
  }
  if (/%(?![0-9a-f]{2})/iu.test(token)) {
    throw actionError(`${label} relative route contains malformed percent encoding.`, "unsafe-encoding");
  }
  let decoded = token;
  try {
    for (let pass = 0; pass < 8 && /%[0-9a-f]{2}/iu.test(decoded); pass += 1) {
      decoded = decodeURIComponent(decoded);
    }
  } catch {
    throw actionError(`${label} relative route contains unsafe URL encoding.`, "unsafe-encoding");
  }
  if (
    decoded.includes("\\")
    || decoded.includes("?")
    || decoded.includes("#")
    || decoded.includes("%")
    || /(?:^|[/])\.\.(?:[/]|$)/u.test(decoded)
  ) {
    throw actionError(
      `${label} relative route contains encoded traversal, query, or fragment.`,
      "unsafe-navigation",
    );
  }
  return resolveStrictNavigationUrl(token, rootUrl, { label });
}

function validateCanonicalPathSafety(rawValue, target, label) {
  const raw = String(rawValue ?? "");
  if (raw.includes("\\") || /(?:^|[/])\.\.(?:[/]|$)/u.test(raw)) {
    throw actionError(`${label} URL contains ambiguous path traversal.`, "unsafe-navigation");
  }
  if (target.pathname.normalize("NFKC") !== target.pathname) {
    throw actionError(`${label} URL contains ambiguous Unicode path characters.`, "unsafe-navigation");
  }
  let decoded = target.pathname;
  if (/%(?![0-9a-f]{2})/iu.test(target.pathname)) {
    throw actionError(`${label} URL contains malformed percent encoding.`, "unsafe-encoding");
  }
  try {
    for (let pass = 0; pass < 8 && /%[0-9a-f]{2}/iu.test(decoded); pass += 1) {
      decoded = decodeURIComponent(decoded);
    }
  } catch {
    throw actionError(`${label} URL contains malformed or unsafe percent encoding.`, "unsafe-encoding");
  }
  if (
    /(?:^|[/])\.\.(?:[/]|$)/u.test(decoded)
    || decoded.includes("%")
    || decoded.includes("//")
    || decoded.includes("\\")
    || decoded.includes("?")
    || decoded.includes("#")
    || /%(?:25)*2f|%(?:25)*5c|%(?:25)*3f|%(?:25)*23/iu.test(target.pathname)
    || /%(?:25)*2e/iu.test(target.pathname)
    || decoded.normalize("NFKC") !== decoded
  ) {
    throw actionError(`${label} URL contains an ownership-ambiguous encoded path.`, "unsafe-navigation");
  }
}

export function normalizeTargetCriteria(criteria = null) {
  return {
    matchHosts: Array.isArray(criteria?.matchHosts)
      ? criteria.matchHosts.map((value) => String(value).trim()).filter(Boolean)
      : [],
    matchPathPrefixes: Array.isArray(criteria?.matchPathPrefixes)
      ? criteria.matchPathPrefixes.map((value) => String(value).trim()).filter(Boolean)
      : [],
    matchPathnames: Array.isArray(criteria?.matchPathnames)
      ? criteria.matchPathnames.map((value) => String(value).trim()).filter(Boolean)
      : [],
  };
}

export function resolveStrictNavigationUrl(value, rootUrl, {
  criteria = null,
  label = "navigation",
} = {}) {
  let base;
  let target;
  try {
    base = new URL(String(rootUrl).trim());
    target = new URL(String(value).trim(), base);
  } catch {
    throw actionError(`${label} URL is invalid.`, "unsafe-navigation");
  }
  validateCanonicalPathSafety(value, target, label);
  if (
    base.protocol !== "https:"
    || base.username
    || base.password
    || base.search
    || base.hash
    || target.protocol !== "https:"
    || target.username
    || target.password
    || target.search
    || target.hash
    || target.origin !== base.origin
  ) {
    throw actionError(
      `${label} URL must be an HTTPS URL without credentials, query, or fragment and must remain same-origin.`,
      "unsafe-navigation",
    );
  }
  const classification = classifyGetProbeUrl(target.href, base.href);
  if (!classification.allowed) {
    throw actionError(
      `${label} URL is rejected by active-GET safety (${classification.code}).`,
      classification.code,
    );
  }
  const normalizedCriteria = normalizeTargetCriteria(criteria);
  if (
    (normalizedCriteria.matchHosts.length > 0
      && !normalizedCriteria.matchHosts.some((pattern) => hostnameMatchesPattern(target.hostname, pattern)))
    || !pathMatchesCriteria(target.pathname, normalizedCriteria.matchPathPrefixes)
    || !pathnameMatchesCriteria(target.pathname, normalizedCriteria.matchPathnames)
  ) {
    throw actionError(`${label} URL does not match the applicable page-target criteria.`, "page-target-mismatch");
  }
  return target.href;
}

export function validatePostNavigationUrl(value, rootUrl, options = {}) {
  return resolveStrictNavigationUrl(value, rootUrl, {
    ...options,
    label: options.label ?? "final page",
  });
}

export function isDestructiveClickValue(value) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return !normalized || destructiveClickPattern.test(normalized);
}

export function validateEffectiveActions(actions, {
  rootUrl,
  pageTarget = null,
  bootstrapTarget = null,
  enforcePageTargetForAll = false,
} = {}) {
  if (!rootUrl) {
    throw actionError("An initial root URL is required for action validation.", "unsafe-navigation");
  }
  let featureNavigationValidated = false;
  return actions.map((action) => {
    const normalized = normalizeRecipeAction(action, {
      source: action?.source ?? "unknown",
      sourceIndex: action?.sourceIndex ?? null,
      effectiveIndex: action?.effectiveIndex ?? null,
    });
    if (normalized.type === "navigate") {
      const criteria = normalized.source === "initial"
        ? (bootstrapTarget ?? pageTarget)
        : (enforcePageTargetForAll || !featureNavigationValidated ? pageTarget : null);
      normalized.relative = normalized.source !== "initial"
        && isRelativeNavigationToken(normalized.value);
      const staticRelativeUrl = normalized.relative
        ? validateRelativeNavigationToken(normalized.value, rootUrl, `${normalized.source} navigation`)
        : null;
      normalized.resolvedUrl = normalized.relative
        ? (normalized.value.startsWith("/")
          ? resolveStrictNavigationUrl(staticRelativeUrl, rootUrl, {
            criteria,
            label: `${normalized.source} navigation`,
          })
          : staticRelativeUrl)
        : resolveStrictNavigationUrl(normalized.value, rootUrl, {
          criteria,
          label: `${normalized.source} navigation`,
        });
      normalized.pageTargetApplicable = Boolean(criteria);
      if (normalized.source !== "initial" && pageTarget) {
        featureNavigationValidated = true;
      }
    } else if (normalized.type === "click-href") {
      if (!normalized.value) {
        throw actionError(
          `${normalized.source} click-href must contain a non-empty value.`,
          "unsafe-click",
        );
      }
      normalized.resolvedUrl = resolveStrictNavigationUrl(normalized.value, rootUrl, {
        criteria: pageTarget,
        label: `${normalized.source} click-href`,
      });
    } else if (normalized.type.startsWith("click")) {
      if (isDestructiveClickValue(normalized.value)) {
        throw actionError(
          `${normalized.source} click action must contain a non-destructive, non-empty value.`,
          "unsafe-click",
        );
      }
    }
    return normalized;
  });
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw actionError(`${label} must be a non-negative integer.`, "unbounded-replay");
  }
  return value;
}

export function estimateReplayExpansion(actions, recipe = {}) {
  let expandedReplayActions = 0;
  for (const action of actions) {
    if (action.type === "replay-seeded-links" || action.type === "crawl-links") {
      const limit = recipe.seedLinkLimit ?? defaultSeedLinkLimit;
      if (!Number.isInteger(limit) || limit <= 0) {
        throw actionError(`Replay action "${action.type}" requires a bounded positive seedLinkLimit.`, "unbounded-replay");
      }
      expandedReplayActions += limit;
    } else if (action.type === "replay-seeded-routes") {
      const group = recipe.seedRouteGroups?.[action.value];
      const limit = group?.limit;
      if (!Number.isInteger(limit) || limit <= 0) {
        throw actionError(
          `Replay route group "${action.value}" requires a bounded positive limit.`,
          "unbounded-replay",
        );
      }
      expandedReplayActions += limit;
    }
  }
  return expandedReplayActions;
}

export function validateSelectedReplayRouteTemplates(groups, actions, {
  rootUrl,
  criteria = null,
} = {}) {
  const selectedGroups = new Set(
    actions
      .filter((action) => action.type === "replay-seeded-routes")
      .map((action) => String(action.value).trim()),
  );
  for (const groupName of selectedGroups) {
    const group = groups?.[groupName];
    if (!group || !Array.isArray(group.routeTemplates) || group.routeTemplates.length === 0) {
      throw actionError(
        `Replay route group "${groupName}" must declare at least one route template.`,
        "invalid-replay-template",
      );
    }
    for (const routeTemplate of group.routeTemplates) {
      if (typeof routeTemplate !== "string" || !routeTemplate.trim()) {
        throw actionError(
          `Replay route group "${groupName}" contains an invalid route template.`,
          "invalid-replay-template",
        );
      }
      const placeholders = [...routeTemplate.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]);
      if (placeholders.some((placeholder) => !["encoded", "id", "value"].includes(placeholder))) {
        throw actionError(
          `Replay route group "${groupName}" contains an unsupported route placeholder.`,
          "invalid-replay-template",
        );
      }
      resolveStrictNavigationUrl(routeTemplate, rootUrl, {
        criteria,
        label: `seedRouteGroups.${groupName}`,
      });
    }
  }
}
