import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { classifyGetProbeUrl } from "./discovery-safety.mjs";

const defaultTimeoutMs = 3000;
const defaultStabilityMs = 750;
const defaultPollMs = 150;
const defaultRejectUrlPattern = /(?:^|\/)login(?:[\/?#]|$)|signin|sign-in/iu;
const defaultRejectTitlePattern = /sign in|log in|authentication required/iu;
const productFamilyAliases = new Map([
  ["edge", "edge"],
  ["edg", "edge"],
  ["microsoft edge", "edge"],
  ["chrome", "chrome"],
  ["google chrome", "chrome"],
]);
const defaultRejectBodyPattern = /sign in|log in|authentication required/iu;

export class BrowserCdpPreflightError extends Error {
  constructor(code, message, details = {}) {
    super(`browser-cdp-preflight: ${message}`);
    this.name = "BrowserCdpPreflightError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message) {
  throw new BrowserCdpPreflightError("preflight-failed", message);
}

function failWith(code, message, details = {}) {
  throw new BrowserCdpPreflightError(code, message, details);
}

function matchesConfiguredPattern(value, pattern) {
  return pattern instanceof RegExp
    ? pattern.test(String(value))
    : String(value).toLocaleLowerCase().includes(String(pattern).toLocaleLowerCase());
}

export function normalizeProductFamily(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const productToken = normalized.split("/", 1)[0].trim();
  return productFamilyAliases.get(productToken) ?? null;
}

export function matchesExpectedProduct(browser, expectedProduct) {
  const expectedFamily = normalizeProductFamily(expectedProduct);
  return expectedFamily !== null && normalizeProductFamily(browser) === expectedFamily;
}

function loopbackEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("endpoint must be a valid URL.");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    fail("endpoint must be an HTTP loopback URL.");
  }
  url.username = "";
  url.password = "";
  url.pathname = url.pathname.replace(/\/$/u, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function getJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) fail(`${url.pathname} returned HTTP ${response.status}.`);
  return response.json();
}

function targetMatches(target, criteria) {
  if (target?.type !== "page" || typeof target.url !== "string" || typeof target.id !== "string") return false;
  let url;
  try { url = new URL(target.url); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (criteria.targetId && target.id !== criteria.targetId) return false;
  const hosts = criteria.matchHosts ?? [];
  const prefixes = criteria.matchPathPrefixes ?? [];
  if (hosts.length > 0 && !hosts.includes(url.hostname.toLowerCase())) return false;
  if (prefixes.length > 0 && !prefixes.some((prefix) => url.pathname.startsWith(prefix))) return false;
  const pathnames = criteria.matchPathnames ?? [];
  if (pathnames.length > 0 && !pathnames.includes(url.pathname)) return false;
  if (criteria.urlPattern && !matchesConfiguredPattern(target.url, criteria.urlPattern)) return false;
  if (criteria.titlePattern && !matchesConfiguredPattern(String(target.title ?? ""), criteria.titlePattern)) return false;
  return true;
}

function targetIdentity(target) {
  return { id: target.id, url: target.url, title: String(target.title ?? ""), webSocketDebuggerUrl: target.webSocketDebuggerUrl };
}

function authenticationFailure(identity, evaluation, criteria) {
  const url = new URL(identity.url);
  const authHosts = criteria.authenticationHosts ?? ["login.live.com", "login.microsoft.com", "login.microsoftonline.com", "login.windows.net"];
  if (authHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return "target is on an authentication host";
  if (criteria.rejectUrlPattern && matchesConfiguredPattern(identity.url, criteria.rejectUrlPattern)) return "target URL matches the authentication rejection pattern";
  if (criteria.expectedTitlePattern && !matchesConfiguredPattern(evaluation.title, criteria.expectedTitlePattern)) return "target title does not meet the authenticated expectation";
  if (criteria.rejectBodyPattern && matchesConfiguredPattern(evaluation.bodyText, criteria.rejectBodyPattern)) return "target body indicates a login barrier";
  return null;
}

function sendCdpCommand(webSocketUrl, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket connection timed out.")); }, timeoutMs);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => {
      const id = nextId++;
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        reject(new Error("CDP returned invalid JSON."));
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      socket.close();
      if (message.error) reject(new Error(`CDP ${method} failed.`));
      else resolve(message.result ?? null);
    });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")));
  });
}

function connectAndEvaluate(webSocketUrl, timeoutMs) {
  return sendCdpCommand(webSocketUrl, "Runtime.evaluate", {
    expression: "({ title: document.title, url: location.href, bodyText: document.body?.innerText?.slice(0, 2000) ?? '' })",
    returnByValue: true,
  }, timeoutMs).then((result) => {
    if (result?.exceptionDetails) throw new Error("Runtime.evaluate failed.");
    return result?.result?.value ?? null;
  });
}

export async function runBrowserCdpPreflight({
  endpoint = "http://127.0.0.1:9222",
  expectedProduct = null,
  matchHosts = [],
  matchPathPrefixes = [],
  matchPathnames = [],
  targetId = null,
  urlPattern = null,
  titlePattern = null,
  expectedTitlePattern = null,
  rejectBodyPattern = defaultRejectBodyPattern,
  rejectUrlPattern = defaultRejectUrlPattern,
  authenticationHosts,
  stabilityMs = defaultStabilityMs,
  pollMs = defaultPollMs,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  const base = loopbackEndpoint(endpoint);
  const version = await getJson(new URL("/json/version", base), timeoutMs);
  if (expectedProduct && !matchesExpectedProduct(version.Browser, expectedProduct)) fail(`browser product is not ${expectedProduct}.`);
  if (typeof version.webSocketDebuggerUrl !== "string" || !version.webSocketDebuggerUrl.startsWith("ws")) fail("browser WebSocket URL is missing.");
  const criteria = {
    matchHosts: matchHosts.map((host) => host.toLowerCase()),
    matchPathPrefixes,
    matchPathnames,
    targetId,
    urlPattern,
    titlePattern,
    expectedTitlePattern,
    rejectBodyPattern,
    rejectUrlPattern,
    authenticationHosts,
  };
  const list = async () => {
    const targets = await getJson(new URL("/json/list", base), timeoutMs);
    const matches = targets.filter((target) => targetMatches(target, criteria));
    if (matches.length !== 1) {
      failWith("target-count", `expected exactly one matching page target, found ${matches.length}.`, {
        targetCount: matches.length,
      });
    }
    const identity = targetIdentity(matches[0]);
    if (!identity.webSocketDebuggerUrl) fail("matching target WebSocket URL is missing.");
    const evaluation = await connectAndEvaluate(identity.webSocketDebuggerUrl, timeoutMs);
    if (!evaluation || typeof evaluation !== "object") fail("Runtime.evaluate returned no page state.");
    const authFailure = authenticationFailure(identity, evaluation, criteria);
    if (authFailure) fail(authFailure);
    return { identity, evaluation };
  };
  const first = await list();
  const deadline = Date.now() + stabilityMs;
  let latest = first;
  while (Date.now() < deadline) {
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    latest = await list();
    if (JSON.stringify(latest.identity) !== JSON.stringify(first.identity)) fail("target identity changed during stability interval.");
  }
  return {
    browser: String(version.Browser),
    protocolVersion: String(version.Protocol ?? ""),
    browserWebSocketDebuggerUrl: version.webSocketDebuggerUrl,
    authenticationStatus: "verified",
    portalTargetStatus: "authenticated-portal-ready",
    target: latest.identity,
    evaluation: { title: latest.evaluation.title, url: latest.evaluation.url },
  };
}

function trustedEntryUrl(entryUrl, featureCriteria, bootstrapCriteria) {
  let parsed;
  try {
    parsed = new URL(entryUrl);
  } catch {
    failWith("entry-url-invalid", "recipe entry URL must be a valid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search) {
    failWith("entry-url-untrusted", "recipe entry URL must be HTTPS without credentials or query.");
  }
  const classification = classifyGetProbeUrl(parsed.href, parsed.origin);
  if (!classification.allowed) {
    failWith("entry-url-untrusted", `recipe entry URL is not a passive same-origin GET (${classification.code}).`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const featureHosts = featureCriteria?.matchHosts ?? [];
  const bootstrapHosts = bootstrapCriteria?.matchHosts ?? [];
  if (
    featureHosts.length === 0
    || bootstrapHosts.length === 0
    || !featureHosts.includes(hostname)
    || !bootstrapHosts.includes(hostname)
  ) {
    failWith("entry-url-untrusted", "recipe entry URL host is not owned by both the feature and bootstrap target criteria.");
  }
  const featurePrefixes = featureCriteria.matchPathPrefixes ?? [];
  const featurePathnames = featureCriteria.matchPathnames ?? [];
  if (
    (featurePrefixes.length > 0 && !featurePrefixes.some((prefix) => parsed.pathname.startsWith(prefix)))
    || (featurePathnames.length > 0 && !featurePathnames.includes(parsed.pathname))
  ) {
    failWith("entry-url-untrusted", "recipe entry URL path is outside the feature target criteria.");
  }
  return parsed.href;
}

async function navigateExactTarget(target, entryUrl, timeoutMs) {
  if (!target?.id || !target.webSocketDebuggerUrl) {
    failWith("target-invalid", "the selected bootstrap target does not have a stable CDP identity.");
  }
  let result;
  try {
    result = await sendCdpCommand(
      target.webSocketDebuggerUrl,
      "Page.navigate",
      { url: entryUrl },
      timeoutMs,
    );
  } catch (error) {
    failWith("navigation-failed", error instanceof Error ? error.message : String(error));
  }
  if (result?.errorText) {
    failWith("navigation-failed", `Page.navigate failed: ${result.errorText}.`);
  }
}

async function waitForAlignedTarget({ endpoint, expectedProduct, featureCriteria, targetId, stabilityMs, pollMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let readinessState = "target-missing";
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const base = loopbackEndpoint(endpoint);
    try {
      const targets = await getJson(new URL("/json/list", base), remainingMs);
      const exactTarget = targets.find((target) => target?.type === "page" && target.id === targetId);
      if (exactTarget && targetMatches(exactTarget, { ...featureCriteria, targetId })) {
        return await runBrowserCdpPreflight({ endpoint, expectedProduct, ...featureCriteria, targetId, stabilityMs, pollMs, timeoutMs: remainingMs });
      }
      readinessState = exactTarget ? "target-transitioning" : "target-missing";
    } catch (error) {
      if (["AbortError", "TimeoutError"].includes(error?.name)) break;
      throw error;
    }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  failWith("navigation-readiness-timeout", `target ${targetId} did not reach feature URL readiness before timeout (state: ${readinessState}).`, {
    targetId,
    readinessState,
  });
}

export async function alignBrowserCdpTarget({
  entryUrl,
  featureCriteria,
  bootstrapCriteria,
  endpoint = "http://127.0.0.1:9222",
  expectedProduct = null,
  stabilityMs = defaultStabilityMs,
  pollMs = defaultPollMs,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  let featurePreflight;
  try {
    featurePreflight = await runBrowserCdpPreflight({
      endpoint,
      expectedProduct,
      ...featureCriteria,
      stabilityMs,
      pollMs,
      timeoutMs,
    });
    return {
      ...featurePreflight,
      alignment: {
        status: "already-aligned",
        targetState: "feature-target-aligned",
        targetId: featurePreflight.target.id,
      },
    };
  } catch (error) {
    if (["AbortError", "TimeoutError"].includes(error?.name)) {
      failWith("navigation-readiness-timeout", "portal target readiness could not be established before timeout (state: preflight-timeout).", {
        readinessState: "preflight-timeout",
      });
    }
    if (!(error instanceof BrowserCdpPreflightError) || error.code !== "target-count" || error.targetCount !== 0) {
      throw error;
    }
  }

  const trustedUrl = trustedEntryUrl(entryUrl, featureCriteria, bootstrapCriteria);
  const bootstrapPreflight = await runBrowserCdpPreflight({
    endpoint,
    expectedProduct,
    ...bootstrapCriteria,
    stabilityMs,
    pollMs,
    timeoutMs,
  });
  await navigateExactTarget(bootstrapPreflight.target, trustedUrl, timeoutMs);
  const alignedPreflight = await waitForAlignedTarget({
    endpoint,
    expectedProduct,
    ...featureCriteria,
    targetId: bootstrapPreflight.target.id,
    stabilityMs,
    pollMs,
    timeoutMs,
  });
  return {
    ...alignedPreflight,
    alignment: {
      status: "aligned",
      targetState: "feature-target-aligned",
      targetId: alignedPreflight.target.id,
      fromTarget: bootstrapPreflight.target,
      entryUrl: trustedUrl,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback = null) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
  runBrowserCdpPreflight({
    endpoint: value("--endpoint", "http://127.0.0.1:9222"),
    expectedProduct: value("--expected-product"),
    matchHosts: value("--match-host")?.split(",").filter(Boolean) ?? [],
    matchPathPrefixes: value("--match-path-prefix")?.split(",").filter(Boolean) ?? [],
    matchPathnames: value("--match-pathname")?.split(",").filter(Boolean) ?? [],
    expectedTitlePattern: value("--expected-title-pattern"),
    stabilityMs: Number(value("--stability-ms", defaultStabilityMs)),
  }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 2; });
}
