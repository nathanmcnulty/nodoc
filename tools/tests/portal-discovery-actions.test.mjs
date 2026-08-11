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
  classifyCaptureRequest,
  DocumentNavigationAuthorization,
  estimateReplayExpansion,
  resolveStrictNavigationUrl,
  normalizeTargetCriteria,
  validateSelectedReplayRouteTemplates,
  validatePostNavigationUrl,
  validateEffectiveActions,
} from "../portal-discovery-actions.mjs";
import { planActionBudget } from "../portal-discovery-action-budget.mjs";
import { deriveActionEligibility } from "../discovery-capture-policy.mjs";
import { validateRecipeTargetMetadata } from "../portal-discovery-recipe.mjs";

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
    "/export",
    "/safe/%2e%2e/admin",
    "/safe/%252e%252e/admin",
    "/safe/%2fadmin",
    "/safe/%252fadmin",
    "/safe/%3fquery",
    "/safe/%253fquery",
    "/safe/%25%32%66admin",
    "/safe/%252525252",
  ];
  for (const route of unsafeRoutes) {
    assert.throws(
      () => resolveStrictNavigationUrl(route, "https://portal.example/root", {
        criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/read"] },
      }),
      /HTTPS URL without credentials|active-GET safety|page-target criteria|unsafe|ambiguous/u,
    );
  }
  assert.equal(
    resolveStrictNavigationUrl("/read/items", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/read"] },
    }),
    "https://portal.example/read/items",
  );
  assert.equal(
    resolveStrictNavigationUrl("/read/%20items", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/read"] },
    }),
    "https://portal.example/read/%20items",
  );
  assert.throws(
    () => validateEffectiveActions(
      buildEffectiveActions({
        recipeActions: ["click-href=/export"],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/root",
      }),
      { rootUrl: "https://portal.example/root" },
    ),
    /active-GET safety|non-destructive, non-empty/u,
  );
  assert.throws(
    () => validateEffectiveActions(
      buildEffectiveActions({
        recipeActions: ["click-href=   "],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/root",
      }),
      { rootUrl: "https://portal.example/root" },
    ),
    /non-empty value/u,
  );
  for (const probe of ["probe-get=/safe?x=1", "probe-get=/safe/%2e%2e/admin"]) {
    assert.throws(
      () => validateEffectiveActions(
        buildEffectiveActions({
          recipeActions: [probe],
          includeInitialNavigation: true,
          initialUrl: "https://portal.example/safe",
        }),
        { rootUrl: "https://portal.example/safe" },
      ),
      /query|traversal|fragment|page-target|ownership-ambiguous/u,
    );
  }
  assert.deepEqual(normalizeTargetCriteria({
    matchHosts: ["portal.example"],
    matchPathnames: ["/root"],
  }), {
    matchHosts: ["portal.example"],
    matchPathPrefixes: [],
    matchPathnames: ["/root"],
  });
  assert.equal(
    resolveStrictNavigationUrl("/root", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
    }),
    "https://portal.example/root",
  );
  assert.throws(
    () => resolveStrictNavigationUrl("/wrong", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
    }),
    /page-target criteria/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/safe-evil", "https://portal.example/safe", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    }),
    /page-target criteria/u,
  );
  assert.throws(
    () => validatePostNavigationUrl(
      "https://config.office.com/officeSettings",
      "https://config.office.com/officeSettings",
      { criteria: { matchHosts: ["config.office.com"], matchPathPrefixes: ["/officeSettings/inventory"] } },
    ),
    /page-target criteria/u,
  );
});

test("post-navigation guard rejects redirect escapes and active/page-target redirects", () => {
  assert.equal(
    validatePostNavigationUrl("https://portal.example/safe", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    }),
    "https://portal.example/safe",
  );
  assert.throws(
    () => validatePostNavigationUrl("https://other.example/safe", "https://portal.example/root"),
    /HTTPS URL without credentials/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/export", "https://portal.example/root"),
    /active-GET safety/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/wrong", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    }),
    /page-target criteria/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/wrong", "https://portal.example/root", {
      criteria: { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
    }),
    /page-target criteria/u,
  );
});

test("legacy host and path criteria remain effective for every worker navigation", () => {
  const actions = buildEffectiveActions({
    recipeActions: [
      "navigate=/safe",
      "navigate=/safe/items",
    ],
    includeInitialNavigation: true,
    initialUrl: "https://portal.example/safe",
  });

  assert.doesNotThrow(() => validateEffectiveActions(actions, {
    rootUrl: "https://portal.example/safe",
    pageTarget: {
      matchHosts: ["portal.example"],
      matchPathPrefixes: ["/safe"],
    },
    enforcePageTargetForAll: true,
  }));
  assert.throws(
    () => validateEffectiveActions(buildEffectiveActions({
      recipeActions: ["navigate=/admin"],
      includeInitialNavigation: true,
      initialUrl: "https://portal.example/safe",
    }), {
      rootUrl: "https://portal.example/safe",
      pageTarget: {
        matchHosts: ["portal.example"],
        matchPathPrefixes: ["/safe"],
      },
      enforcePageTargetForAll: true,
    }),
    /page-target criteria/u,
  );
});

test("relative navigation is guarded statically and resolves against the current page at execution", () => {
  const validated = validateEffectiveActions(buildEffectiveActions({
    recipeActions: [
      "navigate=child",
    ],
    includeInitialNavigation: true,
    initialUrl: "https://portal.example/safe/",
  }), {
    rootUrl: "https://portal.example/safe/",
    pageTarget: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    enforcePageTargetForAll: true,
  });

  test("sequential declared navigation routes resolve against the preceding effective URL", () => {
    const validated = validateEffectiveActions(buildEffectiveActions({
      recipeActions: ["navigate=/safe/", "navigate=child"],
      includeInitialNavigation: true,
      initialUrl: "https://portal.example/root",
    }), {
      rootUrl: "https://portal.example/root",
      pageTarget: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
      bootstrapTarget: { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
      enforcePageTargetForAll: true,
    });
    assert.equal(validated[1].resolvedUrl, "https://portal.example/safe/");
    assert.equal(validated[2].resolvedUrl, "https://portal.example/safe/child");
  });

  test("document authorization admits only the currently selected route", () => {
    const authorization = new DocumentNavigationAuthorization(
      "https://portal.example/root",
      "https://portal.example/root",
      { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
    );
    assert.equal(authorization.validate("https://portal.example/root"), "https://portal.example/root");
    assert.throws(
      () => authorization.validate("https://portal.example/redirected"),
      /authorized|criteria/u,
    );
    authorization.select("https://portal.example/safe", {
      criteria: { matchHosts: ["portal.example"], matchPathnames: ["/safe"] },
    });
    assert.equal(authorization.validate("https://portal.example/safe"), "https://portal.example/safe");
    assert.throws(() => authorization.validate("https://portal.example/root"), /authorized|criteria/u);
  });

  test("capture request decisions are zero-effect for unsafe request classes", () => {
    const authorization = new DocumentNavigationAuthorization(
      "https://portal.example/root",
      "https://portal.example/root",
      { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
    );
    const unsafeRequests = [
      { method: "POST", resourceType: "Document", url: "https://portal.example/root" },
      { method: "GET", resourceType: "Document", url: "https://portal.example/redirected" },
      { method: "GET", resourceType: "WebSocket", url: "https://portal.example/root" },
      { method: "GET", resourceType: "Ping", url: "https://portal.example/root" },
      { method: "GET", resourceType: "Other", url: "https://portal.example/root" },
      { method: "GET", resourceType: "EventSource", url: "https://portal.example/root" },
      { method: "GET", resourceType: "Script", url: "https://portal.example/delete" },
      { method: "GET", resourceType: "Script", url: "https://portal.example/root?query=1" },
      { method: "GET", resourceType: "Script", url: "https://portal.example/root#fragment" },
      { method: "GET", resourceType: "Script", url: "https://other.example/root" },
      { method: "GET", resourceType: "Script", url: "https://portal.example/%25252e%25252e/delete" },
    ];
    for (const request of unsafeRequests) {
      assert.equal(classifyCaptureRequest(request, {
        authorization,
        rootUrl: "https://portal.example/root",
      }).allowed, false, JSON.stringify(request));
    }
    assert.deepEqual(classifyCaptureRequest({
      method: "GET",
      resourceType: "Stylesheet",
      url: "https://portal.example/assets/site.css",
    }, {
      authorization,
      rootUrl: "https://portal.example/root",
    }), {
      allowed: true,
      code: "allowed-subresource",
      url: "https://portal.example/assets/site.css",
    });
  });
  test("authorized request hosts remain separate from document ownership", () => {
    const authorization = new DocumentNavigationAuthorization(
      "https://portal.example/root",
      "https://portal.example/root",
      { matchHosts: ["portal.example"], matchPathnames: ["/root"] },
    );
    const requestCriteria = { matchHosts: ["api.example"], matchPathPrefixes: ["/inventory"] };
    assert.equal(classifyCaptureRequest({
      method: "GET",
      resourceType: "XHR",
      url: "https://api.example/inventory/items",
    }, {
      authorization,
      requestCriteria,
      rootUrl: "https://portal.example/root",
    }).allowed, true);
    assert.equal(classifyCaptureRequest({
      method: "GET",
      resourceType: "XHR",
      url: "https://api.example/delete",
    }, {
      authorization,
      requestCriteria,
      rootUrl: "https://portal.example/root",
    }).allowed, false);
  });
  test("relative routes cannot bypass enforced ownership criteria", () => {
    assert.throws(() => validateEffectiveActions(buildEffectiveActions({
      recipeActions: ["navigate=child"],
      includeInitialNavigation: true,
      initialUrl: "https://portal.example/root/",
    }), {
      rootUrl: "https://portal.example/root/",
      pageTarget: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
      bootstrapTarget: { matchHosts: ["portal.example"], matchPathnames: ["/root/"] },
      enforcePageTargetForAll: true,
    }), (error) => error.code === "page-target-mismatch");
  });
  assert.equal(validated[1].relative, true);
  assert.equal(validated[1].resolvedUrl, "https://portal.example/safe/child");
  for (const value of ["../admin", "%2e%2e/admin", "child?query=blocked", "child#fragment"]) {
    assert.throws(
      () => validateEffectiveActions(buildEffectiveActions({
        recipeActions: [`navigate=${value}`],
        includeInitialNavigation: true,
        initialUrl: "https://portal.example/safe/",
      }), { rootUrl: "https://portal.example/safe/" }),
      /forbidden|encoded|query|fragment/u,
    );
  }
});

test("all click-affected page and frame URLs share the same sink policy", () => {
  const affectedTargets = [
    { label: "root", url: "https://portal.example/safe" },
    { label: "iframe", url: "https://other.example/safe" },
    { label: "popup", url: "https://portal.example/safe/child" },
  ];
  assert.equal(
    affectedTargets.find((target) => target.label === "popup").url,
    validatePostNavigationUrl("https://portal.example/safe/child", "https://portal.example/safe", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    }),
  );
  assert.throws(
    () => validatePostNavigationUrl(
      affectedTargets.find((target) => target.label === "iframe").url,
      "https://portal.example/safe",
      { criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] } },
    ),
    /HTTPS URL without credentials/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/export", "https://portal.example/safe"),
    /active-GET safety/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/safe/%252e%252e/admin", "https://portal.example/safe"),
    /unsafe|ambiguous/u,
  );
  assert.throws(
    () => validatePostNavigationUrl("https://portal.example/export%", "https://portal.example/safe"),
    /unsafe|encoding/u,
  );
});

test("terminal final URL guard catches a delayed redirect before summary success", () => {
  let finalUrl = "https://portal.example/safe";
  const readFinalUrl = () => finalUrl;
  assert.equal(
    validatePostNavigationUrl(readFinalUrl(), "https://portal.example/safe", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    }),
    "https://portal.example/safe",
  );
  finalUrl = "https://other.example/export";
  assert.throws(
    () => validatePostNavigationUrl(readFinalUrl(), "https://portal.example/safe", {
      criteria: { matchHosts: ["portal.example"], matchPathPrefixes: ["/safe"] },
    }),
    /HTTPS URL without credentials/u,
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
      targetUrl: "https://portal.example/safe",
      controls: [
        { text: "Read" },
        { ariaLabel: "Read" },
      ],
    }],
  );
  assert.equal(eligibility.status, "ambiguous");
  assert.equal(eligibility.candidateCount, 2);
  assert.equal(
    deriveActionEligibility(
      { type: "click-label", scope: "root", value: "Read" },
      [{ sessionId: "root", targetType: "page", error: "detached during inventory" }],
    ).status,
    "unknown",
  );
  assert.equal(
    deriveActionEligibility(
      { type: "click-contains", scope: "root", value: "del" },
      [{
        sessionId: "root",
        targetType: "page",
        targetUrl: "https://portal.example/safe",
        controls: [{ text: "Delete account" }],
      }],
    ).candidateCount,
    0,
  );
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
  const exactBudget = planActionBudget(
    { url: recipe.url, actions: ["capture=recipe"] },
    { cliActions: ["wait-ms=1"] },
  );
  assert.deepEqual(exactBudget.categories, {
    recipeActions: 1,
    cliActions: 1,
    mandatoryOrchestrationActions: 1,
    expandedReplayActions: 0,
  });

  assert.equal(exactBudget.countedActions, 3);
  assert.throws(
    () => planActionBudget({
      url: recipe.url,
      actions: ["replay-seeded-routes=items"],
      seedRouteGroups: { items: { limit: Number.POSITIVE_INFINITY } },
    }),
    /bounded/u,
  );
});

test("query-bearing replay templates remain explicitly blocked", () => {
  assert.throws(
    () => validateRecipeTargetMetadata({
      url: "https://security.microsoft.com/incidents",
      actions: ["replay-seeded-routes=urls"],
      seedRouteGroups: {
        urls: {
          limit: 2,
          routeTemplates: ["https://security.microsoft.com/url/overview?url={encoded}"],
        },
      },
    }),
    /query|active-GET/u,
  );
});

test("unselected invalid replay groups do not block non-replay actions", () => {
  assert.doesNotThrow(() => validateSelectedReplayRouteTemplates({
    ignored: {
      limit: 1,
      routeTemplates: ["https://portal.example/export?mode=blocked"],
    },
  }, buildEffectiveActions({ recipeActions: ["capture=only"] }), {
    rootUrl: "https://portal.example/root",
  }));
  assert.doesNotThrow(() => validateSelectedReplayRouteTemplates({
    selected: {
      limit: 2,
      routeTemplates: ["/items/{id}", "/items/{value}"],
    },
  }, buildEffectiveActions({ recipeActions: ["replay-seeded-routes=selected"] }), {
    rootUrl: "https://portal.example/root",
  }));
});

test("direct worker rejects selected unsafe replay templates before contacting CDP", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-selected-replay-template-"));
  const recipePath = path.join(rootDir, "recipe.json");
  const artifactDir = path.join(rootDir, "artifacts");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(500);
    response.end();
  });
  await writeFile(recipePath, `${JSON.stringify({
    portal: "Selected replay template",
    url: "https://portal.example/root",
    actions: ["replay-seeded-routes=unsafe"],
    seedRouteGroups: {
      unsafe: {
        limit: 2,
        routeTemplates: ["https://portal.example/export?mode=blocked"],
      },
      ignored: {
        limit: 2,
        routeTemplates: ["https://other.example/wrong"],
      },
    },
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
        "--cdp-endpoint",
        `http://127.0.0.1:${port}`,
      ], { cwd: repoRoot }),
      /seedRouteGroups\.unsafe|query|active-GET/u,
    );
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("CLI replay limit is included in the pre-CDP authorization ceiling", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-cli-replay-budget-"));
  const recipePath = path.join(rootDir, "recipe.json");
  const artifactDir = path.join(rootDir, "artifacts");
  const server = createServer((_request, response) => {
    response.writeHead(500);
    response.end();
  });
  await writeFile(recipePath, `${JSON.stringify({
    portal: "CLI replay budget",
    url: "https://portal.example/root",
    maxActions: 3,
    seedLinkLimit: 1,
    actions: ["replay-seeded-links=all"],
  })}\n`, "utf8");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let requests = 0;
  server.on("request", () => { requests += 1; });
  const { port } = server.address();
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        workerPath,
        "--recipe",
        recipePath,
        "--seed-link-limit",
        "10",
        "--out",
        artifactDir,
        "--cdp-endpoint",
        `http://127.0.0.1:${port}`,
      ], { cwd: repoRoot }),
      /Action budget exceeded/u,
    );
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
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

test("no-target-id legacy wrong-path navigation is rejected before target creation", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-legacy-no-target-"));
  const recipePath = path.join(rootDir, "recipe.json");
  const artifactDir = path.join(rootDir, "artifacts");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(500);
    response.end();
  });
  await writeFile(recipePath, `${JSON.stringify({
    portal: "Structured no target",
    url: "https://portal.example/safe",
    pageTarget: {
      matchHosts: ["portal.example"],
      matchPathPrefixes: ["/safe"],
    },
    actions: ["navigate=/admin"],
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
        "--cdp-endpoint",
        `http://127.0.0.1:${port}`,
      ], { cwd: repoRoot }),
      /page-target criteria/u,
    );
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("worker rejects unsafe CLI navigation and click overrides before contacting CDP", async () => {
  const unsafeOverrides = [
    "navigate=https://other.example/read",
    "navigate=https://portal.example/root?query=blocked",
    "navigate=https://user:password@portal.example/root",
    "navigate=https://portal.example/root#fragment",
    "navigate=/export%",
    "click-label=   DELETE   ",
    "click-contains=   ",
    "click-href=   ",
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

test("worker rejects legacy target-id ownership mismatches and missing target URLs", async () => {
  const cases = [
    {
      target: {
        type: "page",
        url: "https://other.example/wrong",
        title: "Wrong host",
      },
      expected: /does not match the recipe page-target criteria|initial navigation/u,
    },
    {
      target: {
        type: "page",
        title: "Missing URL",
      },
      expected: /not a URL-bearing page target/u,
    },
  ];
  for (const { target, expected } of cases) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-legacy-target-"));
    const recipePath = path.join(rootDir, "recipe.json");
    const artifactDir = path.join(rootDir, "artifacts");
    let websocketUpgrades = 0;
    const server = createServer((request, response) => {
      if (request.url === "/json/list") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify([{
          id: "legacy-mismatch",
          webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/legacy-mismatch",
          ...target,
        }]));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.on("upgrade", () => { websocketUpgrades += 1; });
    await writeFile(recipePath, `${JSON.stringify({
      portal: "Legacy target mismatch",
      url: "https://portal.example/safe",
      matchHosts: ["portal.example"],
      matchPathPrefixes: ["/safe"],
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
          "legacy-mismatch",
          "--cdp-endpoint",
          `http://127.0.0.1:${port}`,
        ], { cwd: repoRoot }),
        expected,
      );
      assert.equal(websocketUpgrades, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(rootDir, { recursive: true, force: true });
    }
  }
});
