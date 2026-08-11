import { classifyGetProbeUrl } from "./discovery-safety.mjs";

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

const valueRequiredActionTypes = new Set([
  "click-contains",
  "click-href",
  "click-label",
  "navigate",
  "probe-get",
  "replay-seeded-links",
  "replay-seeded-routes",
  "wait-ms",
]);
const unsafeClickPattern =
  /(?:^|[\s/_-])(?:delete|execute|export|generate|invoke|log-?out|publish|remove|run|save|sign-?out|start|submit|sync|trigger)(?:$|[\s/_.?&=-])/iu;

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
  const entries = Array.isArray(actions)
    ? actions
    : actions === undefined || actions === null
      ? []
      : [actions];
  return entries.map(normalizeRecipeAction);
}

export function buildEffectiveRecipeActions(recipeActions, overrideActions = []) {
  return [
    ...normalizeRecipeActions(recipeActions),
    ...normalizeRecipeActions(overrideActions),
  ];
}

export function validateEffectiveRecipeActions(actions, baseUrl) {
  const normalizedActions = normalizeRecipeActions(actions);
  const root = new URL(baseUrl);
  normalizedActions.forEach((action, index) => {
    const value = String(action.value ?? "").trim();
    if (valueRequiredActionTypes.has(action.type) && !value) {
      throw new Error(`action ${index} (${action.type}) must include a non-empty value.`);
    }
    if (action.type.startsWith("click") && unsafeClickPattern.test(value)) {
      throw new Error(`click action ${index} matches an active-operation deny rule.`);
    }
    if (action.type !== "navigate") {
      return;
    }
    const classification = classifyGetProbeUrl(value, root.href);
    if (!classification.allowed) {
      throw new Error(`navigate action ${index} is not a safe same-origin GET (${classification.code}).`);
    }
    const resolved = new URL(value, root.href);
    if (resolved.protocol !== "https:" || resolved.username || resolved.password || resolved.search) {
      throw new Error(`navigate action ${index} must be an HTTPS URL without credentials, query, or fragment.`);
    }
    if (resolved.hash) {
      throw new Error(`navigate action ${index} must be an HTTPS URL without fragment.`);
    }
  });
  return normalizedActions;
}
