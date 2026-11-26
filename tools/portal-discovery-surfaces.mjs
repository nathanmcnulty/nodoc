import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getCaptureRecipes } from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";

const statuses = new Set(["partial", "gap", "unassessed", "unavailable"]);
const gapStatuses = new Set(["gap", "unassessed", "unavailable"]);
const dimensions = ["role", "license", "feature"];

export function validateSurfaces(manifest, inventory) {
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) throw new Error("Portfolio requires a non-empty surfaces inventory.");
  const known = new Set(inventory.map((entry) => entry.specId));
  const mapped = new Set();
  const ids = new Set();
  for (const surface of manifest.surfaces) {
    const id = surface.id;
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate surface id ${id}.`);
    ids.add(id);
    for (const field of ["name", "productArea"]) {
      if (typeof surface[field] !== "string" || !surface[field].trim()) throw new Error(`${id}: ${field} is required.`);
    }
    if (!Array.isArray(surface.portalUrls) || surface.portalUrls.length === 0 || surface.portalUrls.some((url) => typeof url !== "string" || !/^https:\/\/[a-z0-9{}.-]+(?::\d+)?(?:\/[a-z0-9/-]*)?$/u.test(url))) throw new Error(`${id}: canonical HTTPS portal URLs are required.`);
    if (!Array.isArray(surface.specIds) || new Set(surface.specIds).size !== surface.specIds.length) throw new Error(`${id}: specIds must be an array without duplicates.`);
    for (const specId of surface.specIds) {
      if (!known.has(specId)) throw new Error(`${id}: unknown specId ${specId}.`);
      mapped.add(specId);
    }
    if (!statuses.has(surface.status) || (surface.specIds.length === 0 && !gapStatuses.has(surface.status))) throw new Error(`${id}: an unmapped surface requires an explicit gap status.`);
    if (!Array.isArray(surface.workflows) || surface.workflows.length === 0 || surface.workflows.some((value) => typeof value !== "string" || !value.trim())) throw new Error(`${id}: workflows must identify unassessed native states.`);
    for (const dimension of dimensions) {
      const limit = surface.limits?.[dimension] ?? manifest.surfaceDefaults?.limits?.[dimension];
      if (!limit || !["unknown", "observed"].includes(limit.status)) throw new Error(`${id}: ${dimension} limit must be unknown or observed.`);
      if (limit.status === "observed" && (typeof limit.evidence !== "string" || !limit.evidence.trim() || typeof limit.value !== "string" || !limit.value.trim())) throw new Error(`${id}: observed ${dimension} limit requires a value and evidence reference.`);
      if (limit.status === "unknown" && (limit.evidence !== undefined || limit.value !== undefined)) throw new Error(`${id}: unknown ${dimension} limit cannot claim a value or evidence.`);
    }
  }
  for (const specId of known) if (!mapped.has(specId)) throw new Error(`Specification ${specId} is missing from the surface inventory.`);
  return manifest;
}

export async function materializeSurfaces(manifest, inventory) {
  validateSurfaces(manifest, inventory);
  const specs = new Map(inventory.map((spec) => [spec.specId, spec]));
  return Promise.all(manifest.surfaces.map(async (surface) => {
    const mappings = await Promise.all(surface.specIds.map(async (specId) => {
      const spec = specs.get(specId);
      const recipes = await Promise.all(getCaptureRecipes(spec.title).map(async (recipePath) => {
        const recipe = JSON.parse((await readFile(path.join(repoRoot, recipePath), "utf8")).replace(/^\uFEFF/u, ""));
        return {
          recipe: recipePath,
          approvals: [...new Set([recipe.noveltyFrontier?.approvalArtifact, recipe.knownOperationRefresh?.approvalArtifact].filter(Boolean))].sort(),
        };
      }));
      return {
        specId, specPath: spec.specPath,
        apiOwnerServers: spec.serverUrls,
        apiOwnerStatus: spec.serverUrls.length ? "documented-in-spec" : "unknown",
        recipeStatus: recipes.length ? "registered" : "gap",
        recipes,
      };
    }));
    return {
      id: surface.id, name: surface.name, productArea: surface.productArea,
      portalUrls: surface.portalUrls, status: surface.status,
      apiOwnerStatus: mappings.some((mapping) => mapping.apiOwnerServers.length) ? "documented-in-spec" : "unknown",
      mappingStatus: mappings.length ? "mapped" : "gap", mappings,
      limits: Object.fromEntries(dimensions.map((dimension) => {
        const limit = surface.limits?.[dimension] ?? manifest.surfaceDefaults.limits[dimension];
        return [dimension, limit.status === "observed"
          ? { status: limit.status, value: limit.value, evidence: limit.evidence }
          : { status: "unknown" }];
      })),
      workflows: surface.workflows.map((name) => ({ name, status: "unassessed", uiStates: "unknown" })),
    };
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "tools", "portal-discovery-portfolio.json"), "utf8"));
  const surfaces = await materializeSurfaces(manifest, await buildSpecInventory());
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, surfaces }, null, 2)}\n`);
}
