import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStableEvidenceId,
  CdpAttributionRegistry,
  captureArtifactSchemaVersion,
  shouldPreferActiveSessionAttribution,
} from "../cdp-attribution.mjs";

function context(pageLabel, pageUrl, actionIndex) {
  return {
    actionIndex,
    attempt: 0,
    checkpoint: pageLabel,
    pageLabel,
    pageUrl,
  };
}

test("target and frame attribution survives concurrent late events", () => {
  const registry = new CdpAttributionRegistry(
    {
      id: "root-target",
      title: "Portal",
      type: "page",
      url: "https://portal.example.test/home",
    },
    context("01-home", "https://portal.example.test/home", 0),
  );

  registry.registerSession("iframe-session", {
    parentFrameId: "root-frame",
    targetId: "iframe-target",
    title: "Embedded",
    type: "iframe",
    url: "https://portal.example.test/embed",
  });
  registry.registerSession("worker-session", {
    targetId: "worker-target",
    title: "Worker",
    type: "worker",
    url: "https://portal.example.test/worker.js",
  });
  registry.registerSession("service-session", {
    targetId: "service-target",
    title: "Service worker",
    type: "service_worker",
    url: "https://portal.example.test/sw.js",
  });
  registry.recordFrameNavigated("iframe-session", {
    id: "iframe-frame",
    loaderId: "iframe-loader",
    parentId: "root-frame",
    url: "https://portal.example.test/embed",
  });

  registry.setRootContext(context("02-settings", "https://portal.example.test/settings", 1));

  assert.equal(
    registry.resolve({
      documentURL: "https://portal.example.test/home",
      frameId: "root-frame",
      sessionId: null,
    }).pageLabel,
    "01-home",
  );
  assert.equal(
    registry.resolve({
      frameId: "iframe-frame",
      loaderId: "iframe-loader",
      sessionId: "iframe-session",
    }).pageLabel,
    "01-home",
  );
  assert.equal(
    registry.resolve({
      frameId: "iframe-frame",
      sessionId: "iframe-session",
    }).pageLabel,
    "01-home",
  );
  assert.equal(registry.resolve({ sessionId: "worker-session" }).targetType, "worker");
  assert.equal(registry.resolve({ sessionId: "service-session" }).targetType, "service_worker");
  assert.equal(registry.resolve({ sessionId: null }).pageLabel, "02-settings");
});

test("network request attribution can prefer the current action for long-lived workers", () => {
  const seed = context("seed-00", "https://portal.example.test/home", -1);
  const action = context("02-connectors", "https://portal.example.test/connectors", 1);
  const registry = new CdpAttributionRegistry(
    { id: "root-target", title: "Portal", type: "page", url: seed.pageUrl },
    seed,
  );
  registry.registerSession("worker-session", {
    targetId: "worker-target",
    type: "worker",
    url: "blob:https://portal.example.test/worker",
  });
  registry.recordFrameNavigated("worker-session", {
    id: "worker-frame",
    loaderId: "seed-loader",
    url: "blob:https://portal.example.test/worker",
  });
  registry.setRootContext(action);
  registry.setActiveSessionContexts(action);

  assert.equal(registry.resolve({
    documentURL: "blob:https://portal.example.test/worker",
    loaderId: "seed-loader",
    sessionId: "worker-session",
  }).pageLabel, "seed-00");
  assert.equal(registry.resolve({
    documentURL: "blob:https://portal.example.test/worker",
    loaderId: "seed-loader",
    preferSessionContext: true,
    sessionId: "worker-session",
  }).pageLabel, "02-connectors");
});

test("only request-start events prefer the active child-session context", () => {
  assert.equal(shouldPreferActiveSessionAttribution("Network.requestWillBeSent"), true);
  assert.equal(shouldPreferActiveSessionAttribution("Network.webSocketCreated"), false);
  assert.equal(shouldPreferActiveSessionAttribution("Network.webTransportCreated"), false);
  assert.equal(shouldPreferActiveSessionAttribution("Network.responseReceived"), false);
});

test("stable evidence IDs are deterministic and attempt-scoped", () => {
  const inputs = {
    actionIndex: 3,
    attempt: 0,
    frameId: "frame-1",
    normalizedUrl: "https://portal.example.test/api/items",
    pageLabel: "04-probe-items",
    sessionId: "session-1",
    targetId: "target-1",
  };

  assert.equal(buildStableEvidenceId("probe", inputs), buildStableEvidenceId("probe", { ...inputs }));
  assert.notEqual(
    buildStableEvidenceId("probe", inputs),
    buildStableEvidenceId("probe", { ...inputs, attempt: 1 }),
  );
  assert.match(buildStableEvidenceId("probe", inputs), /^probe-[a-f0-9]{20}$/u);
});

test("target snapshots are sorted and carry schema and relationship metadata", () => {
  const registry = new CdpAttributionRegistry(
    { id: "root", title: "Root", type: "page", url: "https://portal.example.test" },
    context("seed-00", "https://portal.example.test", -1),
  );
  registry.registerSession("z-session", { targetId: "z-target", type: "service_worker" });
  registry.registerSession("a-session", {
    parentFrameId: "root-frame",
    targetId: "a-target",
    type: "iframe",
  });

  assert.equal(captureArtifactSchemaVersion, 2);
  assert.deepEqual(registry.snapshot().map((entry) => entry.sessionId), [
    "a-session",
    "root",
    "z-session",
  ]);
  assert.equal(registry.snapshot()[0].parentFrameId, "root-frame");
  assert.equal(registry.snapshot()[0].targetId, "a-target");
});

test("target info delivered on root transport updates the matching child target", () => {
  const registry = new CdpAttributionRegistry(
    { id: "root-target", title: "Root page", type: "page", url: "https://portal.example.test/home" },
    context("01-home", "https://portal.example.test/home", 0),
  );
  registry.updateTarget(null, { targetId: "root-target", title: "Root page", type: "page", url: "https://portal.example.test/home" });
  registry.registerSession("child-session", {
    targetId: "child-target", title: "Old child", type: "iframe", url: "https://portal.example.test/old-child",
  });

  registry.updateTarget(null, {
    targetId: "child-target", title: "Updated child", type: "iframe", url: "https://portal.example.test/child",
  });

  const snapshot = registry.snapshot();
  const root = snapshot.find((entry) => entry.targetId === "root-target");
  const child = snapshot.find((entry) => entry.targetId === "child-target");
  assert.equal(root.targetTitle, "Root page");
  assert.equal(root.targetType, "page");
  assert.equal(root.targetUrl, "https://portal.example.test/home");
  assert.equal(child.sessionId, "child-session");
  assert.equal(child.targetTitle, "Updated child");
  assert.equal(child.targetUrl, "https://portal.example.test/child");
});

test("unknown target info on root transport does not overwrite root or known children", () => {
  const registry = new CdpAttributionRegistry(
    { id: "root-target", title: "Root page", type: "page", url: "https://portal.example.test/home" },
    context("01-home", "https://portal.example.test/home", 0),
  );
  registry.updateTarget(null, { targetId: "root-target", title: "Root page", type: "page", url: "https://portal.example.test/home" });
  registry.registerSession("child-session", {
    targetId: "child-target", title: "Known child", type: "iframe", url: "https://portal.example.test/child",
  });

  registry.updateTarget(null, {
    targetId: "unknown-target", title: "Unknown child", type: "iframe", url: "https://portal.example.test/unknown",
  });

  const snapshot = registry.snapshot();
  assert.equal(snapshot.find((entry) => entry.targetId === "root-target").targetTitle, "Root page");
  assert.equal(snapshot.find((entry) => entry.targetId === "child-target").targetTitle, "Known child");
});

test("a normal root target update still applies by target ID", () => {
  const registry = new CdpAttributionRegistry(
    { id: "root-target", title: "Old root", type: "page", url: "https://portal.example.test/home" },
    context("01-home", "https://portal.example.test/home", 0),
  );

  registry.updateTarget(null, {
    targetId: "root-target", title: "Updated root", type: "page", url: "https://portal.example.test/settings",
  });

  const root = registry.snapshot().find((entry) => entry.targetId === "root-target");
  assert.equal(root.targetTitle, "Updated root");
  assert.equal(root.targetUrl, "https://portal.example.test/settings");
});

test("nested target info routes to its target instead of the parent transport", () => {
  const registry = new CdpAttributionRegistry(
    { id: "root-target", title: "Root page", type: "page", url: "https://portal.example.test/home" },
    context("01-home", "https://portal.example.test/home", 0),
  );
  registry.registerSession("parent-session", {
    targetId: "parent-target", title: "Parent frame", type: "iframe", url: "https://portal.example.test/parent",
  });
  registry.registerSession("nested-session", {
    targetId: "nested-target", title: "Nested frame", type: "iframe", url: "https://portal.example.test/nested",
  }, "parent-session");

  registry.updateTarget("parent-session", {
    targetId: "nested-target", title: "Updated nested frame", type: "iframe", url: "https://portal.example.test/nested-updated",
  });

  const snapshot = registry.snapshot();
  assert.equal(snapshot.find((entry) => entry.targetId === "parent-target").targetTitle, "Parent frame");
  assert.equal(snapshot.find((entry) => entry.targetId === "nested-target").sessionId, "nested-session");
  assert.equal(snapshot.find((entry) => entry.targetId === "nested-target").targetTitle, "Updated nested frame");
});

test("target updates without an explicit target ID retain session-based partial updates", () => {
  const registry = new CdpAttributionRegistry(
    { id: "root-target", title: "Old root", type: "page", url: "https://portal.example.test/home" },
    context("01-home", "https://portal.example.test/home", 0),
  );

  registry.updateTarget(null, { targetId: "root-target", title: "Old root", type: "page", url: "https://portal.example.test/home" });
  registry.updateTarget(null, { title: "Partial root title" });

  const root = registry.snapshot().find((entry) => entry.targetId === "root-target");
  assert.equal(root.targetTitle, "Partial root title");
  assert.equal(root.targetUrl, "https://portal.example.test/home");
});
