import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildEvidence,
  buildManifest,
  getCanonicalSpecIds,
  inspectDiscoveryInputs,
  repoRoot,
  stableJson,
} from "../discovery-evidence-inputs.mjs";
import { collectionDefinitions } from "../postman-collection-definitions.mjs";
import {
  captureRecipesByTitle,
  coverageOverlayByTitle,
  crawlMetadataByTitle,
} from "../portal-discovery-metadata.mjs";

const cli = path.join(repoRoot, "tools", "inspect-discovery-inputs.mjs");

function runCli(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

async function fixture(specId = "m365-admin") {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-inputs-"));
  await mkdir(path.join(root, "tools", "capture-recipes"), { recursive: true });
  await mkdir(path.join(root, "src", "generated"), { recursive: true });
  const portfolio = JSON.parse(await readFile(path.join(repoRoot, "tools", "portal-discovery-portfolio.json"), "utf8"));
  await writeFile(path.join(root, "tools", "portal-discovery-portfolio.json"), stableJson(portfolio, 2));
  for (const { specId: id } of portfolio.portals) {
    const target = path.join(root, "specifications", `nodoc-${id}`, "specification");
    await mkdir(target, { recursive: true });
    if (id === specId) await cp(path.join(repoRoot, "specifications", `nodoc-${id}`, "specification"), target, { recursive: true });
  }
  const coverage = JSON.parse(await readFile(path.join(repoRoot, "src", "generated", "portalCoverageLedger.json"), "utf8"));
  const title = coverage.find((entry) => entry.specId === specId).title;
  const recipes = coverage.find((entry) => entry.specId === specId).captureRecipes;
  for (const recipe of recipes) {
    await cp(path.join(repoRoot, recipe), path.join(root, recipe));
  }
  for (const name of ["operationLiveCaptureLedger.json", "operationContextLedger.json", "portalCoverageLedger.json"]) {
    const ledger = JSON.parse(await readFile(path.join(repoRoot, "src", "generated", name), "utf8"));
    await writeFile(path.join(root, "src", "generated", name), stableJson(ledger.filter((entry) => entry.specId === specId), 2));
  }
  return { root, portfolio, title, recipes };
}

test("derives the exact authoritative 20-ID inventory", async () => {
  assert.deepEqual(await getCanonicalSpecIds(), [
    "defender-xdr", "entra-b2c", "entra-idgov", "entra-iga", "entra-pim",
    "exchange-beta", "ibiza-iam", "intune-autopatch", "intune-portal", "m365-admin",
    "m365-apps-config", "m365-apps-inventory", "m365-apps-services", "power-platform",
    "purview", "purview-portal", "security-copilot", "sharepoint-admin", "teams", "viva-engage",
  ]);
});

test("reports truthful live, negative, and unknown evidence", async () => {
  for (const specId of ["defender-xdr", "m365-admin", "purview", "sharepoint-admin", "teams", "viva-engage"]) {
    const evidence = await buildEvidence(specId);
    assert.ok(evidence.records.some((record) => record.status === "observed" && record.provenance === "live"), specId);
  }
  assert.ok((await buildEvidence("intune-autopatch")).records.some((record) => record.sourceKind === "operation-live-capture-ledger" && record.status === "observed"));
  assert.ok((await buildEvidence("entra-iga")).records.some((record) => record.status === "notObserved"));
  assert.ok((await buildEvidence("entra-pim")).records.some((record) => record.status === "unknown"));
  assert.equal(stableJson(await buildEvidence("teams")).includes("unavailable"), false);
});

test("treats absent optional sources as unknown and omits them from manifests", async (t) => {
  const data = await fixture("teams");
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await rm(path.join(data.root, "src", "generated", "operationLiveCaptureLedger.json"));
  const evidence = await buildEvidence("teams", { repoRoot: data.root });
  assert.ok(evidence.records.some((record) => record.sourceKind === "operation-live-capture-ledger" && record.status === "unknown"));
  const paths = Object.values((await buildManifest("teams", { repoRoot: data.root })).categories).flat().map((entry) => entry.path);
  assert.equal(paths.includes("src/generated/operationLiveCaptureLedger.json"), false);
});

test("surfaces authoritative source parse errors", async (t) => {
  const data = await fixture("teams");
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await writeFile(path.join(data.root, "src", "generated", "operationContextLedger.json"), "{bad");
  const evidence = await buildEvidence("teams", { repoRoot: data.root });
  assert.equal(evidence.errors.length, 1);
  assert.equal(evidence.errors[0].sourceKind, "operation-context-ledger");
  assert.equal(evidence.errors[0].sourcePath, "src/generated/operationContextLedger.json");
  assert.ok(evidence.errors[0].message.length > 0);
  await writeFile(path.join(data.root, "src", "generated", "operationContextLedger.json"), "{}\n");
  assert.match((await buildEvidence("teams", { repoRoot: data.root })).errors[0].message, /top level must be an array/u);
});

test("manifests include semantic inputs and exclude generated collections and reports", async () => {
  const manifest = await buildManifest("m365-admin");
  const paths = Object.values(manifest.categories).flat().map((entry) => entry.path);
  assert.ok(paths.includes("specifications/nodoc-m365-admin/specification/app_settings.yml"));
  assert.ok(paths.includes("tools/postman-collection-definitions.mjs"));
  assert.ok(paths.includes("tools/portal-discovery-portfolio.json"));
  assert.ok(paths.includes("tools/capture-recipes/m365-admin-deep.json"));
  assert.ok(paths.includes("src/generated/operationContextLedger.json"));
  assert.equal(paths.some((item) => item.startsWith("postman/collections/") || item.startsWith("reports/") || item.startsWith("src/generated/reports/")), false);
  assert.deepEqual(Object.keys(manifest.categories), [...Object.keys(manifest.categories)].sort());
  for (const entries of Object.values(manifest.categories)) {
    assert.deepEqual(entries, [...entries].sort((left, right) => stableJson(left) < stableJson(right) ? -1 : 1));
  }
});

test("fingerprints attribute semantic mutations and ignore unrelated generated files", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  const baseline = await buildManifest("m365-admin", { repoRoot: data.root });
  const mutate = async (relativePath, suffix) => {
    const absolute = path.join(data.root, relativePath);
    await writeFile(absolute, `${await readFile(absolute, "utf8")}\n${suffix}\n`);
    return buildManifest("m365-admin", { repoRoot: data.root });
  };
  const spec = await mutate("specifications/nodoc-m365-admin/specification/app_settings.yml", "# semantic module mutation");
  assert.notEqual(spec.categoryFingerprints.specification, baseline.categoryFingerprints.specification);
  const portfolioPath = path.join(data.root, "tools", "portal-discovery-portfolio.json");
  const portfolio = JSON.parse(await readFile(portfolioPath, "utf8"));
  portfolio.portals.find((entry) => entry.specId === "m365-admin").priority += 1;
  await writeFile(portfolioPath, stableJson(portfolio, 2));
  const discovery = await buildManifest("m365-admin", { repoRoot: data.root });
  assert.notEqual(discovery.categoryFingerprints.discovery, spec.categoryFingerprints.discovery);
  const metadata = {
    captureRecipesByTitle,
    coverageOverlayByTitle,
    crawlMetadataByTitle: { ...crawlMetadataByTitle, "M365 Admin": { ...crawlMetadataByTitle["M365 Admin"], priority: "changed" } },
  };
  const metadataManifest = await buildManifest("m365-admin", { repoRoot: data.root, discoveryMetadata: metadata });
  assert.notEqual(metadataManifest.categoryFingerprints.discovery, discovery.categoryFingerprints.discovery);
  const recipe = await mutate(data.recipes[0], " ");
  assert.notEqual(recipe.categoryFingerprints.recipes, metadataManifest.categoryFingerprints.recipes);
  const contextPath = path.join(data.root, "src", "generated", "operationContextLedger.json");
  const context = JSON.parse(await readFile(contextPath, "utf8"));
  context[0].operations[0].operationContext.provenance ??= [];
  context[0].operations[0].operationContext.provenance.push({ source: "test", confidence: "low" });
  await writeFile(contextPath, stableJson(context, 2));
  const provenance = await buildManifest("m365-admin", { repoRoot: data.root });
  assert.notEqual(provenance.categoryFingerprints.evidence, recipe.categoryFingerprints.evidence);
  const definitions = collectionDefinitions.map((entry) => entry.specId === "m365-admin" ? { ...entry, name: "M365 Admin changed" } : entry);
  const postman = await buildManifest("m365-admin", { repoRoot: data.root, collectionDefinitions: definitions });
  assert.notEqual(postman.categoryFingerprints.postman, provenance.categoryFingerprints.postman);
  const unrelatedDefinitions = definitions.map((entry) => entry.specId === "teams" ? { ...entry, name: "Teams changed" } : entry);
  assert.equal((await buildManifest("m365-admin", { repoRoot: data.root, collectionDefinitions: unrelatedDefinitions })).fingerprint, postman.fingerprint);
  await mkdir(path.join(data.root, "postman", "collections"), { recursive: true });
  await writeFile(path.join(data.root, "postman", "collections", "m365-admin.collection.json"), "generated change");
  assert.equal((await buildManifest("m365-admin", { repoRoot: data.root, collectionDefinitions: definitions })).fingerprint, postman.fingerprint);
});

test("CLI is deterministic, cwd-independent, stdout-only, and rejects every invalid contract", async () => {
  const args = ["--spec=m365-admin", "--mode=all"];
  const first = runCli(args);
  const second = runCli(["--spec", "m365-admin", "--mode", "all"], os.tmpdir());
  assert.equal(first.status, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(JSON.parse(first.stdout), await inspectDiscoveryInputs("m365-admin", "all"));
  for (const invalid of [
    [], ["--spec=teams"], ["--mode=evidence"], ["--spec=nope", "--mode=evidence"],
    ["--spec=teams", "--mode=nope"], ["--spec=teams", "--spec=teams", "--mode=evidence"],
    ["--spec=teams", "--mode=evidence", "--output=x"], ["--spec=teams", "--mode=evidence", "--out=x"],
    ["--spec=teams", "--mode=evidence", "extra"], ["--spec=teams", "--mode=evidence", "--unknown=x"],
    ["--spec", "--mode=evidence"], ["--spec=teams", "--mode"], ["--spec=teams", "--mode=evidence", "--mode=evidence"],
    ["--spec=teams=tail", "--mode=evidence"], ["--spec=teams", "--mode=evidence=tail"],
  ]) {
    const result = runCli(invalid);
    assert.notEqual(result.status, 0, invalid.join(" "));
    assert.equal(result.stdout, "");
  }
});
