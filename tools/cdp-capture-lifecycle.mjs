import { activeGetPathPattern, activeGetQueryPattern } from "./discovery-safety.mjs";

const safeMethods = new Set(["GET", "HEAD"]);
const safeResourceTypes = new Set([
  "Document",
  "Fetch",
  "Font",
  "Image",
  "Manifest",
  "Media",
  "Other",
  "Script",
  "Stylesheet",
  "XHR",
]);
const statefulResourceTypes = new Set(["EventSource", "Ping", "WebSocket"]);

export class CaptureLifecycleError extends Error {
  constructor(code, message) {
    super(`cdp-capture-lifecycle: ${message}`);
    this.name = "CaptureLifecycleError";
    this.code = code;
  }
}

function hostnameMatches(hostname, pattern) {
  const normalized = String(pattern ?? "").trim().toLowerCase();
  if (normalized.startsWith("*.")) {
    const suffix = normalized.slice(1);
    return hostname.length > suffix.length && hostname.endsWith(suffix);
  }
  return hostname === normalized;
}

function decode(value) {
  let decoded = value;
  for (let pass = 0; pass < 3 && decoded.includes("%"); pass += 1) {
    decoded = decodeURIComponent(decoded);
  }
  return decoded;
}

function activeDestination(url) {
  let path;
  let hash;
  try {
    path = decode(url.pathname);
    hash = decode(url.hash);
  } catch {
    return true;
  }
  return Boolean(
    url.hash
    || activeGetPathPattern.test(path)
    || activeGetPathPattern.test(hash.replace(/^#/u, "/"))
    || activeGetQueryPattern.test(url.search)
    || activeGetQueryPattern.test(hash),
  );
}

export function classifyCaptureRequest({
  documentUrl,
  request,
  resourceType,
  authorizedHosts = [],
} = {}) {
  let owner;
  let destination;
  try {
    owner = new URL(documentUrl);
    destination = new URL(request?.url);
  } catch {
    return { allowed: false, code: "invalid-request-url" };
  }
  if (owner.hash || destination.hash) return { allowed: false, code: "fragment-denied" };
  if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) {
    return { allowed: false, code: "unsupported-destination" };
  }
  const method = String(request?.method ?? "").toUpperCase();
  if (!safeMethods.has(method)) return { allowed: false, code: "unsafe-method" };
  if (statefulResourceTypes.has(resourceType)) return { allowed: false, code: "stateful-resource-type" };
  if (!safeResourceTypes.has(resourceType)) return { allowed: false, code: "unsupported-resource-type" };
  if (activeDestination(destination)) return { allowed: false, code: "active-destination" };

  const sameOrigin = destination.origin === owner.origin;
  if (resourceType === "Document" && !sameOrigin) {
    return { allowed: false, code: "document-ownership-escape" };
  }
  if (!sameOrigin && !authorizedHosts.some((pattern) => hostnameMatches(destination.hostname.toLowerCase(), pattern))) {
    return { allowed: false, code: "request-not-authorized" };
  }
  return { allowed: true, code: "allowed" };
}

export class DisposableCaptureLifecycle {
  constructor({ client, documentUrl, authorizedHosts = [], timeoutMs = 30000 } = {}) {
    this.client = client;
    this.documentUrl = documentUrl;
    this.authorizedHosts = authorizedHosts;
    this.timeoutMs = timeoutMs;
    this.phase = "active";
    this.invalidError = null;
    this.fetchRequests = new Map();
    this.pending = new Set();
  }

  invalidate(code, message) {
    this.invalidError ??= new CaptureLifecycleError(code, message);
    return this.invalidError;
  }

  observeEvent(kind) {
    if (this.phase === "closing" || this.phase === "frozen") {
      this.invalidate("late-lifecycle-event", `${kind} arrived during terminal drain.`);
    }
  }

  assertValid() {
    if (this.invalidError) throw this.invalidError;
  }

  async enableSession(sessionId = null) {
    this.assertValid();
    await this.client.send("Fetch.enable", {
      patterns: [{ requestStage: "Request", urlPattern: "*" }],
    }, sessionId);
  }

  handlePaused(params, sessionId = null) {
    const handler = this.#resolvePaused(params, sessionId);
    this.pending.add(handler);
    handler.finally(() => this.pending.delete(handler)).catch(() => {});
    return handler;
  }

  async #resolvePaused(params, sessionId) {
    const key = `${sessionId ?? "root"}:${params.requestId}`;
    if (this.fetchRequests.has(key)) {
      throw this.invalidate("duplicate-fetch-request", `Fetch request ${key} was paused more than once.`);
    }
    const state = { disposition: null, status: "pending" };
    this.fetchRequests.set(key, state);
    const decision = this.phase === "active"
      ? classifyCaptureRequest({
          authorizedHosts: this.authorizedHosts,
          documentUrl: this.documentUrl,
          request: params.request,
          resourceType: params.resourceType,
        })
      : { allowed: false, code: "terminal-phase" };
    const disposition = decision.allowed ? "Fetch.continueRequest" : "Fetch.failRequest";
    state.status = "dispatching";
    try {
      await this.client.send(disposition, disposition === "Fetch.continueRequest"
        ? { requestId: params.requestId }
        : { errorReason: "BlockedByClient", requestId: params.requestId }, sessionId);
      state.disposition = disposition;
      state.status = "acknowledged";
    } catch (error) {
      state.status = "terminal-failure";
      throw this.invalidate(
        "fetch-disposition-unacknowledged",
        `${disposition} was not acknowledged for ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!decision.allowed && decision.code === "terminal-phase") {
      throw this.invalidate("late-fetch-request", `Fetch request ${key} arrived during terminal drain.`);
    }
    return { ...state, decision };
  }

  async drain() {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(this.invalidate("lifecycle-drain-timeout", "Capture lifecycle drain timed out.")), this.timeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([Promise.allSettled(Array.from(this.pending)), deadline]);
    } finally {
      clearTimeout(timer);
    }
    await this.client.awaitEventHandlers?.();
    this.assertValid();
    for (const [key, state] of this.fetchRequests) {
      if (state.status !== "acknowledged" || !state.disposition) {
        throw this.invalidate("fetch-request-unresolved", `Fetch request ${key} did not reach acknowledged resolution.`);
      }
    }
  }

  async finalize({ quiesce, flush, disconnect } = {}) {
    this.phase = "closing";
    await this.drain();
    const settled = await quiesce();
    if (!settled?.settled) throw this.invalidate("network-not-quiescent", "Network did not reach bounded quiescence.");
    await this.drain();
    await flush();
    await this.drain();
    this.phase = "frozen";
    this.assertValid();
    await disconnect();
    await this.client.awaitEventHandlers?.();
    this.assertValid();
  }
}
