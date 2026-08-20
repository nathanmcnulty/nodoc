import assert from "node:assert/strict";
import test from "node:test";

import { collectCdpDomSnapshots } from "../cdp-snapshot-collector.mjs";

test("DOM target snapshots run concurrently while preserving session order and errors", async () => {
  let active = 0;
  let maxActive = 0;
  const snapshots = await collectCdpDomSnapshots({
    sessionEntries: new Map([
      [null, { targetId: "root-target", targetType: "page" }],
      ["iframe-a", { parentFrameId: "root-frame", targetId: "a-target", targetType: "iframe" }],
      ["worker", { targetId: "worker-target", targetType: "service_worker" }],
      ["iframe-b", { targetId: "b-target", targetType: "iframe" }],
    ]).entries(),
    isDomCapableTarget: (_sessionId, targetInfo) => ["page", "iframe"].includes(targetInfo.targetType),
    evaluateSnapshot: async (sessionId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, sessionId === null ? 20 : 5));
      active -= 1;
      if (sessionId === "iframe-a") throw new Error("bounded timeout");
      if (sessionId === "iframe-b") return null;
      return { title: "Root" };
    },
    schemaVersion: 2,
  });

  assert.equal(maxActive, 3);
  assert.deepEqual(snapshots.map(({ sessionId }) => sessionId), ["root", "iframe-a"]);
  assert.equal(snapshots[0].title, "Root");
  assert.equal(snapshots[1].error, "bounded timeout");
  assert.equal(snapshots[1].parentFrameId, "root-frame");
});
