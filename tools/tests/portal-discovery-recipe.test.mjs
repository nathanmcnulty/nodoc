import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  canonicalizeRecipeForDispatch,
  getRecipeEntryUrl,
  recipeEntryMatchesPageTarget,
  resolvePageTargetBootstrapCriteria,
  resolvePageTargetCriteria,
  validateRecipeTargetMetadata,
  planRecipeActionBudget,
} from "../portal-discovery-recipe.mjs";
import { buildCaptureWorkerArgs, buildBootstrapPreflightCriteria, buildPreflightCriteria } from "../run-portal-discovery.mjs";
import { buildRecipeAssignmentId, recipeDigest } from "../portal-discovery-dispatch.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

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

async function readCaptureRecipe(name) {
  return JSON.parse(await readFile(new URL(`../capture-recipes/${name}`, import.meta.url), "utf8"));
}

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

test("legacy Entra root fragments normalize to the browser origin before dispatch", async () => {
  for (const [name, networkPath] of [
    ["entra-b2c-deep.json", "/api"],
    ["entra-idgov-deep.json", "/accessReviews"],
  ]) {
    const recipe = await readCaptureRecipe(name);
    const metadata = canonicalizeRecipeForDispatch(recipe);
    assert.equal(metadata.entryUrl, "https://entra.microsoft.com/");
    assert.equal(metadata.rootUrl, "https://entra.microsoft.com/");
    assert.equal(metadata.recipe.url, "https://entra.microsoft.com/");
    assert.match(recipe.url, /#/u);
    assert.equal(metadata.entryUrl.includes("#"), false);
    assert.deepEqual(metadata.featureCriteria.matchPathPrefixes, ["/"]);
    assert.deepEqual(recipe.matchPathPrefixes, [networkPath]);
  }
});

test("active root fragments are rejected before browser-entry normalization", () => {
  for (const hasBootstrap of [false, true]) {
    for (const fragment of ["#/export", "#/save"]) {
      assert.throws(
        () => validateRecipeTargetMetadata({
          url: `https://entra.microsoft.com/${fragment}`,
          pageTarget: {
            matchHosts: ["entra.microsoft.com"],
            matchPathPrefixes: ["/"],
            ...(hasBootstrap ? {
              bootstrap: {
                matchHosts: ["entra.microsoft.com"],
                matchPathnames: ["/"],
              },
            } : {}),
          },
          actions: ["capture=surface"],
        }),
        /declared root URL is not a safe same-origin GET \(active-get-denied\)/,
      );
    }
  }
});

test("explicit passive-fragment navigate routes remain strict", () => {
  assert.throws(
    () => validateRecipeTargetMetadata({
      url: "https://example.com/",
      pageTarget: {
        matchHosts: ["example.com"],
        matchPathPrefixes: ["/"],
      },
      actions: ["navigate=https://example.com/#home"],
    }),
    /recipe navigate action 0 must be an HTTPS URL without fragment/,
  );
});

test("declared root fragments remain strict when any explicit navigate exists", async () => {
  const recipe = {
    url: "https://example.com/#home",
    pageTarget: {
      matchHosts: ["example.com"],
      matchPathPrefixes: ["/"],
    },
    actions: ["navigate=https://example.com/"],
  };
  assert.throws(
    () => validateRecipeTargetMetadata(recipe),
    /declared root URL must be an HTTPS URL without credentials, query, or fragment when explicit navigation is configured/,
  );

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-explicit-root-digest-"));
  try {
    const cleanVariant = { ...recipe, url: "https://example.com/" };
    const fragmentPath = path.join(tempDir, "fragment.json");
    const cleanPath = path.join(tempDir, "clean.json");
    await Promise.all([
      writeFile(fragmentPath, `${JSON.stringify(recipe)}\n`, "utf8"),
      writeFile(cleanPath, `${JSON.stringify(cleanVariant)}\n`, "utf8"),
    ]);
    assert.notEqual(await recipeDigest(fragmentPath), await recipeDigest(cleanPath));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("worker rejects every later fragment navigate before Page.navigate", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-worker-navigation-"));
  try {
    for (const hasBootstrap of [false, true]) {
      for (const fragment of ["#home", "#/export"]) {
        const recipe = {
          url: "https://example.com/",
          pageTarget: {
            matchHosts: ["example.com"],
            matchPathPrefixes: ["/"],
            ...(hasBootstrap ? {
              bootstrap: {
                matchHosts: ["example.com"],
                matchPathnames: ["/"],
              },
            } : {}),
          },
          actions: [
            "capture=surface",
            `navigate=https://example.com/${fragment}`,
          ],
        };
        const recipePath = path.join(tempDir, `${hasBootstrap ? "bootstrap" : "legacy"}-${fragment.slice(1).replaceAll("/", "-")}.json`);
        const outputPath = path.join(tempDir, `${hasBootstrap ? "bootstrap" : "legacy"}-${fragment.slice(1).replaceAll("/", "-")}.out`);
        await writeFile(recipePath, `${JSON.stringify(recipe)}\n`, "utf8");
        await assert.rejects(
          execFileAsync(process.execPath, [
            path.join(repoRoot, "tools", "cdp-deep-capture.mjs"),
            "--recipe",
            recipePath,
            "--url",
            "https://example.com/",
            "--portal",
            "test",
            "--out",
            outputPath,
          ]),
          (error) => error.code === 1
            && /recipe navigate action 1/u.test(error.stderr),
        );
      }
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("canonical root URL is passed to the capture worker command", () => {
  const args = buildCaptureWorkerArgs({
    recipePath: "tools/capture-recipes/entra-b2c-deep.json",
    artifacts: "artifacts",
    targetId: "page-1",
    cdpEndpoint: "http://127.0.0.1:9222",
    rootUrl: "https://entra.microsoft.com/",
    finalizationTimeoutMs: 30000,
  });
  const urlIndex = args.indexOf("--url");
  assert.equal(args[urlIndex + 1], "https://entra.microsoft.com/");
});

test("permitted passive root variants share identity while safety changes do not", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-recipe-digest-"));
  try {
    const recipe = await readCaptureRecipe("entra-b2c-deep.json");
    const passiveVariant = {
      ...recipe,
      url: "https://entra.microsoft.com/#home",
    };
    const safetyVariant = {
      ...recipe,
      matchPathPrefixes: ["/different-safety-scope"],
    };
    const paths = {
      recipe: path.join(tempDir, "recipe.json"),
      passive: path.join(tempDir, "passive.json"),
      safety: path.join(tempDir, "safety.json"),
    };
    await Promise.all([
      writeFile(paths.recipe, `${JSON.stringify(recipe)}\n`, "utf8"),
      writeFile(paths.passive, `${JSON.stringify(passiveVariant)}\n`, "utf8"),
      writeFile(paths.safety, `${JSON.stringify(safetyVariant)}\n`, "utf8"),
    ]);
    const [firstDigest, passiveDigest, safetyDigest] = await Promise.all([
      recipeDigest(paths.recipe),
      recipeDigest(paths.passive),
      recipeDigest(paths.safety),
    ]);
    assert.equal(firstDigest, passiveDigest);
    assert.notEqual(firstDigest, safetyDigest);
    const firstAssignment = buildRecipeAssignmentId({
      specId: "entra-b2c",
      endpoint: "entra.microsoft.com:443",
      digest: firstDigest,
    });
    const passiveAssignment = buildRecipeAssignmentId({
      specId: "entra-b2c",
      endpoint: "entra.microsoft.com:443",
      digest: passiveDigest,
    });
    const safetyAssignment = buildRecipeAssignmentId({
      specId: "entra-b2c",
      endpoint: "entra.microsoft.com:443",
      digest: safetyDigest,
    });
    assert.equal(firstAssignment, passiveAssignment);
    assert.notEqual(firstAssignment, safetyAssignment);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
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
  assert.throws(
    () => validateRecipeTargetMetadata({
      ...inventoryRecipe,
      pageTarget: {
        ...inventoryRecipe.pageTarget,
        bootstrap: { ...inventoryRecipe.pageTarget.bootstrap },
      },
      actions: ["navigate=https://config.office.com/officeSettings/inventory#fragment"],
    }),
    /recipe navigate action 0 must be an HTTPS URL without fragment/,
  );
  assert.throws(
    () => validateRecipeTargetMetadata({
      ...inventoryRecipe,
      url: "https://config.office.com/officeSettings#home",
      actions: ["navigate=https://config.office.com/officeSettings/inventory"],
    }),
    /declared root URL must be an HTTPS URL without credentials, query, or fragment when explicit navigation is configured/,
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
