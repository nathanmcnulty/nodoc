import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const recipeDirectory = path.join(repoRoot, "tools", "capture-recipes");
const commonMenuUrl =
  "https://entra.microsoft.com/#blade/Microsoft_Azure_PIMCommon/CommonMenuBlade";
const rootHref =
  "#view/Microsoft_Azure_PIMCommon/CommonMenuBlade/~/aadmigratedroles";
const featureHrefs = [
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/aadoverview/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/MyActions/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/PendingRequest/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/ApproveRequests/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/Reviews/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/roles/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/members/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/Alerts/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/AccessReviews/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/aaddiscovery/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/RoleSettings/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/Audit/resourceId//resourceType/tenant/provider/aadroles",
  "#view/Microsoft_Azure_PIMCommon/ResourceMenuBlade/~/MyAudit/resourceId//resourceType/tenant/provider/aadroles",
];

async function readRecipe(name) {
  return JSON.parse(await readFile(path.join(recipeDirectory, name), "utf8"));
}

test("Entra PIM deep recipe uses observed href branches only", async () => {
  const recipe = await readRecipe("entra-pim-deep.json");
  const actions = recipe.actions;
  const clickActions = actions.filter((action) => action.type === "click-href");
  const featureClickActions = clickActions.filter((action) => action.value !== rootHref);

  assert.equal(recipe.url, commonMenuUrl);
  assert.equal(recipe.captureScripts, false);
  assert.equal(clickActions.length, featureHrefs.length * 2);
  assert.deepEqual(
    [...new Set(featureClickActions.map((action) => action.value))].sort(),
    [...featureHrefs].sort(),
  );
  assert.ok(actions.every((action) => (
    typeof action !== "string"
    && action.type !== "click-label"
    && action.type !== "click-contains"
    && action.scope !== "iframe"
  )));
  assert.ok(clickActions.every((action) => action.required && action.scope === "root"));
  assert.ok(actions
    .filter((action) => action.type === "wait-ms")
    .every((action) => Number(action.value) > 0 && Number(action.value) <= 3000));

  for (let index = 0; index < featureHrefs.length; index += 1) {
    const branch = actions.slice(index * 7, (index + 1) * 7);
    assert.equal(branch[0].type, "navigate");
    assert.equal(branch[0].value, commonMenuUrl);
    assert.equal(branch[2].type, "click-href");
    assert.equal(branch[2].value, rootHref);
    assert.equal(branch[4].type, "click-href");
    assert.equal(branch[4].value, featureHrefs[index]);
    assert.equal(branch[6].type, "capture");
  }
});

test("Entra PIM seeded replay is bounded and href-filtered", async () => {
  const recipe = await readRecipe("entra-pim-seeded-replay.json");
  assert.deepEqual(recipe.seedLinkContains, ["Microsoft_Azure_PIMCommon/ResourceMenuBlade/~"]);
  assert.ok(recipe.seedLinkLimit >= featureHrefs.length);
  assert.deepEqual(recipe.actions, [{
    type: "replay-seeded-links",
    value: "all",
    required: true,
  }]);
});
