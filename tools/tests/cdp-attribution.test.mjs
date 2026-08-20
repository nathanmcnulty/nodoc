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
