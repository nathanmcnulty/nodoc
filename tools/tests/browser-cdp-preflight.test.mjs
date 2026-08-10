import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { runBrowserCdpPreflight } from "../browser-cdp-preflight.mjs";

function installWebSocket({ evaluate = { title: "Inventory", url: "https://config.office.com/officeSettings/inventory", bodyText: "Inventory" } } = {}) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class MockWebSocket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    send() { queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: 1, result: { result: { value: evaluate } } }) }))); }
    close() {}
  };
  return () => { globalThis.WebSocket = original; };
}

async function mockCdp(targets, browser = "Microsoft Edge/140.0") {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version") response.end(JSON.stringify({ Browser: browser, Protocol: "1.3", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }));
    else if (request.url === "/json/list") response.end(JSON.stringify(targets));
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
    assert.equal(result.browser, "Microsoft Edge/140.0");
  } finally { restore(); await cdp.close(); }
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
