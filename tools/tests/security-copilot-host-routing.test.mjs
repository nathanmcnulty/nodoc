import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getPreferredServerUrls,
  loadBundledSpecification,
  validatePostmanServerRouting,
} from "../spec-quality-lib.mjs";

const specificationPath = fileURLToPath(new URL(
  "../../specifications/nodoc-security-copilot/specification/openapi.yml",
  import.meta.url,
));
const collectionPath = fileURLToPath(new URL(
  "../../postman/collections/security-copilot.collection.json",
  import.meta.url,
));

function getOperations(specification) {
  return Object.entries(specification.paths ?? {}).flatMap(([pathname, pathItem]) => (
    Object.entries(pathItem ?? {})
      .filter(([method, operation]) => (
        ["get", "put", "post", "patch", "delete", "head", "options", "trace"].includes(method)
        && operation
        && typeof operation === "object"
      ))
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path: pathname,
        operationId: operation.operationId,
        serverUrls: getPreferredServerUrls(specification, pathItem, operation),
      }))
  ));
}

function collapseHosts(collection) {
  const collapsed = structuredClone(collection);
  const visit = (items) => {
    for (const item of items ?? []) {
      if (item.request) {
        item.request.url.host = ["{{baseUrl}}"];
      }
      visit(item.item);
    }
  };
  visit(collapsed.item);
  return collapsed;
}

test("Security Copilot requests retain their six committed host families", async () => {
  const specification = await loadBundledSpecification(specificationPath);
  const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
  const operations = getOperations(specification);
  const expectedHostCounts = Object.groupBy(
    operations,
    (operation) => new URL(operation.serverUrls[0]).hostname,
  );
  assert.equal(operations.length, 42);
  assert.equal(operations.length, 42);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(expectedHostCounts)
        .map(([host, entries]) => [host, entries.length])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    {
      "api.securitycopilot.microsoft.com": 9,
      "api.securityplatform.microsoft.com": 6,
      "ecs.office.com": 4,
      "prod.cds.securitycopilot.microsoft.com": 1,
      "securitymarketplaceapi-prod.microsoft.com": 1,
      "us.api.securityplatform.microsoft.com": 21,
    },
  );

  assert.deepEqual(
    validatePostmanServerRouting(operations, collection, "Security Copilot"),
    {
      operationCount: 42,
      requestCount: 42,
      validatedOperationCount: 42,
      mismatches: [],
    },
  );
});

test("host-aware validation rejects default-host collapse", async () => {
  const specification = await loadBundledSpecification(specificationPath);
  const collection = JSON.parse(readFileSync(collectionPath, "utf8"));

  assert.throws(
    () => validatePostmanServerRouting(
      getOperations(specification),
      collapseHosts(collection),
      "Security Copilot",
    ),
    /Security Copilot has invalid server routing/u,
  );
});
