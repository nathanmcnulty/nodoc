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

  test("propagates bounded constants, URL hosts, aliases, XHR, route metadata, and hashes", () => {
    const result = mineBundleSource(`
      const base = "https://api.example.test";
      const suffix = "/v1";
      const routes = { users: suffix + "/users" };
      const doFetch = fetch;
      doFetch(new URL(routes.users, base), { method: "GET" });
      const xhr = new XMLHttpRequest();
      xhr.open("POST", base + "/v1/users");
      const documentText = "query Users { users { id } }";
      const persistedQuery = { sha256Hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
    `, {
      prefixes: ["/v1/"],
      sourceFile: "v2.js",
    });

    assert.deepEqual(
      result.candidates.map(({ candidatePath, hostname, method }) => ({ candidatePath, hostname, method })),
      [
        { candidatePath: "/v1/users", hostname: "api.example.test", method: "GET" },
        { candidatePath: "/v1/users", hostname: "api.example.test", method: "POST" },
      ],
    );
    assert.equal(
      result.graphqlOperations[0].persistedQueryHash,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
  });

  test("keeps malformed bundles in parse-failure accounting with bounded fallback", () => {
    const result = mineBundleSource("fetch('/api/fallback'); }", {
      prefixes: ["/api/"],
      sourceFile: "broken.js",
    });

    assert.ok(result.parseError);
    assert.deepEqual(result.candidates.map(({ candidatePath }) => candidatePath), ["/api/fallback"]);
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
