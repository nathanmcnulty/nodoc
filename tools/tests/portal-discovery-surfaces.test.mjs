import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildPortfolioManifest } from "../portal-discovery-control-plane.mjs";
import { calculateUnresolvedFrontier, scheduleFrontier, validateFrontier } from "../portal-discovery-frontier.mjs";
import { materializeSurfaces, validateSurfaces } from "../portal-discovery-surfaces.mjs";
import { buildSpecInventory, repoRoot } from "../spec-quality-lib.mjs";

test("checked-in surfaces cover every spec and materialize source mappings without implying approval", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "tools", "portal-discovery-portfolio.json"), "utf8"));
  const inventory = await buildSpecInventory();
  const surfaces = await materializeSurfaces(manifest, inventory);
  assert.deepEqual(new Set(surfaces.flatMap((surface) => surface.mappings.map((mapping) => mapping.specId))), new Set(inventory.map((spec) => spec.specId)));
  const teams = surfaces.find((surface) => surface.id === "teams");
  assert.equal(teams.status, "partial");
  assert.ok(teams.mappings[0].apiOwnerServers.length);
  assert.ok(teams.mappings[0].recipes.length);
  assert.ok(teams.mappings[0].recipes.some((recipe) => recipe.approvals.length));
  assert.deepEqual(teams.limits.role, { status: "unknown" });
  assert.ok(teams.workflows.every((workflow) => workflow.status === "unassessed" && workflow.uiStates === "unknown"));
  assert.equal(surfaces.find((surface) => surface.id === "azure").status, "unassessed");
  assert.equal(surfaces.find((surface) => surface.id === "azure").apiOwnerStatus, "unknown");
});

test("surface validation rejects missing mappings, unknown specs and unsupported evidence claims", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "tools", "portal-discovery-portfolio.json"), "utf8"));
  const inventory = await buildSpecInventory();
  const mutate = (fn) => { const copy = structuredClone(manifest); fn(copy); return copy; };
  assert.throws(() => validateSurfaces(mutate((value) => { value.surfaces[0].specIds = []; value.surfaces[0].status = "partial"; }), inventory), /explicit gap status/u);
  assert.throws(() => validateSurfaces(mutate((value) => { value.surfaces[0].specIds = ["not-a-spec"]; }), inventory), /unknown specId/u);
  assert.throws(() => validateSurfaces(mutate((value) => { value.surfaces[0].limits = { role: { status: "observed", value: "administrator" } }; }), inventory), /evidence reference/u);
  assert.throws(() => validateSurfaces(mutate((value) => { value.surfaces[0].limits = { role: { status: "unknown", value: "administrator" } }; }), inventory), /cannot claim/u);
  assert.throws(() => validateSurfaces(mutate((value) => { value.surfaces[0].status = "complete"; }), inventory), /gap status/u);
  assert.throws(() => validateSurfaces(mutate((value) => { value.surfaces = value.surfaces.filter((surface) => surface.id !== "teams"); }), inventory), /missing from the surface inventory/u);
});

test("materialized portfolio gaps and unassessed states prevent saturation without authorizing capture", async () => {
  const portfolio = await buildPortfolioManifest();
  const frontier = calculateUnresolvedFrontier({ portfolio, discovery: { health: { complete: true, available: true } } });
  validateFrontier(frontier);
  assert.ok(frontier.items.some((item) => item.class === "portfolio-gap" && item.subject === "azure" && item.route === "manual"));
  assert.ok(frontier.items.some((item) => item.class === "unassessed-workflow" && item.subject.startsWith("teams:")));
  const schedule = scheduleFrontier(frontier, { saturation: "reached" });
  assert.notEqual(schedule.terminal, "saturated-complete");
  assert.ok(schedule.selected.every((item) => item.action === "recommend-offline-review"));
});
