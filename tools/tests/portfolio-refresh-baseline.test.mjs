import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalSpecCount,
  maximumWorkerPacketBytes,
  renderPortfolioRefreshArtifacts,
  validatePortfolioRefreshArtifacts,
  writePortfolioRefreshArtifacts,
} from "../portfolio-refresh-baseline.mjs";

test("portfolio refresh baseline covers exactly 20 canonical specifications in stable order", async () => {
  const first = await renderPortfolioRefreshArtifacts();
  const second = await renderPortfolioRefreshArtifacts();
  assert.deepEqual([...first], [...second]);
  const manifest = JSON.parse(first.get("campaign-baseline.json"));
  assert.equal(manifest.canonicalSpecCount, canonicalSpecCount);
  assert.equal(manifest.specifications.length, canonicalSpecCount);
  assert.deepEqual(
    manifest.specifications.map((entry) => entry.title),
    manifest.specifications.map((entry) => entry.title).toSorted(),
  );
  assert.equal(first.size, canonicalSpecCount + 2);
});

test("phase states are explicit and missing evidence never silently becomes complete or zero", async () => {
  const files = await renderPortfolioRefreshArtifacts();
  const manifest = JSON.parse(files.get("campaign-baseline.json"));
  const allowed = new Set(["complete", "incomplete", "blocked", "unavailable", "unknown"]);
  for (const spec of manifest.specifications) {
    for (const phase of Object.values(spec.phases)) assert.ok(allowed.has(phase.status));
    for (const input of Object.values(spec.candidateInputs)) {
      assert.ok(allowed.has(input.status));
      if (input.status === "unknown") assert.equal(input.value, null);
    }
  }
  assert.ok(manifest.specifications.some((spec) => spec.phases.javascriptBundleDiscovery.status === "unavailable"));
  assert.ok(manifest.specifications.every((spec) => spec.phases.reconciliationPublication.status === "unknown"));
});

test("worker packets are deterministic, bounded, and exclude full specification and bundle payloads", async () => {
  const files = await renderPortfolioRefreshArtifacts();
  for (const [relativePath, content] of files) {
    if (!relativePath.startsWith("workers/")) continue;
    assert.ok(Buffer.byteLength(content) <= maximumWorkerPacketBytes, relativePath);
    const packet = JSON.parse(content);
    assert.deepEqual(Object.keys(packet), [
      "schemaVersion",
      "campaignDigest",
      "specId",
      "title",
      "inventory",
      "evidenceReferences",
      "phaseGaps",
      "candidateInputs",
      "fingerprints",
    ]);
    assert.equal(packet.specification, undefined);
    assert.equal(packet.bundleContent, undefined);
  }
});

test("artifact validation rejects unexpected stale worker packets", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-portfolio-baseline-"));
  await writePortfolioRefreshArtifacts(outputDir);
  await mkdir(path.join(outputDir, "workers"), { recursive: true });
  await writeFile(path.join(outputDir, "workers", "stale.json"), "{}\n", "utf8");
  await assert.rejects(
    validatePortfolioRefreshArtifacts(outputDir),
    /workers\/stale\.json is unexpected or stale/u,
  );
});
