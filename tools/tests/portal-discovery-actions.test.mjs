import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildEffectiveActions,
  estimateReplayExpansion,
  resolveStrictNavigationUrl,
  validateEffectiveActions,
} from "../portal-discovery-actions.mjs";
import { planActionBudget } from "../portal-discovery-action-budget.mjs";
import { deriveActionEligibility } from "../discovery-capture-policy.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workerPath = path.join(repoRoot, "tools", "cdp-deep-capture.mjs");

test("normalizes scalar, object, scoped, and CLI actions in execution order with provenance", () => {
  const actions = buildEffectiveActions({
    recipeActions: [
      " NAVIGATE = /main/admin ",
      { type: "CLICK", scope: " ROOT ", value: "Admin roles", required: true },
    ],
    cliActions: ["WAIT-MS=10"],
    includeInitialNavigation: true,
    initialUrl: "https://engage.cloud.microsoft/main/admin",
  });
  const validated = validateEffectiveActions(actions, {
    rootUrl: "https://engage.cloud.microsoft/main/admin",
  });
  assert.deepEqual(
    validated.map(({ source, sourceIndex, type, value, resolvedUrl }) => ({
      source,
      sourceIndex,
      type,
      value,
      resolvedUrl,
    })),
    [
      {
        source: "initial",
        sourceIndex: -1,
        type: "navigate",
        value: "https://engage.cloud.microsoft/main/admin",
        resolvedUrl: "https://engage.cloud.microsoft/main/admin",
      },
      {
        source: "recipe",
        sourceIndex: 0,
        type: "navigate",
        value: "/main/admin",
        resolvedUrl: "https://engage.cloud.microsoft/main/admin",
      },
      {
        source: "recipe",
        sourceIndex: 1,
        type: "click-label",
        value: "Admin roles",
        resolvedUrl: undefined,
      },
      {
        source: "cli",
        sourceIndex: 0,
        type: "wait-ms",
        value: "10",
        resolvedUrl: undefined,
      },
    ],
  );
});

test("strict navigation rejects unsafe routes and page-target mismatches", () => {
  const unsafeRoutes = [
    "http://portal.example/read",
    "https://other.example/read",
    "https://portal.example/read?mode=view",
    "https://user:password@portal.example/read",
    "https://portal.example/read#fragment",
    "/read?mode=view",
    "/read#fragment",
  ];
  for (const route of unsafeRoutes) {
    assert.throws(
      () => resolveStrictNavigationUrl(route, "https://portal.example/root", {
        criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/read"] },
      }),
      /HTTPS URL without credentials|page-target criteria/u,
    );
  }
  assert.equal(
    resolveStrictNavigationUrl("/read/items", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/read"] },
    }),
    "https://portal.example/read/items",
  );
});

test("all navigation positions are validated before execution", () => {
  assert.throws(
    () => validateEffectiveActions(
      buildEffectiveActions({
        recipeActions: [
          "capture=before",
          "navigate=/safe",
          { type: "navigate", value: "https://portal.example/safe?query=blocked" },
        ],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/root",
      }),
      { rootUrl: "https://portal.example/root" },
    ),
    /HTTPS URL without credentials, query, or fragment/u,
  );
  assert.throws(
    () => validateEffectiveActions(
      buildEffectiveActions({
        recipeActions: ["navigate=/wrong"],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/root",
      }),
      {
        rootUrl: "https://portal.example/root",
        pageTarget: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
      },
    ),
    /page-target criteria/u,
  );
});

test("click safety rejects padded destructive and empty labels, and ambiguity is ineligible", () => {
  assert.throws(
    () => validateEffectiveActions(
      buildEffectiveActions({
        recipeActions: ["click-label=   DELETE   "],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/root",
      }),
      { rootUrl: "https://portal.example/root" },
    ),
    /non-destructive, non-empty/u,
  );
  assert.throws(
    () => validateEffectiveActions(
      buildEffectiveActions({
        recipeActions: ["click-contains=   "],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/root",
      }),
      { rootUrl: "https://portal.example/root" },
    ),
    /non-destructive, non-empty/u,
  );
  const eligibility = deriveActionEligibility(
    { type: "click-label", scope: "root", value: "Read" },
    [{
      sessionId: "root",
      targetType: "page",
      controls: [
        { text: "Read" },
        { ariaLabel: "Read" },
      ],
    }],
  );
  assert.equal(eligibility.status, "ambiguous");
  assert.equal(eligibility.candidateCount, 2);
});

test("replay expansion is bounded before browser interaction", () => {
  const recipe = {
    url: "https://portal.example/root",
    seedLinkLimit: 2,
    actions: [
      "replay-seeded-links=all",
      "replay-seeded-routes=items",
    ],
    seedRouteGroups: { items: { limit: 3 } },
    maxActions: 10,
  };
  assert.equal(
    estimateReplayExpansion(buildEffectiveActions({ recipeActions: recipe.actions }), recipe),
    5,
  );
  assert.equal(planActionBudget(recipe).countedActions, 8);
  assert.throws(
    () => planActionBudget({
      url: recipe.url,
      actions: ["replay-seeded-routes=items"],
      seedRouteGroups: { items: { limit: Number.POSITIVE_INFINITY } },
    }),
    /bounded/u,
  );
});

test("worker rejects an unsafe direct initial URL before contacting CDP", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-unsafe-worker-"));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(500);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        workerPath,
        "--url",
        "https://portal.example/root?query=blocked",
        "--portal",
        "test",
        "--out",
        artifactDir,
        "--cdp-endpoint",
        `http://127.0.0.1:${port}`,
      ], { cwd: repoRoot }),
      /query/u,
    );
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(artifactDir, { recursive: true, force: true });
  }
});

test("worker rejects unsafe CLI navigation and click overrides before contacting CDP", async () => {
  const unsafeOverrides = [
    "navigate=https://other.example/read",
    "navigate=https://portal.example/root?query=blocked",
    "navigate=https://user:password@portal.example/root",
    "navigate=https://portal.example/root#fragment",
    "click-label=   DELETE   ",
    "click-contains=   ",
  ];
  for (const override of unsafeOverrides) {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-unsafe-override-"));
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      await assert.rejects(
        execFileAsync(process.execPath, [
          workerPath,
          "--url",
          "https://portal.example/root",
          "--portal",
          "test",
          "--action",
          override,
          "--out",
          artifactDir,
          "--cdp-endpoint",
          `http://127.0.0.1:${port}`,
        ], { cwd: repoRoot }),
      );
      assert.equal(requests, 0, `unsafe override contacted CDP: ${override}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(artifactDir, { recursive: true, force: true });
    }
  }
});

test("worker rejects a mismatched target-id before opening its websocket", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-target-mismatch-"));
  const recipePath = path.join(rootDir, "recipe.json");
  const artifactDir = path.join(rootDir, "artifacts");
  let websocketUpgrades = 0;
  const server = createServer((request, response) => {
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{
        id: "mismatch",
        type: "page",
        title: "Wrong page",
        url: "https://other.example/wrong",
        webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/mismatch",
      }]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", () => {
    websocketUpgrades += 1;
  });
  await writeFile(recipePath, `${JSON.stringify({
    portal: "Target mismatch",
    url: "https://portal.example/root",
    pageTarget: {
      matchHosts: ["portal.example"],
      matchPathPrefixes: ["/safe"],
      bootstrap: {
        matchHosts: ["portal.example"],
        matchPathnames: ["/root"],
      },
    },
    actions: ["navigate=/safe"],
  })}\n`, "utf8");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        workerPath,
        "--recipe",
        recipePath,
        "--out",
        artifactDir,
        "--target-id",
        "mismatch",
        "--cdp-endpoint",
        `http://127.0.0.1:${port}`,
      ], { cwd: repoRoot }),
      /does not match the recipe page-target criteria/u,
    );
    assert.equal(websocketUpgrades, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
