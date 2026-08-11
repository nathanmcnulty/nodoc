import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  authoritativeEvidenceSources,
  buildDiscoveryInputManifest,
  canonicalDiscoverySpecIds,
  discoverNormalizedEvidence,
  parseAuthoritativeEvidenceSource,
} from "../discovery-evidence-inputs.mjs";
import { repoRoot } from "../spec-quality-lib.mjs";

test("uses the exact canonical 20 discovery spec IDs", () => {
  assert.equal(canonicalDiscoverySpecIds.length, 20);
  assert.deepEqual([...canonicalDiscoverySpecIds].sort(), [...new Set(canonicalDiscoverySpecIds)].sort());
});

let inventory;
test.before(async () => {
  const { buildSpecRouteInventory } = await import("../spec-quality-lib.mjs");
  inventory = await buildSpecRouteInventory();
  assert.deepEqual(inventory.map((entry) => entry.specId).sort(), [...canonicalDiscoverySpecIds].sort());
});

test("normalizes live provenance for representative specifications", async () => {
  for (const specId of ["defender-xdr", "m365-admin", "purview", "sharepoint-admin", "teams", "viva-engage"]) {
    const evidence = await discoverNormalizedEvidence(specId);
    assert.ok(evidence.records.some((entry) => entry.sourceKind === "operation-context" && entry.provenance === "live-capture"), specId);
  }
});

test("normalizes operation live capture and preserves negative/unknown semantics", async () => {
  const observed = await discoverNormalizedEvidence("intune-portal");
  assert.ok(observed.records.some((entry) => entry.sourceKind === "operation-live-capture" && entry.semantics === "observed"));
  const absent = await discoverNormalizedEvidence("defender-xdr");
  assert.equal(absent.sources.find((entry) => entry.kind === "operation-live-capture").semantics, "unknown");
  assert.ok(absent.records.some((entry) => entry.details?.classification === "telemetry-exclusion" && entry.semantics === "notObserved"));
});

test("surfaces parse errors instead of converting them to zero evidence", async () => {
  assert.throws(
    () => parseAuthoritativeEvidenceSource(authoritativeEvidenceSources[0], "{", "teams"),
    /invalid JSON/u,
  );
  const overrides = new Map([[authoritativeEvidenceSources[0].path, "{"]]);
  await assert.rejects(() => discoverNormalizedEvidence("teams", { contentOverrides: overrides }), AggregateError);
  const result = await discoverNormalizedEvidence("teams", { contentOverrides: overrides, strict: false });
  assert.equal(result.errors.length, 1);
});

test("treats an absent optional ledger as unknown and omits it from the manifest", async () => {
  const missingPath = authoritativeEvidenceSources[0].path;
  const options = { inventory, contentOverrides: new Map([[missingPath, null]]) };
  const evidence = await discoverNormalizedEvidence("teams", options);
  assert.equal(evidence.sources.find((entry) => entry.path === missingPath).semantics, "unknown");
  const manifest = await buildDiscoveryInputManifest("teams", options);
  assert.ok(!manifest.files.some((entry) => entry.path === missingPath));
});

test("builds stable sorted semantic manifests with required inputs and exclusions", async () => {
  const first = await buildDiscoveryInputManifest("defender-xdr", { inventory });
  const second = await buildDiscoveryInputManifest("defender-xdr", { inventory });
  assert.deepEqual(first, second);
  assert.deepEqual(first.files.map((entry) => entry.path), first.files.map((entry) => entry.path).sort());
  for (const expected of [
    "specifications/nodoc-defender-xdr/specification/openapi.yml",
    "postman/collections/defender.collection.json",
    "src/generated/operationLiveCaptureLedger.json",
    "src/generated/operationContextLedger.json",
    "tools/portal-discovery-metadata.mjs",
    "tools/capture-recipes/defender-deep.json",
  ]) assert.ok(first.files.some((entry) => entry.path === expected), expected);
  assert.ok(first.files.some((entry) => entry.path.endsWith("advanced_hunting.yml")));
  assert.ok(first.files.every((entry) => !entry.path.includes("portfolio-ledger") && !entry.path.includes("node_modules")));
});

test("component digests attribute mutations independently", async () => {
  const baseline = await buildDiscoveryInputManifest("teams", { inventory });
  const targets = Object.fromEntries(Object.keys(baseline.componentDigests).map((category) => [category, baseline.files.find((entry) => entry.category === category).path]));
  for (const [category, target] of Object.entries(targets)) {
    const original = await readFile(path.join(repoRoot, target), "utf8");
    const changed = await buildDiscoveryInputManifest("teams", { inventory, contentOverrides: new Map([[target, `${original}\n `]]) });
    assert.notEqual(changed.componentDigests[category], baseline.componentDigests[category], category);
    assert.notEqual(changed.fingerprint, baseline.fingerprint, category);
  }
});

test("CLI is byte-stable and rejects invalid arguments and unsafe outputs", () => {
  const cli = path.join(repoRoot, "tools", "inspect-discovery-inputs.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
  const first = run("--spec", "teams", "--mode", "manifest");
  const second = run("--spec=teams", "--mode=manifest");
  assert.equal(first.status, 0);
  assert.equal(first.stdout, second.stdout);
  for (const args of [
    ["--mode", "manifest"], ["--spec", "missing"], ["--spec", "teams", "--mode", "bad"],
    ["--spec", "teams", "--unused", "x"], ["--spec", "teams", "--output", path.join(repoRoot, "unsafe.json")],
    ["--spec", "teams", "--output", path.join(os.homedir(), "unsafe.json")],
  ]) assert.notEqual(run(...args).status, 0, args.join(" "));
});
