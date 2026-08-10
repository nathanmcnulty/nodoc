import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLedgerState,
  claimAssignment,
  enqueueAssignment,
  getLedgerViewFromFile,
  normalizeEndpoint,
  readLedgerRecords,
  renewAttemptLease,
  resumeAttempt,
  updateAttempt,
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

test("endpoint normalization shares HTTPS, host, and default-port lease identity", () => {
  assert.deepEqual(
    [
      "https://CONFIG.OFFICE.COM",
      "config.office.com",
      "config.office.com:443",
      "https://config.office.com:443/",
    ].map(normalizeEndpoint),
    [
      "config.office.com:443",
      "config.office.com:443",
      "config.office.com:443",
      "config.office.com:443",
    ],
  );
  assert.equal(normalizeEndpoint("http://config.office.com"), "config.office.com:80");
  assert.equal(normalizeEndpoint("config.office.com:8443"), "config.office.com:8443");
});

test("ambiguous endpoint URLs fail closed", () => {
  for (const endpoint of [
    "https://config.office.com/api",
    "https://config.office.com?tenant=example",
    "https://user:password@config.office.com",
    "config.office.com/api",
  ]) {
    assert.throws(() => normalizeEndpoint(endpoint), /endpoint/u);
  }
});

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

test("claim profile filtering prevents a worker from claiming another profile", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-profile", { profile: "other" }));
  assert.equal(
    await claimAssignment({
      ledgerPath,
      assignmentId: "job-profile",
      endpoint: "https://admin.example.test",
      profile: "bounded",
      workerId: "worker-1",
    }),
    null,
  );
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

test("owned long capture lease renews atomically and wrong owner is rejected", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-renew"));
  await claimAssignment({
    ledgerPath,
    assignmentId: "job-renew",
    workerId: "owner",
    now: "2026-01-01T00:00:00.000Z",
    leaseMs: 100,
  });

  await assert.rejects(
    renewAttemptLease({
      ledgerPath,
      assignmentId: "job-renew",
      attemptNumber: 1,
      workerId: "other",
      now: "2026-01-01T00:00:00.050Z",
      leaseMs: 100,
    }),
    /not owned by this worker/u,
  );
  await renewAttemptLease({
    ledgerPath,
    assignmentId: "job-renew",
    attemptNumber: 1,
    workerId: "owner",
    now: "2026-01-01T00:00:00.050Z",
    leaseMs: 100,
  });
  assert.equal(
    buildLedgerState(
      await readLedgerRecords(ledgerPath),
      Date.parse("2026-01-01T00:00:00.120Z"),
    ).assignments.get("job-renew").state,
    "capturing",
  );
});

test("terminal reconciliation is idempotent after stale recovery and releases once", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-race"));
  await claimAssignment({
    ledgerPath,
    assignmentId: "job-race",
    workerId: "owner",
    now: "2026-01-01T00:00:00.000Z",
    leaseMs: 100,
  });

  const result = await updateAttempt({
    ledgerPath,
    assignmentId: "job-race",
    attemptNumber: 1,
    status: "blocked",
    blocker: { code: "pipeline-failed" },
    now: "2026-01-01T00:00:00.200Z",
  });
  assert.equal(result.noop, true);
  assert.equal(result.assignment.latestAttempt.status, "stale");
  assert.equal(result.assignment.latestAttempt.blocker.code, "stale-endpoint-lease");
  assert.equal(
    (await readLedgerRecords(ledgerPath)).filter(({ value }) => value.eventType === "attempt-updated").length,
    1,
  );
});

test("completed attempts reconcile corrected terminal metadata idempotently", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-reconcile"));
  await claimAssignment({
    ledgerPath,
    assignmentId: "job-reconcile",
    endpoint: "admin.example.test:443",
    workerId: "owner",
  });

  await updateAttempt({
    ledgerPath,
    assignmentId: "job-reconcile",
    attemptNumber: 1,
    status: "completed",
    captureComplete: false,
    captureStatus: "missing-minimum-artifacts",
  });
  const corrected = await updateAttempt({
    ledgerPath,
    assignmentId: "job-reconcile",
    attemptNumber: 1,
    status: "completed",
    captureComplete: true,
    captureStatus: "complete",
  });

  assert.equal(corrected.noop, false);
  assert.equal(corrected.assignment.latestAttempt.captureComplete, true);
  assert.equal(corrected.assignment.latestAttempt.captureStatus, "complete");
  const repeated = await updateAttempt({
    ledgerPath,
    assignmentId: "job-reconcile",
    attemptNumber: 1,
    status: "completed",
    captureComplete: true,
    captureStatus: "complete",
  });
  assert.equal(repeated.noop, true);
});

test("partial tails are ignored and reported without poisoning valid state", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-1"));
  await appendFile(ledgerPath, '{"recordVersion":1,"eventType":"assignment-created"', "utf8");

  const records = await readLedgerRecords(ledgerPath);
  assert.equal(records.length, 1);
  const view = await getLedgerViewFromFile({ ledgerPath });
  assert.deepEqual(view.counts.partialTail, {
    line: 2,
    policy: "ignored-until-next-complete-record",
  });
  assert.equal(view.assignments[0].assignmentId, "job-1");
});

test("invalid transitions and immutable retry attempts are rejected", async (t) => {
  const ledgerPath = await fixture(t);
  await enqueueAssignment(assignment(ledgerPath, "job-1"));
  await assert.rejects(
    updateAttempt({ ledgerPath, assignmentId: "job-1", attemptNumber: 1, status: "completed" }),
    /Cannot transition status from queued to completed/u,
  );
  const resumed = await resumeAttempt({ ledgerPath, assignmentId: "job-1" });
  assert.equal(resumed.attempt.attemptNumber, 2);
  await claimAssignment({ ledgerPath, endpoint: "admin.example.test:443", workerId: "worker-1" });
  await assert.rejects(
    resumeAttempt({ ledgerPath, assignmentId: "job-1" }),
    /Cannot resume a running attempt/u,
  );
});

test("stale lock reclamation is atomic and leaves no lock after callback failure", async (t) => {
  const ledgerPath = await fixture(t);
  const lockPath = `${ledgerPath}.lock`;
  await mkdir(lockPath, { recursive: true });
  await writeFile(path.join(lockPath, "owner.json"), "{}\n", "utf8");
  const stale = new Date(Date.now() - 60_000);
  await utimes(lockPath, stale, stale);
  await enqueueAssignment(assignment(ledgerPath, "job-1"));
  assert.equal(await readFile(ledgerPath, "utf8").then((value) => value.includes("job-1")), true);
  await assert.rejects(
    updateAttempt({ ledgerPath, assignmentId: "job-1", attemptNumber: 1, status: "completed" }),
    /Cannot transition status from queued to completed/u,
  );
});
