import { createHash } from "node:crypto";

export const captureArtifactSchemaVersion = 2;

function sessionKey(sessionId) {
  return sessionId ?? "root";
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function buildStableEvidenceId(kind, inputs) {
  const digest = createHash("sha256")
    .update(stableJson({ kind, ...inputs }))
    .digest("hex");
  return `${kind}-${digest.slice(0, 20)}`;
}

export function normalizeAttributionUrl(value) {
  return normalizeUrl(value);
}

export class CdpAttributionRegistry {
  constructor(rootTarget, initialContext) {
    this.sessions = new Map();
    this.pageContexts = new Map();
    this.loaderContexts = new Map();
    this.rootContext = { ...initialContext };
    this.registerSession(null, {
      targetId: rootTarget?.id ?? null,
      targetTitle: rootTarget?.title ?? null,
      targetType: "page",
      targetUrl: rootTarget?.url ?? null,
    });
    this.setRootContext(initialContext);
  }

  registerSession(sessionId, targetInfo = {}, parentSessionId = null) {
    const inheritedContext = this.sessions.get(parentSessionId)?.context ?? this.rootContext;
    const entry = {
      attached: true,
      context: { ...inheritedContext },
      frameId: null,
      loaderId: null,
      frameUrl: targetInfo.url ?? null,
      parentFrameId: targetInfo.parentFrameId ?? targetInfo.openerFrameId ?? null,
      parentSessionId,
      targetId: targetInfo.targetId ?? targetInfo.id ?? null,
      targetTitle: targetInfo.title ?? null,
      targetType: targetInfo.type ?? "page",
      targetUrl: targetInfo.url ?? null,
    };
    this.sessions.set(sessionId, entry);
    return entry;
  }

  markDetached(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.attached = false;
    }
  }

  updateTarget(sessionId, targetInfo = {}) {
    const entry = this.sessions.get(sessionId)
      ?? Array.from(this.sessions.values()).find((candidate) => candidate.targetId === targetInfo.targetId);
    if (!entry) {
      return;
    }
    entry.targetId = targetInfo.targetId ?? entry.targetId;
    entry.targetTitle = targetInfo.title ?? entry.targetTitle;
    entry.targetType = targetInfo.type ?? entry.targetType;
    entry.targetUrl = targetInfo.url ?? entry.targetUrl;
    entry.frameUrl = targetInfo.url ?? entry.frameUrl;
  }

  setRootContext(context) {
    this.rootContext = { ...context };
    const root = this.sessions.get(null);
    if (root) {
      root.context = { ...this.rootContext };
    }
    const normalizedUrl = normalizeUrl(context?.pageUrl);
    if (normalizedUrl) {
      this.pageContexts.set(normalizedUrl, { ...context });
    }
  }

  setSessionContext(sessionId, context) {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.context = { ...context };
    }
  }

  recordFrameAttached(sessionId, frameId, parentFrameId) {
    const entry = this.sessions.get(sessionId);
    if (!entry || !frameId) {
      return;
    }
    entry.frameId = frameId;
    entry.parentFrameId = parentFrameId ?? entry.parentFrameId;
  }

  recordFrameNavigated(sessionId, frame) {
    const entry = this.sessions.get(sessionId);
    if (!entry || !frame?.id) {
      return;
    }
    entry.frameId = frame.id;
    entry.loaderId = frame.loaderId ?? entry.loaderId;
    entry.parentFrameId = frame.parentId ?? entry.parentFrameId;
    entry.frameUrl = frame.url ?? entry.frameUrl;
    if (frame.url) {
      entry.context = { ...entry.context };
      this.pageContexts.set(normalizeUrl(frame.url), { ...entry.context });
    }
    if (frame.loaderId) {
      this.loaderContexts.set(frame.loaderId, { ...entry.context });
    }
  }

  resolve({ sessionId = null, frameId = null, loaderId = null, documentURL = null, targetUrl = null } = {}) {
    const entry = this.sessions.get(sessionId) ?? this.sessions.get(null);
    const loaderContext = loaderId ? this.loaderContexts.get(loaderId) : null;
    const documentContext = documentURL
      ? this.pageContexts.get(normalizeUrl(documentURL))
      : null;
    const context = loaderContext ?? documentContext ?? entry?.context ?? this.rootContext;
    return {
      actionIndex: context.actionIndex ?? null,
      attempt: context.attempt ?? 0,
      checkpoint: context.checkpoint ?? context.pageLabel ?? null,
      documentURL: documentURL ?? null,
      frameId: frameId ?? entry?.frameId ?? null,
      frameUrl: entry?.frameUrl ?? targetUrl ?? null,
      loaderId: loaderId ?? entry?.loaderId ?? null,
      pageLabel: context.pageLabel ?? "seed-00",
      parentFrameId: entry?.parentFrameId ?? null,
      parentSessionId: entry?.parentSessionId ?? null,
      sessionId,
      targetId: entry?.targetId ?? null,
      targetTitle: entry?.targetTitle ?? null,
      targetType: entry?.targetType ?? "page",
      targetUrl: entry?.targetUrl ?? targetUrl ?? null,
    };
  }

  snapshot() {
    return Array.from(this.sessions.entries())
      .sort(([left], [right]) => sessionKey(left).localeCompare(sessionKey(right)))
      .map(([sessionId, entry]) => ({
        attached: entry.attached,
        frameId: entry.frameId,
        frameUrl: entry.frameUrl,
        loaderId: entry.loaderId,
        parentFrameId: entry.parentFrameId,
        parentSessionId: entry.parentSessionId,
        sessionId: sessionId ?? "root",
        targetId: entry.targetId,
        targetTitle: entry.targetTitle,
        targetType: entry.targetType,
        targetUrl: entry.targetUrl,
        ...entry.context,
      }));
  }
}
