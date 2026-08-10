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
import { buildBootstrapPreflightCriteria, buildPreflightCriteria } from "../run-portal-discovery.mjs";

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
    /HTTPS URL without credentials, query, or fragment/,
  );
});

test("action budget counts the mandatory orchestration seed", () => {
  const recipe = { actions: Array.from({ length: 31 }, () => "capture=test"), maxActions: 32 };
  assert.equal(planRecipeActionBudget(recipe).countedActions, 32);
  assert.throws(
    () => planRecipeActionBudget({ ...recipe, actions: [...recipe.actions, "capture=overflow"] }),
    (error) => error.code === "action-budget-exceeded"
      && error.blocker.categories.recipeActions === 32
      && error.blocker.categories.mandatoryOrchestrationActions === 1,
  );
});
