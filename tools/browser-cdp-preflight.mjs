import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const defaultTimeoutMs = 3000;
const defaultStabilityMs = 750;
const defaultPollMs = 150;

function fail(message) {
  throw new Error(`browser-cdp-preflight: ${message}`);
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
  const hosts = criteria.matchHosts ?? [];
  const prefixes = criteria.matchPathPrefixes ?? [];
  if (hosts.length > 0 && !hosts.includes(url.hostname.toLowerCase())) return false;
  if (prefixes.length > 0 && !prefixes.some((prefix) => url.pathname.startsWith(prefix))) return false;
  if (criteria.urlPattern && !new RegExp(criteria.urlPattern, "iu").test(target.url)) return false;
  if (criteria.titlePattern && !new RegExp(criteria.titlePattern, "iu").test(String(target.title ?? ""))) return false;
  return true;
}

function targetIdentity(target) {
  return { id: target.id, url: target.url, title: String(target.title ?? ""), webSocketDebuggerUrl: target.webSocketDebuggerUrl };
}

function authenticationFailure(identity, evaluation, criteria) {
  const url = new URL(identity.url);
  const authHosts = criteria.authenticationHosts ?? ["login.live.com", "login.microsoft.com", "login.microsoftonline.com", "login.windows.net"];
  if (authHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return "target is on an authentication host";
  if (criteria.rejectUrlPattern && new RegExp(criteria.rejectUrlPattern, "iu").test(identity.url)) return "target URL matches the authentication rejection pattern";
  if (criteria.expectedTitlePattern && !new RegExp(criteria.expectedTitlePattern, "iu").test(evaluation.title)) return "target title does not meet the authenticated expectation";
  if (criteria.rejectBodyPattern && new RegExp(criteria.rejectBodyPattern, "iu").test(evaluation.bodyText)) return "target body indicates a login barrier";
  return null;
}

function connectAndEvaluate(webSocketUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket connection timed out.")); }, timeoutMs);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => {
      const id = nextId++;
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: {
        expression: "({ title: document.title, url: location.href, bodyText: document.body?.innerText?.slice(0, 2000) ?? '' })",
        returnByValue: true,
      } }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error("Runtime.evaluate failed."));
      else resolve(message.result?.result?.value ?? null);
    });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")));
  });
}

export async function runBrowserCdpPreflight({
  endpoint = "http://127.0.0.1:9222",
  expectedProduct = null,
  matchHosts = [],
  matchPathPrefixes = [],
  urlPattern = null,
  titlePattern = null,
  expectedTitlePattern = null,
  rejectBodyPattern = "sign in|log in|authentication required",
  rejectUrlPattern = "(?:^|/)login(?:[/?#]|$)|signin|sign-in",
  authenticationHosts,
  stabilityMs = defaultStabilityMs,
  pollMs = defaultPollMs,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  const base = loopbackEndpoint(endpoint);
  const version = await getJson(new URL("/json/version", base), timeoutMs);
  if (expectedProduct && !String(version.Browser ?? "").toLowerCase().includes(expectedProduct.toLowerCase())) fail(`browser product is not ${expectedProduct}.`);
  if (typeof version.webSocketDebuggerUrl !== "string" || !version.webSocketDebuggerUrl.startsWith("ws")) fail("browser WebSocket URL is missing.");
  const criteria = { matchHosts: matchHosts.map((host) => host.toLowerCase()), matchPathPrefixes, urlPattern, titlePattern, expectedTitlePattern, rejectBodyPattern, rejectUrlPattern, authenticationHosts };
  const list = async () => {
    const targets = await getJson(new URL("/json/list", base), timeoutMs);
    const matches = targets.filter((target) => targetMatches(target, criteria));
    if (matches.length !== 1) fail(`expected exactly one matching page target, found ${matches.length}.`);
    const identity = targetIdentity(matches[0]);
    if (!identity.webSocketDebuggerUrl) fail("matching target WebSocket URL is missing.");
    const evaluation = await connectAndEvaluate(identity.webSocketDebuggerUrl, timeoutMs);
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
    target: latest.identity,
    evaluation: { title: latest.evaluation.title, url: latest.evaluation.url },
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
    expectedTitlePattern: value("--expected-title-pattern"),
    stabilityMs: Number(value("--stability-ms", defaultStabilityMs)),
  }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 2; });
}
