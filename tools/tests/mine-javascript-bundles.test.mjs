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

test("bounds const propagation, resolves aliases, URLs, XHR, routes, SDK metadata, and hosts", () => {
    const result = mineBundleSource(`
      const base = "https://API.Example.test/root";
      const path = "/api/items";
      const url = new URL(path, base);
      const request = fetch;
      const send = request;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      const sdk = { routes: { list: "/api/sdk-list" }, endpoint: "/api/sdk" };
      send("https://other.example.test/api/alias");
      client.get(sdk.routes.list);
    `, { prefixes: ["/api/"], sourceFile: "bounded.js" });

    assert.deepEqual(result.candidates.map(({ candidatePath, hostname, method }) => ({
      candidatePath, hostname, method,
    })), [
      { candidatePath: "/api/alias", hostname: "other.example.test", method: "GET" },
      { candidatePath: "/api/items", hostname: "api.example.test", method: "POST" },
      { candidatePath: "/api/sdk", hostname: null, method: null },
      { candidatePath: "/api/sdk-list", hostname: null, method: "GET" },
    ]);
});

test("extracts GraphQL names, types, persisted hashes, and parse fallback metadata", () => {
    const result = mineBundleSource(`
      const operationName = "TenantSettings";
      const metadata = { operationName, sha256Hash: "ABCDEF0123456789ABCDEF0123456789" };
      const query = "query TenantSettings { tenant { id } }";
    `, { prefixes: ["/api/"] });
    assert.deepEqual(result.graphqlOperations, [{
      confidence: 0.8,
      name: "TenantSettings",
      operationType: "query",
      persistedQueryHash: "abcdef0123456789abcdef0123456789",
      provenance: "graphql-document+persisted-query-object",
      sourceFile: "bundle.js",
    }]);

    const fallback = mineBundleSource("fetch('/api/fallback'); {{{", { prefixes: ["/api/"] });
    assert.equal(fallback.candidates[0].discoveryKind, "parse-fallback");
    assert.equal(fallback.candidates[0].confidence, 0.4);
    assert.match(fallback.candidates[0].reason, /regex-only bounded fallback/u);
});

test("does not promote dynamic cycles or unrelated strings", () => {
    const result = mineBundleSource(`
      const a = b; const b = a;
      let reassigned = "/api/first"; reassigned = "/api/second";
      console.log("/not-an-endpoint");
    `, { prefixes: ["/api/"] });
    assert.deepEqual(result.candidates.map(({ candidatePath }) => candidatePath), []);
});
