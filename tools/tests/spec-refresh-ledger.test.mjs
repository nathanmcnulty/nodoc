import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLedger,
  canonicalSpecIds,
  detailFor,
  phaseStatus,
  validateBaseline,
  writeBaseline,
} from "../spec-refresh-ledger.mjs";

test("canonical specification IDs and order are exact", async () => {
  const ledger = await buildLedger();
  assert.deepEqual(ledger.index.specIds, canonicalSpecIds);
  assert.equal(new Set(canonicalSpecIds).size, 20);
  assert.equal(canonicalSpecIds.length, 20);
});

test("modular schema inventory is non-zero and stable for representative specifications", async () => {
  const first = await buildLedger();
  const second = await buildLedger();
  for (const specId of ["defender-xdr", "ibiza-iam", "m365-admin", "purview"]) {
    const left = first.index.specs.find(({ id }) => id === specId);
    const right = second.index.specs.find(({ id }) => id === specId);
    assert.ok(left.authoritative.schemaCount > 0, `${specId} schemas must be observed`);
    assert.equal(left.authoritative.schemaDigest, right.authoritative.schemaDigest);
  }
  const powerPlatform = first.index.specs.find(({ id }) => id === "power-platform");
  assert.ok(powerPlatform.authoritative.operationCount > 0);
  assert.equal(
    powerPlatform.authoritative.operationDigest,
    second.index.specs.find(({ id }) => id === "power-platform").authoritative.operationDigest,
  );
});

test("evidence and parity absence remain explicit without silent zero completion", async () => {
  const { index } = await buildLedger();
  const absent = index.specs.find(({ id }) => id === "entra-b2c");
  assert.equal(absent.evidence.state, "notObserved");
  assert.equal(absent.phases.discoveryEvidence.status, "incomplete");
  assert.notEqual(absent.phases.refreshReadiness.status, "complete");
  const missingParity = { state: "unknown", counts: { unresolved: null, orphaned: null }, requestCount: null };
  const phases = phaseStatus({ evidence: absent.evidence, parity: missingParity, parseError: null });
  assert.equal(missingParity.requestCount, null);
  assert.equal(missingParity.counts.unresolved, null);
  assert.equal(phases.derivativeParity.status, "unknown");
  assert.notEqual(phases.refreshReadiness.status, "complete");
});

test("baseline is bounded, deterministic, and does not duplicate operation inventories", async () => {
  const rootA = await mkdtemp(path.join(os.tmpdir(), "spec-refresh-a-"));
  const rootB = await mkdtemp(path.join(os.tmpdir(), "spec-refresh-b-"));
  try {
    const first = await writeBaseline(rootA);
    const second = await writeBaseline(rootB);
    assert.deepEqual([...first.files.keys()], [...second.files.keys()]);
    let total = 0;
    for (const [relativePath, content] of first.files) {
      total += Buffer.byteLength(content, "utf8");
      assert.equal(content, second.files.get(relativePath));
      if (relativePath.startsWith("packets/")) {
        assert.ok(Buffer.byteLength(content, "utf8") <= 16 * 1024);
        assert.doesNotMatch(content, /"operationIds"\s*:/u);
        assert.doesNotMatch(content, /"operations"\s*:\s*\[/u);
      }
    }
    assert.ok(total <= 400 * 1024);
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  }
});

test("validator rejects tampered, missing, and extra artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-refresh-validate-"));
  try {
    await writeBaseline(root);
    const indexPath = path.join(root, "index.json");
    await writeFile(indexPath, `${await readFile(indexPath, "utf8")} `, "utf8");
    await assert.rejects(validateBaseline(root), /stale or tampered/u);
    await writeBaseline(root);
    await unlink(path.join(root, "SUMMARY.md"));
    await assert.rejects(validateBaseline(root), /files differ/u);
    await writeBaseline(root);
    await mkdir(path.join(root, "extra"));
    await writeFile(path.join(root, "extra", "unexpected.json"), "{}\n", "utf8");
    await assert.rejects(validateBaseline(root), /files differ/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("on-demand details are deterministic and machine-readable", async () => {
  for (const detail of ["operations", "schemas", "evidence"]) {
    const first = await detailFor("defender-xdr", detail);
    const second = await detailFor("defender-xdr", detail);
    assert.deepEqual(first, second);
    assert.equal(first.detail, detail);
    assert.ok(first.digest);
  }
});
