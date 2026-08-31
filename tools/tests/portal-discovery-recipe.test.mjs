import assert from "node:assert/strict";
import test from "node:test";

import {
  getRecipeEntryUrl,
  recipeEntryMatchesPageTarget,
  resolvePageTargetBootstrapCriteria,
  resolvePageTargetCriteria,
  validateRecipeTargetMetadata,
  planRecipeActionBudget,
} from "../portal-discovery-recipe.mjs";
import {
  buildBootstrapPreflightCriteria,
  buildPreflightCriteria,
  expandRecipeVariables,
  prepareRecipeForRun,
  recipeVariables,
  validateSelectedRecipeTarget,
} from "../run-portal-discovery.mjs";

const inventoryRecipe = {
  url: "https://config.office.com/officeSettings",
  matchHosts: ["config.office.com", "query.inventory.insights.office.net"],
  matchPathPrefixes: ["/inventory"],
  pageTarget: {
    matchHosts: ["config.office.com"],
    matchPathPrefixes: ["/officeSettings/inventory"],
    bootstrap: {
      matchHosts: ["config.office.com"],
      matchPathnames: ["/officeSettings"],
    },
  },
  actions: ["navigate=https://config.office.com/officeSettings/inventory"],
};

test("page-target validation uses the first navigate entry route", () => {
  assert.equal(getRecipeEntryUrl(inventoryRecipe), "https://config.office.com/officeSettings/inventory");
  assert.equal(recipeEntryMatchesPageTarget(inventoryRecipe), true);
});

test("orchestration uses page-target criteria without changing network capture filters", () => {
  assert.deepEqual(buildPreflightCriteria(inventoryRecipe), {
    matchHosts: ["config.office.com"],
    matchPathPrefixes: ["/officeSettings/inventory"],
    urlPattern: undefined,
    titlePattern: undefined,
    expectedTitlePattern: undefined,
    rejectBodyPattern: undefined,
  });
  assert.deepEqual(resolvePageTargetCriteria(inventoryRecipe), {
    matchHosts: ["config.office.com"],
    matchPathPrefixes: ["/officeSettings/inventory"],
  });
  assert.deepEqual(resolvePageTargetBootstrapCriteria(inventoryRecipe), {
    matchHosts: ["config.office.com"],
    matchPathnames: ["/officeSettings"],
  });
  assert.equal(validateRecipeTargetMetadata(inventoryRecipe).entryUrl, "https://config.office.com/officeSettings/inventory");
  assert.deepEqual(buildBootstrapPreflightCriteria(inventoryRecipe), {
    matchHosts: ["config.office.com"],
    matchPathnames: ["/officeSettings"],
    urlPattern: undefined,
    titlePattern: undefined,
    expectedTitlePattern: undefined,
    rejectBodyPattern: undefined,
  });
  assert.deepEqual(
    { matchHosts: inventoryRecipe.matchHosts, matchPathPrefixes: inventoryRecipe.matchPathPrefixes },
    { matchHosts: ["config.office.com", "query.inventory.insights.office.net"], matchPathPrefixes: ["/inventory"] },
  );
});

test("CLI variables are expanded before recipe-gated target preflight", () => {
  const sourceRecipe = {
    url: "https://${tenant}-admin.sharepoint.com/_layouts/15/online/AdminHome.aspx#/home",
    pageTarget: {
      matchHosts: ["${tenant}-admin.sharepoint.com"],
      matchPathPrefixes: ["/_layouts/15/online/AdminHome.aspx"],
    },
  };
  const recipe = expandRecipeVariables(
    sourceRecipe,
    recipeVariables(sourceRecipe, ["tenant=sharemylabs"]),
  );
  assert.deepEqual(buildPreflightCriteria(recipe), {
    matchHosts: ["sharemylabs-admin.sharepoint.com"],
    matchPathPrefixes: ["/_layouts/15/online/AdminHome.aspx"],
    urlPattern: undefined,
    titlePattern: undefined,
    expectedTitlePattern: undefined,
    rejectBodyPattern: undefined,
  });
  assert.equal(recipe.url, "https://sharemylabs-admin.sharepoint.com/_layouts/15/online/AdminHome.aspx#/home");
});

test("the same expanded recipe is used by capture analysis", () => {
  const recipe = prepareRecipeForRun({
    url: "https://${tenant}-admin.sharepoint.com/",
    actions: ["navigate=https://${tenant}-admin.sharepoint.com/#/contentSecurityPolicy"],
  }, ["tenant=sharemylabs"]);
  assert.equal(recipe.url, "https://sharemylabs-admin.sharepoint.com/");
  assert.deepEqual(recipe.actions, [
    "navigate=https://sharemylabs-admin.sharepoint.com/#/contentSecurityPolicy",
  ]);
});

test("page-target validation fails for an entry route outside its criteria", () => {
  assert.equal(
    recipeEntryMatchesPageTarget({
      ...inventoryRecipe,
      actions: ["navigate=https://config.office.com/officeSettings/health"],
    }),
    false,
  );
});

test("legacy recipes continue to use top-level target criteria", () => {
  const recipe = {
    matchHosts: ["config.office.com"],
    matchPathPrefixes: ["/officeSettings/inventory"],
    actions: ["navigate=https://config.office.com/officeSettings/inventory"],
  };
  assert.deepEqual(resolvePageTargetCriteria(recipe), {
    matchHosts: ["config.office.com"],
    matchPathPrefixes: ["/officeSettings/inventory"],
  });
});

test("explicit page-target criteria fail closed when malformed or empty", () => {
  assert.throws(
    () => resolvePageTargetCriteria({ pageTarget: { matchHosts: [], matchPathPrefixes: ["/inventory"] } }),
    /pageTarget\.matchHosts/,
  );
  assert.throws(
    () => resolvePageTargetCriteria({ pageTarget: { matchHosts: ["config.office.com"], matchPathPrefixes: [null] } }),
    /pageTarget\.matchPathPrefixes must contain non-empty strings/,
  );
  assert.throws(
    () => resolvePageTargetBootstrapCriteria({
      pageTarget: {
        matchHosts: ["config.office.com"],
        matchPathPrefixes: ["/officeSettings/inventory"],
        bootstrap: { matchHosts: ["other.office.com"], matchPathnames: ["/officeSettings"] },
      },
    }),
    /pageTarget\.bootstrap\.matchHosts must be a subset/,
  );
  assert.throws(
    () => resolvePageTargetBootstrapCriteria({
      pageTarget: {
        matchHosts: ["config.office.com"],
        matchPathPrefixes: ["/officeSettings/inventory"],
        bootstrap: { matchHosts: ["config.office.com"], matchPathnames: ["officeSettings"] },
      },
    }),
    /clean absolute pathnames/,
  );
  assert.throws(
    () => validateRecipeTargetMetadata({
      ...inventoryRecipe,
      actions: ["navigate=https://config.office.com/officeSettings/inventory?operation=delete"],
    }),
    /HTTPS without credentials or query/,
  );
});

test("same-origin SPA fragments require explicit page-target metadata", () => {
  const legacyHashRecipe = {
    url: "https://entra.microsoft.com/#blade/Microsoft_AAD_ERM/DashboardBlade",
    matchHosts: ["entra.microsoft.com"],
    matchPathPrefixes: ["/api"],
    actions: [],
  };
  assert.throws(
    () => validateRecipeTargetMetadata(legacyHashRecipe),
    /fragments require an explicit pageTarget/,
  );
  assert.equal(
    validateRecipeTargetMetadata({
      ...legacyHashRecipe,
      pageTarget: {
        matchHosts: ["entra.microsoft.com"],
        matchPathPrefixes: ["/"],
        bootstrap: { matchHosts: ["entra.microsoft.com"], matchPathnames: ["/"] },
      },
    }).entryUrl,
    legacyHashRecipe.url,
  );
});

test("relative same-origin entry routes are normalized before target validation", () => {
  const recipe = {
    url: "https://engage.cloud.microsoft/main/admin",
    pageTarget: {
      matchHosts: ["engage.cloud.microsoft"],
      matchPathPrefixes: ["/main/admin/segmentation"],
      bootstrap: { matchHosts: ["engage.cloud.microsoft"], matchPathnames: ["/main/admin"] },
    },
    actions: ["navigate=/main/admin/segmentation"],
  };
  assert.equal(
    validateRecipeTargetMetadata(recipe).entryUrl,
    "https://engage.cloud.microsoft/main/admin/segmentation",
  );
});

test("selected invalid recipe metadata becomes a structured pre-browser blocker", () => {
  assert.throws(
    () => validateSelectedRecipeTarget({
      url: "https://config.office.com/officeSettings",
      matchHosts: ["config.office.com"],
      matchPathPrefixes: ["/api"],
      actions: ["navigate=https://config.office.com/officeSettings/policy"],
    }),
    (error) => error.code === "recipe-target-invalid"
      && /pageTarget/.test(error.message)
      && /before allocating browser or ledger work/.test(error.blocker.remediation),
  );
});

test("action budget counts the mandatory orchestration seed", () => {
  const recipe = { actions: Array.from({ length: 32 }, () => "capture=test"), maxActions: 33 };
  assert.equal(planRecipeActionBudget(recipe).countedActions, 33);
  assert.throws(
    () => planRecipeActionBudget({ ...recipe, actions: [...recipe.actions, "capture=overflow"] }),
    (error) => error.code === "action-budget-exceeded"
      && error.blocker.categories.recipeActions === 33
      && error.blocker.categories.mandatoryOrchestrationActions === 1,
  );
});
