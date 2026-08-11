import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { classifyCaptureRequest, DisposableCaptureLifecycle } from "../cdp-capture-lifecycle.mjs";

class MockClient {
  constructor(send) {
    this.commands = [];
    this.sendImpl = send;
  }
  async send(method, params, sessionId) {
    this.commands.push({ method, params, sessionId });
    return this.sendImpl?.(method, params, sessionId);
  }
  async awaitEventHandlers() {}
}

test("request policy separates document ownership from passive read authorization", () => {
  const classify = (url, resourceType = "XHR", method = "GET", authorizedHosts = []) => classifyCaptureRequest({
    authorizedHosts,
    documentUrl: "https://portal.example/home",
    request: { method, url },
    resourceType,
  });
  assert.equal(classify("https://portal.example/api/read").allowed, true);
  assert.equal(classify("https://static.example/app.js", "Script", "GET", ["static.example"]).allowed, true);
  assert.equal(classify("https://static.example/child", "Document", "GET", ["static.example"]).code, "document-ownership-escape");
  assert.equal(classify("https://other.example/app.js", "Script").code, "request-not-authorized");
  assert.equal(classify("https://portal.example/api/delete").code, "active-destination");
  assert.equal(classify("https://portal.example/api/read#fragment").code, "fragment-denied");
  assert.equal(classify("https://portal.example/api/read", "XHR", "POST").code, "unsafe-method");
  assert.equal(classify("https://portal.example/ping", "Ping").code, "stateful-resource-type");
  assert.equal(classify("https://portal.example/api/read", "Preflight").code, "unsupported-resource-type");
});

test("worker interception blocks a safe entry redirect to /delete with zero effect", async () => {
  let deleteReceipts = 0;
  const server = createServer((request, response) => {
    if (request.url === "/safe") {
      response.writeHead(302, { location: "/delete" }).end();
      return;
    }
    if (request.url === "/delete") deleteReceipts += 1;
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new MockClient();
  const lifecycle = new DisposableCaptureLifecycle({ client, documentUrl: `${origin}/safe`, timeoutMs: 100 });
  try {
    await lifecycle.enableSession();
    await lifecycle.handlePaused({ requestId: "root", resourceType: "Document", request: { method: "GET", url: `${origin}/safe` } });
    const response = await fetch(`${origin}/safe`, { redirect: "manual" });
    assert.equal(response.status, 302);
    await lifecycle.handlePaused({
      requestId: "redirect",
      resourceType: "Document",
      request: { method: "GET", url: new URL(response.headers.get("location"), response.url).href },
    });
    assert.deepEqual(client.commands.map(({ method }) => method), ["Fetch.enable", "Fetch.continueRequest", "Fetch.failRequest"]);
    assert.equal(deleteReceipts, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("failed Fetch disposition remains unresolved and cannot publish success", async () => {
  let published = false;
  const client = new MockClient((method) => {
    if (method === "Fetch.continueRequest") throw new Error("timeout");
  });
  const lifecycle = new DisposableCaptureLifecycle({ client, documentUrl: "https://portal.example/safe", timeoutMs: 100 });
  await assert.rejects(
    lifecycle.handlePaused({ requestId: "one", resourceType: "Document", request: { method: "GET", url: "https://portal.example/safe" } }),
    (error) => error.code === "fetch-disposition-unacknowledged",
  );
  await assert.rejects(lifecycle.finalize({
    disconnect: async () => {},
    flush: async () => {},
    quiesce: async () => ({ settled: true }),
  }).then(() => { published = true; }), (error) => error.code === "fetch-disposition-unacknowledged");
  assert.equal(published, false);
  assert.equal(lifecycle.fetchRequests.get("root:one").status, "terminal-failure");
});

test("late lifecycle event during close drain prevents success summary", async () => {
  let published = false;
  const lifecycle = new DisposableCaptureLifecycle({
    client: new MockClient(),
    documentUrl: "https://portal.example/safe",
    timeoutMs: 100,
  });
  await assert.rejects(lifecycle.finalize({
    disconnect: async () => {},
    flush: async () => {},
    quiesce: async () => {
      lifecycle.observeEvent("network-response");
      return { settled: true };
    },
  }).then(() => { published = true; }), (error) => error.code === "late-lifecycle-event");
  assert.equal(published, false);
});
