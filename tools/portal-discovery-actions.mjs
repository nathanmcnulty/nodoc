export function parseActionSpec(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --action value "${value}". Expected type=value.`);
  }

  const rawType = value.slice(0, separator).trim();
  const rawValue = value.slice(separator + 1);
  const normalizedType = rawType.replace(/-(root|iframe)$/u, "");
  const scope = rawType.endsWith("-root")
    ? "root"
    : rawType.endsWith("-iframe")
      ? "iframe"
      : "any";

  const type = normalizedType === "click" ? "click-label" : normalizedType;
  if (![
    "capture",
    "click-contains",
    "click-automation-id",
    "click-href",
    "click-label",
    "crawl-links",
    "navigate",
    "probe-get",
    "reload",
    "replay-seeded-links",
    "replay-seeded-routes",
    "wait-ms",
  ].includes(type)) {
    throw new Error(`Unsupported action type "${rawType}".`);
  }

  return {
    raw: value,
    scope,
    type,
    value: rawValue,
  };
}

export function normalizeRecipeAction(action) {
  if (typeof action === "string") {
    return parseActionSpec(action);
  }

  if (!action || typeof action !== "object") {
    throw new Error("Recipe actions must be strings or objects.");
  }

  const rawType = String(action.type || "").trim();
  if (!rawType) {
    throw new Error("Recipe action objects must include a type.");
  }

  const scopedType =
    action.scope && action.scope !== "any"
      ? `${rawType}-${String(action.scope).trim()}`
      : rawType;
  return {
    ...parseActionSpec(`${scopedType}=${action.value ?? ""}`),
    highValue: action.highValue === true,
    optional: action.optional === true,
    required: Boolean(action.required),
  };
}

export function validateInspectionActions(actions, policy, ceiling = "observe-only", activeOperationPlan = null) {
  if (policy?.mode !== "observe-only") return;
  if (ceiling !== "observe-only" || activeOperationPlan) {
    throw new Error("Observe-only inspection recipes cannot authorize active operations.");
  }
  const allowed = new Set(["capture", "navigate", "reload", "wait-ms"]);
  if (actions.some((action) => !allowed.has(action.type))) {
    throw new Error("Observe-only inspection recipes may use only navigate, reload, wait-ms, and capture actions.");
  }
}

// Private capture provenance: retain exact observed routes including plain SPA fragments.
// URLs containing query values or fragment parameters are omitted.
// These descriptors are evidence, not automatically authorized actions.
export function navigationDescriptors(snapshots) {
  return snapshots.flatMap((snapshot) => (snapshot.controls ?? []).map((control) => {
    let href = null;
    let host = null;
    let pathname = null;
    try {
      if (control.href) {
        const url = new URL(control.href, snapshot.url);
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
          host = url.host;
          pathname = url.pathname;
          if (!url.search && !/[?=&]/u.test(url.hash)) href = url.href;
        }
      }
    } catch { /* Non-URL hrefs are not navigation candidates. */ }
    return {
      label: control.text || control.ariaLabel || control.automationId || null,
      href,
      host,
      pathname,
      role: control.role || null,
      tag: control.tag || null,
      automationId: control.automationId || null,
      visible: control.visible === true ? true : null,
      enabled: typeof control.enabled === "boolean" ? control.enabled : null,
      sessionId: snapshot.sessionId ?? null,
      targetId: snapshot.targetId ?? null,
      parentFrameId: snapshot.parentFrameId ?? null,
      source: "dom-snapshot",
    };
  }));
}

// Per-navigation private observations; no event is treated as action success.
export function createNavigationObservation(rootFrameId) {
  let response = null;
  let responseStatus = "pending";
  const events = [];
  return {
    recordResponse(value) {
      responseStatus = value ? "received" : "failed";
      response = value ? { frameId: value.frameId ?? null, loaderId: value.loaderId ?? null, errorText: value.errorText ?? null } : null;
    },
    recordEvent(params, metadata) {
      events.push({
        frameId: params.frameId ?? null,
        navigationType: params.navigationType ?? null,
        attribution: metadata.sessionId ? "child-session" : !rootFrameId || !params.frameId ? "unknown" : params.frameId === rootFrameId ? "root-frame" : "child-frame",
      });
    },
    snapshot() {
      return { navigateResponse: response && { ...response }, navigateResponseStatus: responseStatus, navigatedWithinDocument: events.map((event) => ({ ...event })) };
    },
  };
}
