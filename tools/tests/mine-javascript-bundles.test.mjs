import assert from "node:assert/strict";
import test from "node:test";

import { mineBundleSource } from "../mine-javascript-bundles.mjs";

test("extracts endpoint methods and dynamic route templates", () => {
  const result = mineBundleSource(`
    fetch("/api/users", { method: "POST" });
    client.get(\`/admin/items/\${itemId}\`);
    const config = { endpoint: "/apiproxy/incidents", method: "PATCH" };
  `, {
    prefixes: ["/api/", "/admin/", "/apiproxy/"],
    sourceFile: "sample.js",
  });

  assert.equal(result.parseError, null);
  assert.deepEqual(
    result.candidates.map(({ candidatePath, method }) => ({ candidatePath, method })),
    [
      { candidatePath: "/admin/items/{param}", method: "GET" },
      { candidatePath: "/api/users", method: "POST" },
      { candidatePath: "/apiproxy/incidents", method: "PATCH" },
    ],
  );
});

test("extracts GraphQL operations and source maps", () => {
  const result = mineBundleSource(`
    const queryText = "query TenantSettings { tenant { id } }";
    const mutationText = "mutation UpdatePolicy { updatePolicy { id } }";
    //# sourceMappingURL=portal.js.map
  `, {
    prefixes: ["/api/"],
    sourceFile: "portal.js",
  });

  assert.deepEqual(
    result.graphqlOperations.map(({ name, operationType }) => ({ name, operationType })),
    [
      { name: "UpdatePolicy", operationType: "mutation" },
      { name: "TenantSettings", operationType: "query" },
    ],
  );
  assert.deepEqual(result.sourceMapUrls, ["portal.js.map"]);
});

test("parses modules and does not invent dynamic fetch methods", () => {
  const result = mineBundleSource(`
    export async function load(path, methodName) {
      fetch("/api/dynamic-method", { method: methodName });
      fetch("/api/dynamic-options", options);
      return fetch("/api/dynamic-spread", { ...options });
    }
  `, {
    prefixes: ["/api/"],
    sourceFile: "module.js",
  });

  assert.equal(result.parseError, null);
  assert.deepEqual(
    result.candidates.map(({ candidatePath, method }) => ({ candidatePath, method })),
    [
      { candidatePath: "/api/dynamic-method", method: null },
      { candidatePath: "/api/dynamic-options", method: null },
      { candidatePath: "/api/dynamic-spread", method: null },
    ],
  );
});

test("preserves ambiguous methods and respects object spread order", () => {
  const result = mineBundleSource(`fetch("/api/shared", { method: "POST" }); fetch("/api/shared", options);
    fetch("/api/overridden", { method: "POST", ...options });
    fetch("/api/final", { ...options, method: "PATCH" });
  `, {
    prefixes: ["/api/"],
    sourceFile: "methods.js",
  });

  assert.deepEqual(
    result.candidates.map(({ candidatePath, method }) => ({ candidatePath, method })),
    [
      { candidatePath: "/api/final", method: "PATCH" },
      { candidatePath: "/api/overridden", method: null },
      { candidatePath: "/api/shared", method: null },
      { candidatePath: "/api/shared", method: "POST" },
    ],
  );
});
