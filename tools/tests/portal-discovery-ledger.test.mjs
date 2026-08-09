import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLedgerState,
  claimAssignment,
  enqueueAssignment,
  getLedgerViewFromFile,
  readLedgerRecords,
  resumeAttempt,
} from "../portal-discovery-ledger.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portal-ledger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "ledger.jsonl");
}

function assignment(ledgerPath, assignmentId, overrides = {}) {
  return {
    ledgerPath,
    assignmentId,
    specId: "admin",
    portal: "Admin portal",
    recipePath: path.join(process.cwd(), "tools", "recipes", "admin.json"),
    recipeDigest: "a".repeat(64),
    endpoint: "https://admin.example.test",
    profile: "bounded",
    phase: "capture",
    priority: "normal",
    artifactDir: path.join(os.tmpdir(), "private-user", assignmentId),
    ...overrides,
  };
}

test("enqueue is idempotent and stores portable sanitized paths", async (t) => {
  const ledgerPath = await fixture(t);
  const input = assignment(ledgerPath, "job-1");

  const [first, second] = await Promise.all([
    enqueueAssignment(input),
    enqueueAssignment(input),
  ]);

  assert.equal([first.noop, second.noop].filter(Boolean).length, 1);
  const records = await readLedgerRecords(ledgerPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].value.payload.recipePath, "tools/recipes/admin.json");
  assert.equal(records[0].value.payload.artifactDir, "[external]/job-1");
  assert.doesNotMatch(await readFile(ledgerPath, "utf8"), /private-user/u);
});

test("concurrent claims serialize and preserve one endpoint lease", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-1"));
  await enqueueAssignment(assignment(ledgerPath, "job-2"));

  const claims = await Promise.all([
    claimAssignment({
      ledgerPath,
      endpoint: "admin.example.test:443",
      workerId: "worker-1",
      now: "2026-01-01T00:00:00.000Z",
    }),
    claimAssignment({
      ledgerPath,
      endpoint: "admin.example.test:443",
      workerId: "worker-2",
      now: "2026-01-01T00:00:00.000Z",
    }),
  ]);

  assert.equal(claims.filter(Boolean).length, 1);
  const view = await getLedgerViewFromFile({
    ledgerPath,
    now: Date.parse("2026-01-01T00:00:01.000Z"),
  });
  assert.equal(view.assignments.filter((entry) => entry.state === "capturing").length, 1);
  assert.equal(view.assignments.filter((entry) => entry.state === "queued").length, 1);
});

test("expired leases become stale and can resume deterministically", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-1"));
  await claimAssignment({
    ledgerPath,
    endpoint: "admin.example.test:443",
    now: "2026-01-01T00:00:00.000Z",
  });

  const records = await readLedgerRecords(ledgerPath);
  const state = buildLedgerState(records, Date.parse("2026-01-01T00:06:00.000Z"));
  assert.equal(state.assignments.get("job-1").state, "stale");

  const resumed = await resumeAttempt({
    ledgerPath,
    assignmentId: "job-1",
    artifactDir: path.join(os.tmpdir(), "retry-artifacts"),
  });
  assert.equal(resumed.attempt.attemptNumber, 2);
  assert.equal(resumed.attempt.status, "queued");
  assert.equal(resumed.attempt.artifactDir, "[external]/retry-artifacts");
});
