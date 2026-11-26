import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSpecInventory } from "../spec-quality-lib.mjs";
import {
  assertOperationIndexShape,
  buildLlmsText,
  buildOperationIndex,
  buildOperationIndexForSpecification,
  buildSiteArtifacts,
  operationFields,
  operationIndexPath,
  serializeOperationIndex,
  sha256,
  toSingleDocumentAnchor,
} from "../site-artifacts.mjs";

const syntheticSpecification = {
  openapi: "3.0.1",
  info: { title: "Synthetic Portal", version: "1.0", "x-nodoc-category": "Testing" },
  tags: [{ name: "Users" }, { name: "Admin Tools" }, { name: "Ungrouped" }],
  "x-tagGroups": [{ name: "Directory", tags: ["Users", "Admin Tools"] }],
  paths: {
    "/api/users": {
      get: {
        summary: "List users",
        operationId: "listUsers",
        tags: ["Users", "Admin Tools"],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { type: "string" } }, example: ["a"] } } } },
      },
    },
    "/api/users/{id} name": {
      delete: { summary: "Delete a user", tags: ["Admin Tools"], deprecated: true, responses: { 204: { description: "Deleted" } } },
    },
    "/api/hidden": {
      post: { summary: "Hidden", tags: ["Users"], "x-internal": true, responses: { 200: { description: "OK" } } },
    },
    "/api/untagged": {
      get: { summary: "Untagged", responses: { 200: { description: "OK" } } },
    },
    "/api/double//slash": {
      get: { summary: "Double slash", tags: ["Users"], responses: { 200: { description: "OK" } } },
    },
  },
};

test("single-document anchors match Scalar hash routing and reject ids that cannot round-trip", () => {
  assert.equal(toSingleDocumentAnchor("nodoc/tag/users/GET/api/users"), "tag/users/GET/api/users");
  assert.equal(toSingleDocumentAnchor("nodoc/tag/users/GET/api/{id} name"), "tag/users/GET/api/{id}%20name");
  assert.equal(toSingleDocumentAnchor("nodoc/tag/users/GET/api/double//slash"), null);
  assert.equal(toSingleDocumentAnchor("nodoc/tag/users/GET/api/file.body.json"), null);
  assert.equal(toSingleDocumentAnchor("nodoc/tag/users/GET/api/%7Bid%7D"), null);
  assert.equal(toSingleDocumentAnchor("other/tag/users/GET/api/users"), null);
  assert.equal(toSingleDocumentAnchor(undefined), null);
});

test("operation entries use the first navigable tag, keep hidden operations unanchored, and never mutate the source", async () => {
  const before = JSON.stringify(syntheticSpecification);
  const operations = await buildOperationIndexForSpecification({ specId: "synthetic", specification: syntheticSpecification });
  assert.equal(JSON.stringify(syntheticSpecification), before);
  const byKey = new Map(operations.map(operation => [`${operation.method} ${operation.path}`, operation]));

  const listUsers = byKey.get("GET /api/users");
  assert.equal(listUsers.anchor, "tag/users/GET/api/users");
  assert.deepEqual(listUsers.tags, ["Users", "Admin Tools"]);
  assert.equal(listUsers.schemaGap, false);
  assert.equal(listUsers.exampleGap, false);

  const deleteUser = byKey.get("DELETE /api/users/{id} name");
  assert.equal(deleteUser.anchor, "tag/admin-tools/DELETE/api/users/{id}%20name");
  assert.equal(deleteUser.deprecated, true);
  assert.equal(deleteUser.operationId, null);

  assert.equal(byKey.get("POST /api/hidden").anchor, null);
  assert.equal(byKey.get("GET /api/untagged").anchor, "GET/api/untagged");
  assert.equal(byKey.get("GET /api/double//slash").anchor, null);
  // Undocumented response bodies remain gaps; absence is never treated as complete.
  assert.equal(byKey.get("GET /api/untagged").schemaGap, true);

  for (const operation of operations) assert.deepEqual(Object.keys(operation), [...operationFields]);
});

test("the committed operation index is current, allowlisted, and consistent with the specification inventory", async () => {
  const [committedText, inventory] = await Promise.all([readFile(operationIndexPath, "utf8"), buildSpecInventory()]);
  const committed = JSON.parse(committedText);
  assertOperationIndexShape(committed);
  assert.deepEqual(committed.specs.map(spec => spec.specId), inventory.map(spec => spec.specId));
  for (const spec of inventory) {
    assert.equal(committed.specs.find(entry => entry.specId === spec.specId).operationCount, spec.operationCount, spec.specId);
  }
  const anchored = committed.operations.filter(operation => operation.anchor);
  assert.ok(anchored.length / committed.operations.length > 0.99, "nearly every operation should deep-link into the reference");
  for (const operation of anchored) {
    assert.equal(toSingleDocumentAnchor(`nodoc/${decodeURIComponent(operation.anchor)}`), operation.anchor);
  }
  const teams = committed.operations.filter(operation => operation.specId === "teams" && operation.anchor);
  assert.ok(teams.length > 0 && teams.every(operation => operation.anchor.startsWith("tag/")), "x-tagGroups specs link through their tags");
});

test("site artifacts publish digests that match the served bytes and stay deterministic", async () => {
  const specifications = [{ specId: "synthetic", title: "Synthetic Portal", specification: syntheticSpecification }];
  const operationIndex = await buildOperationIndex(specifications);
  assertOperationIndexShape(operationIndex);
  const first = buildSiteArtifacts({ specifications, operationIndex, siteUrl: "https://example.test/", baseUrl: "/" });
  const second = buildSiteArtifacts({ specifications, operationIndex: await buildOperationIndex(specifications), siteUrl: "https://example.test/", baseUrl: "/" });
  assert.deepEqual([...first.files], [...second.files]);
  assert.equal(serializeOperationIndex(operationIndex), serializeOperationIndex(JSON.parse(serializeOperationIndex(operationIndex))));

  const [entry] = first.catalog.specifications;
  assert.equal(entry.page, "https://example.test/synthetic-portal");
  assert.equal(entry.openapi, "https://example.test/openapi/synthetic.json");
  const served = first.files.get("openapi/synthetic.json");
  assert.equal(entry.sha256, sha256(served));
  assert.equal(entry.bytes, Buffer.byteLength(served));
  assert.deepEqual(JSON.parse(served), syntheticSpecification);

  const operations = JSON.parse(first.files.get("operations.json"));
  const hidden = operations.operations.find(operation => operation.path === "/api/hidden");
  assert.equal(hidden.href, "https://example.test/synthetic-portal");
  const listUsers = operations.operations.find(operation => operation.path === "/api/users");
  assert.equal(listUsers.href, "https://example.test/synthetic-portal#tag/users/GET/api/users");

  const llms = buildLlmsText({ catalog: first.catalog, operationCount: operationIndex.operations.length, siteUrl: "https://example.test" });
  assert.match(llms, /^# nodoc\n\n> /u);
  assert.match(llms, /\[Synthetic Portal\]\(https:\/\/example\.test\/synthetic-portal\): 5 operations\./u);
  assert.match(llms, /not supported by Microsoft/u);
});

test("operation index rejects fields outside the public allowlist", () => {
  const index = {
    schemaVersion: 1,
    specs: [{ specId: "a", title: "A", category: null, route: "/a", version: "1", openapiVersion: "3.0.1", operationCount: 1 }],
    operations: [{ specId: "a", method: "GET", path: "/x", operationId: null, summary: null, tags: [], deprecated: false, schemaGap: true, exampleGap: true, anchor: null, tenantId: "t" }],
  };
  assert.throws(() => assertOperationIndexShape(index), /Unexpected operation fields/u);
  delete index.operations[0].tenantId;
  assert.equal(assertOperationIndexShape(index), true);
  index.specs[0].operationCount = 2;
  assert.throws(() => assertOperationIndexShape(index), /count mismatch/u);
});
