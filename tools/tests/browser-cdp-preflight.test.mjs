import { buildPreflightCriteria, buildBootstrapPreflightCriteria, preflightRecipeTarget, validateSelectedRecipeTarget } from "../run-portal-discovery.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  alignBrowserCdpTarget,
  matchesExpectedProduct,
  normalizeProductFamily,
  runBrowserCdpPreflight,
} from "../browser-cdp-preflight.mjs";

function installWebSocket({
  evaluate = { title: "Inventory", url: "https://config.office.com/officeSettings/inventory", bodyText: "Inventory" },
  onCommand = () => null,
} = {}) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class MockWebSocket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    send(rawMessage) {
      const message = JSON.parse(rawMessage);
      queueMicrotask(() => {
        if (message.method === "Runtime.evaluate") {
          const value = typeof evaluate === "function" ? evaluate() : evaluate;
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ id: message.id, result: { result: { value } } }),
          }));
          return;
        }
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ id: message.id, result: onCommand(message) ?? {} }),
        }));
      });
    }
    close() {}
  };
  return () => { globalThis.WebSocket = original; };
}

async function mockCdp(targets, browser = "Edg/151.0.4129.72") {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version") response.end(JSON.stringify({ Browser: browser, Protocol: "1.3", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }));
    else if (request.url === "/json/list") response.end(JSON.stringify(typeof targets === "function" ? targets() : targets));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const target = (overrides = {}) => ({ type: "page", id: "page-1", title: "Inventory", url: "https://config.office.com/officeSettings/inventory", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page-1", ...overrides });

test("accepts one stable authenticated target", async () => {
  const restore = installWebSocket();
  const cdp = await mockCdp([target()]);
  try {
    const result = await runBrowserCdpPreflight({ endpoint: cdp.endpoint, expectedProduct: "Edge", matchHosts: ["config.office.com"], matchPathPrefixes: ["/officeSettings/inventory"], stabilityMs: 20, pollMs: 5 });
    assert.equal(result.target.id, "page-1");
    assert.equal(result.browser, "Edg/151.0.4129.72");
  } finally { restore(); await cdp.close(); }
});

test("normalizes explicit Edge and Chrome product aliases without fuzzy matches", () => {
  assert.equal(normalizeProductFamily("Edg/151.0.4129.72"), "edge");
  assert.equal(normalizeProductFamily("Microsoft Edge/151.0.4129.72"), "edge");
  assert.equal(normalizeProductFamily("Google Chrome/140.0.7339.80"), "chrome");
  assert.equal(matchesExpectedProduct("Edg/151.0.4129.72", "Edge"), true);
  assert.equal(matchesExpectedProduct("Microsoft Edge/151.0.4129.72", "Edg"), true);
  assert.equal(matchesExpectedProduct("Google Chrome/140.0.7339.80", "Chrome"), true);
  assert.equal(matchesExpectedProduct("Edg/151.0.4129.72", "Chrome"), false);
  assert.equal(matchesExpectedProduct("Google Chrome/140.0.7339.80", "Edge"), false);
  assert.equal(matchesExpectedProduct("Not Edge/151.0.4129.72", "Edge"), false);
});

test("fails closed for ambiguous targets", async () => {
  const restore = installWebSocket();
  const cdp = await mockCdp([target(), target({ id: "page-2" })]);
  try { await assert.rejects(runBrowserCdpPreflight({ endpoint: cdp.endpoint, matchHosts: ["config.office.com"], stabilityMs: 1 }), /exactly one matching page target/); }
  finally { restore(); await cdp.close(); }
});

test("fails closed when target identity churns", async () => {
  const restore = installWebSocket();
  let count = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version") response.end(JSON.stringify({ Browser: "Microsoft Edge", Protocol: "1.3", webSocketDebuggerUrl: "ws://browser" }));
    else response.end(JSON.stringify([target({ id: `page-${++count}` })]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await assert.rejects(runBrowserCdpPreflight({ endpoint: `http://127.0.0.1:${server.address().port}`, matchHosts: ["config.office.com"], stabilityMs: 20, pollMs: 5 }), /identity changed/); }
  finally { restore(); await new Promise((resolve) => server.close(resolve)); }
});

test("rejects product mismatch, non-loopback endpoints, and authentication targets", async () => {
  const restore = installWebSocket();
  const cdp = await mockCdp([target()], "Google Chrome/140.0");
  try {
    await assert.rejects(runBrowserCdpPreflight({ endpoint: cdp.endpoint, expectedProduct: "Edge", matchHosts: ["config.office.com"] }), /product is not Edge/);
    await assert.rejects(runBrowserCdpPreflight({ endpoint: "http://example.com:9222" }), /loopback/);
  } finally { await cdp.close(); }
  const authCdp = await mockCdp([target({ url: "https://login.microsoftonline.com/common/oauth2" })]);
  try { await assert.rejects(runBrowserCdpPreflight({ endpoint: authCdp.endpoint, matchHosts: ["login.microsoftonline.com"] }), /authentication host/); }
  finally { restore(); await authCdp.close(); }
});

test("aligns one authenticated same-portal bootstrap target without changing its exact ID", async () => {
  const current = target({ title: "Home - Microsoft 365 Apps admin center", url: "https://config.office.com/officeSettings" });
  const restore = installWebSocket({
    evaluate: () => ({
      title: current.title,
      url: current.url,
      bodyText: "Home",
    }),
    onCommand: (message) => {
      if (message.method === "Page.navigate") {
        current.url = message.params.url;
        current.title = "Inventory";
        return { frameId: "frame-1" };
      }
      return {};
    },
  });
  const cdp = await mockCdp([current]);
  try {
    const result = await alignBrowserCdpTarget({
      endpoint: cdp.endpoint,
      expectedProduct: "Edge",
      entryUrl: "https://config.office.com/officeSettings/inventory",
      featureCriteria: {
        matchHosts: ["config.office.com"],
        matchPathPrefixes: ["/officeSettings/inventory"],
      },
      bootstrapCriteria: {
        matchHosts: ["config.office.com"],
        matchPathnames: ["/officeSettings"],
      },
      stabilityMs: 10,
      pollMs: 2,
    });
    assert.equal(result.alignment.status, "aligned");
    assert.equal(result.target.id, "page-1");
    assert.equal(result.alignment.targetId, "page-1");
    assert.equal(result.alignment.fromTarget.id, "page-1");
    assert.equal(result.evaluation.url, "https://config.office.com/officeSettings/inventory");
  } finally {
    restore();
    await cdp.close();
  }
});

test("aligns a redirected portal landing to an allowlisted parameterized feature URL", async () => {
  const current = target({ title: "Home - Microsoft Defender", url: "https://security.microsoft.com/homepage?tid=current" });
  const restore = installWebSocket({
    evaluate: () => ({ title: current.title, url: current.url, bodyText: "Home" }),
    onCommand: (message) => {
      if (message.method === "Page.navigate") current.url = message.params.url;
      return message.method === "Page.navigate" ? { frameId: "frame-1" } : {};
    },
  });
  const cdp = await mockCdp([current]);
  try {
    const entryUrl = "https://security.microsoft.com/user?aad=entity&tab=huntingGraph&tid=tenant";
    const result = await alignBrowserCdpTarget({
      endpoint: cdp.endpoint,
      expectedProduct: "Edge",
      entryUrl,
      featureCriteria: {
        matchHosts: ["security.microsoft.com"],
        matchPathPrefixes: ["/user"],
        allowedEntryQueryParameters: ["aad", "tab", "tid"],
      },
      bootstrapCriteria: {
        matchHosts: ["security.microsoft.com"],
        matchPathPrefixes: ["/"],
      },
      stabilityMs: 10,
      pollMs: 2,
    });
    assert.equal(result.alignment.status, "aligned");
    assert.equal(result.target.id, "page-1");
    assert.equal(result.evaluation.url, entryUrl);
  } finally {
    restore();
    await cdp.close();
  }
});

test("waits for the same target ID to publish its navigated URL before strict preflight", async () => {
  const current = target({ title: "Home - Microsoft 365 Apps admin center", url: "https://config.office.com/officeSettings" });
  let navigationStarted = false;
  let listCount = 0;
  const restore = installWebSocket({
    evaluate: () => ({ title: current.title, url: current.url, bodyText: current.title === "Inventory" ? "Inventory" : "Home" }),
    onCommand: (message) => {
      if (message.method === "Page.navigate") navigationStarted = true;
      return {};
    },
  });
  const cdp = await mockCdp(() => {
    listCount += 1;
    if (navigationStarted && listCount > 4) {
      current.url = "https://config.office.com/officeSettings/inventory";
      current.title = "Inventory";
    }
    return [current];
  });
  try {
    const result = await alignBrowserCdpTarget({
      endpoint: cdp.endpoint,
      expectedProduct: "Edge",
      entryUrl: "https://config.office.com/officeSettings/inventory",
      featureCriteria: { matchHosts: ["config.office.com"], matchPathPrefixes: ["/officeSettings/inventory"] },
      bootstrapCriteria: { matchHosts: ["config.office.com"], matchPathnames: ["/officeSettings"] },
      stabilityMs: 4,
      pollMs: 1,
      timeoutMs: 500,
    });
    assert.equal(result.alignment.status, "aligned");
    assert.equal(result.target.id, "page-1");
    assert.equal(result.evaluation.url, "https://config.office.com/officeSettings/inventory");
  } finally {
    restore();
    await cdp.close();
  }
});

test("fails closed with an explicit readiness timeout when the same target never reaches the entry URL", async () => {
  const current = target({ title: "Home - Microsoft 365 Apps admin center", url: "https://config.office.com/officeSettings" });
  let navigationStarted = false;
  const restore = installWebSocket({ evaluate: () => ({ title: current.title, url: current.url, bodyText: "Home" }), onCommand: (message) => {
    if (message.method === "Page.navigate") navigationStarted = true;
    return { frameId: "frame-1" };
  } });
  const cdp = await mockCdp(() => navigationStarted ? [] : [current]);
  try {
    await assert.rejects(
      alignBrowserCdpTarget({
        endpoint: cdp.endpoint,
        entryUrl: "https://config.office.com/officeSettings/inventory",
        featureCriteria: { matchHosts: ["config.office.com"], matchPathPrefixes: ["/officeSettings/inventory"] },
        bootstrapCriteria: { matchHosts: ["config.office.com"], matchPathnames: ["/officeSettings"] },
        stabilityMs: 1,
        pollMs: 1,
        timeoutMs: 50,
      }),
      (error) => error.code === "navigation-readiness-timeout",
    );
  } finally {
    restore();
    await cdp.close();
  }
});

test("fails closed when bootstrap selection is ambiguous, wrong-host, or authenticated-blocked", async () => {
  const bootstrapCriteria = {
    matchHosts: ["config.office.com"],
    matchPathnames: ["/officeSettings"],
  };
  const featureCriteria = {
    matchHosts: ["config.office.com"],
    matchPathPrefixes: ["/officeSettings/inventory"],
  };
  const make = async (targets, evaluate) => {
    const restore = installWebSocket({ evaluate });
    const cdp = await mockCdp(targets);
    try {
      await assert.rejects(
        alignBrowserCdpTarget({
          endpoint: cdp.endpoint,
          entryUrl: "https://config.office.com/officeSettings/inventory",
          featureCriteria,
          bootstrapCriteria,
          stabilityMs: 1,
          pollMs: 1,
        }),
        (error) => error.code === "target-count" || error.message.includes("login barrier"),
      );
    } finally {
      restore();
      await cdp.close();
    }
  };

  await make(
    [target({ id: "page-1", url: "https://config.office.com/officeSettings" }), target({ id: "page-2", url: "https://config.office.com/officeSettings" })],
    { title: "Home", url: "https://config.office.com/officeSettings", bodyText: "Home" },
  );
  await make(
    [target({ url: "https://other.office.com/officeSettings" })],
    { title: "Home", url: "https://other.office.com/officeSettings", bodyText: "Home" },
  );
  await make(
    [target({ url: "https://config.office.com/officeSettings" })],
    { title: "Sign in", url: "https://config.office.com/officeSettings", bodyText: "Sign in to your account" },
  );
});

test("rejects active-looking SPA fragments before exact-target navigation", async () => {
  const current = target({ title: "Microsoft Entra admin center", url: "https://entra.microsoft.com/" });
  const restore = installWebSocket({
    evaluate: () => ({ title: current.title, url: current.url, bodyText: "Microsoft Entra admin center" }),
  });
  const cdp = await mockCdp(() => [current]);
  try {
    await assert.rejects(
      alignBrowserCdpTarget({
        endpoint: cdp.endpoint,
        entryUrl: "https://entra.microsoft.com/#blade/delete",
        featureCriteria: { matchHosts: ["entra.microsoft.com"], matchPathPrefixes: ["/feature"] },
        bootstrapCriteria: { matchHosts: ["entra.microsoft.com"], matchPathnames: ["/"] },
        stabilityMs: 1,
        pollMs: 1,
        timeoutMs: 250,
      }),
      (error) => error.code === "entry-url-untrusted" && /active-get-denied/.test(error.message),
    );
  } finally {
    restore();
    await cdp.close();
  }
});

function urlPatternRecipe(url, placement = "top") {
  const pattern = `^${url.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;
  return {
    url,
    pageTarget: {
      matchHosts: [new URL(url).hostname],
      matchPathPrefixes: ["/"],
      ...(placement === "nested" ? { matchUrlPattern: pattern } : {}),
    },
    matchHosts: ["graph.microsoft.com"],
    matchPathPrefixes: ["/beta/observed-passive-route"],
    ...(placement === "top" ? { matchUrlPattern: pattern } : {}),
    actions: [{ type: "navigate", value: url, required: true }],
  };
}

test("recipe root URL regex selects the exact Graph caller through production preflight", async () => {
  const url = "https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/TenantAdminMenu/~/advancedHub";
  const recipe = urlPatternRecipe(url);
  const restore = installWebSocket({ evaluate: { title: "Intune", url, bodyText: "Windows Autopatch Advanced Hub" } });
  const cdp = await mockCdp([
    target({ id: "other-blade", url: "https://intune.microsoft.com/#home", title: "Intune" }),
    target({ id: "advanced-hub", url, title: "Intune" }),
  ]);
  try {
    const result = await preflightRecipeTarget({ recipe, endpoint: cdp.endpoint, expectedProduct: "Edge", stabilityMs: 1, pollMs: 1 });
    assert.equal(result.target.id, "advanced-hub");
    assert.equal(result.authenticationStatus, "verified");
    assert.ok(buildPreflightCriteria(recipe).urlPattern instanceof RegExp);
  } finally { restore(); await cdp.close(); }
});

test("nested pageTarget URL regex is enforced against same-host wrong Guest blades", async () => {
  const url = "https://entra.microsoft.com/#blade/Microsoft_AAD_ERM/DashboardBlade";
  const recipe = urlPatternRecipe(url, "nested");
  let available = [
    target({ id: "wrong-blade", url: "https://entra.microsoft.com/#blade/Microsoft_AAD_IAM/UsersManagementMenuBlade", title: "Entra" }),
    target({ id: "identity-governance", url, title: "Entra" }),
  ];
  const restore = installWebSocket({ evaluate: { title: "Entra", url, bodyText: "Identity Governance Dashboard" } });
  const cdp = await mockCdp(() => available);
  try {
    const result = await preflightRecipeTarget({ recipe, endpoint: cdp.endpoint, stabilityMs: 1, pollMs: 1 });
    assert.equal(result.target.id, "identity-governance");
    available = [available[0]];
    await assert.rejects(preflightRecipeTarget({ recipe, endpoint: cdp.endpoint, stabilityMs: 1 }), /exactly one matching page target, found 0/);
  } finally { restore(); await cdp.close(); }
});

test("recipe URL patterns reject malformed and conflicting declarations without broad fallback", () => {
  const url = "https://config.office.com/officeSettings/inventory";
  const good = urlPatternRecipe(url);
  for (const pattern of ["[", "", "   ", null, 7]) {
    const invalid = { ...good, matchUrlPattern: pattern };
    assert.throws(() => buildPreflightCriteria(invalid), /recipe URL match pattern/);
    assert.throws(() => validateSelectedRecipeTarget(invalid), error => error.code === "recipe-target-invalid" && /recipe URL match pattern/.test(error.message));
  }
  const conflicting = { ...good, pageTarget: { ...good.pageTarget, matchUrlPattern: "^https://different\\.example/$" } };
  assert.throws(() => buildPreflightCriteria(conflicting), /conflicting recipe URL match patterns/);
  const matching = { ...good, pageTarget: { ...good.pageTarget, matchUrlPattern: good.matchUrlPattern } };
  assert.equal(buildPreflightCriteria(matching).urlPattern.source, new RegExp(good.matchUrlPattern, "iu").source);
});

test("bootstrap criteria compile declared recipe URL regex without changing host and path restrictions", () => {
  const recipe = urlPatternRecipe("https://config.office.com/officeSettings/inventory");
  recipe.matchUrlPattern = "^https://config\\.office\\.com/(?:home|officeSettings/inventory)$";
  recipe.pageTarget.bootstrap = { matchHosts: ["config.office.com"], matchPathnames: ["/home"] };
  const criteria = buildBootstrapPreflightCriteria(recipe);
  assert.ok(criteria.urlPattern instanceof RegExp);
  assert.equal(criteria.urlPattern.test("https://config.office.com/home"), true);
  assert.equal(criteria.urlPattern.test("https://other.example/home"), false);
  assert.deepEqual(criteria.matchHosts, ["config.office.com"]);
  assert.deepEqual(criteria.matchPathnames, ["/home"]);
});

test("generic production preflight string patterns retain literal containment semantics", async () => {
  const restore = installWebSocket();
  const cdp = await mockCdp([target()]);
  try {
    const result = await runBrowserCdpPreflight({ endpoint: cdp.endpoint, urlPattern: "officeSettings/inventory", stabilityMs: 1, pollMs: 1 });
    assert.equal(result.target.id, "page-1");
    await assert.rejects(runBrowserCdpPreflight({ endpoint: cdp.endpoint, urlPattern: "^https://config\\.office\\.com/officeSettings/inventory$", stabilityMs: 1 }), /exactly one matching page target/);
  } finally { restore(); await cdp.close(); }
});
