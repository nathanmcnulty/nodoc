import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalOperationKey,
  normalizeCanonicalPath,
  reconcileOpenApiPostman,
  reconcileOperationSets,
} from "../spec-quality-lib.mjs";

test("canonical operation keys normalize slashes and Postman variables", () => {
  assert.equal(normalizeCanonicalPath("mtp//items/:itemId/"), "/mtp/items/{itemId}");
  assert.equal(
    canonicalOperationKey({ method: "get", path: "/mtp/items/{itemId}" }),
    "GET /mtp/items/{itemId}",
  );
});

test("operation reconciliation preserves method-specific parity", () => {
  const operations = [
    { operationId: "Items.Get", method: "GET", path: "/items/{itemId}" },
    { operationId: "Items.Post", method: "POST", path: "/items/{itemId}" },
  ];
  const collection = {
    item: [
      { request: { method: "GET", url: { path: ["items", ":itemId"] } } },
    ],
  };

  const report = reconcileOpenApiPostman(operations, collection);
  assert.deepEqual(report.counts, {
    emitted: 1,
    intentionallyFiltered: 0,
    orphaned: 0,
    duplicateShadowed: 0,
    unresolved: 1,
  });
  assert.equal(report.emitted[0].operationId, "Items.Get");
  assert.equal(report.unresolved[0].operationId, "Items.Post");
});

test("reconciliation categories are explicit and deterministic", () => {
  const operation = { operationId: "Items.Get", method: "GET", path: "/items" };
  const report = reconcileOperationSets([], { item: [] }, {
    intentionallyFiltered: [{ ...operation, key: canonicalOperationKey(operation), reason: "telemetry" }],
    duplicateShadowed: [{ ...operation, key: canonicalOperationKey(operation), reason: "handoff" }],
  });

  assert.deepEqual(report.counts, {
    emitted: 0,
    intentionallyFiltered: 1,
    orphaned: 0,
    duplicateShadowed: 1,
    aliases: 0,
    unresolved: 0,
  });
});

test("filtered and shadowed operations are excluded from emitted accounting", () => {
  const operation = { operationId: "Items.Get", method: "GET", path: "/items" };
  const report = reconcileOperationSets([operation], {
    item: [{ request: { method: "GET", url: { path: ["items"] } } }],
  }, {
    intentionallyFiltered: [{ ...operation, key: canonicalOperationKey(operation), reason: "adjacent" }],
  });

  assert.equal(report.emitted.length, 0);
  assert.equal(report.unresolved.length, 0);
  assert.equal(report.counts.intentionallyFiltered, 1);
});

test("postman variable braces normalize to the same operation identity", () => {
  const operation = { operationId: "Items.Get", method: "GET", path: "/items/{itemId}" };
  const report = reconcileOpenApiPostman([operation], {
    item: [{ request: { method: "GET", url: { path: ["items", "{{itemId}}"] } } }],
  });

  assert.equal(report.emitted.length, 1);
  assert.equal(report.orphaned.length, 0);
  assert.equal(report.unresolved.length, 0);
});
