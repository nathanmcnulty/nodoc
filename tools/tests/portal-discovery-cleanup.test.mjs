import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import {
  closePortalDiscovery,
  PortalDiscoveryCleanupError,
  validateTerminalDiscoveryRun,
} from "../portal-discovery-cleanup.mjs";

async function writeJson(filePath, value) {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function completedRun(artifacts) {
  return {
    artifacts,
    brief: { specId: "m365-admin", portal: "M365 Admin" },
    status: "completed",
    startedAt: "2026-08-20T00:00:00.000Z",
    completedAt: "2026-08-20T00:10:00.000Z",
    capture: { captureComplete: true },
  };
}

async function fixture(t, { status = "completed" } = {}) {
  const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? ".", "nodoc-close-"));
  const ownerRoot = join(root, "nodoc-cdp");
  const artifacts = join(ownerRoot, "artifacts", "m365-admin-run");
  const profilePath = join(ownerRoot, "profiles", "m365-admin");
  const bundleCache = join(ownerRoot, "bundle-cache");
  await mkdir(profilePath, { recursive: true });
  await mkdir(bundleCache, { recursive: true });
  await writeFile(join(profilePath, "Cookies"), "dedicated-profile-state", "utf8");
  await writeFile(join(bundleCache, "bundle.json"), "derived-cache", "utf8");
  const run = status === "completed"
    ? completedRun(artifacts)
    : {
        artifacts,
        brief: { specId: "m365-admin", portal: "M365 Admin" },
        status,
        startedAt: "2026-08-20T00:00:00.000Z",
        blocker: { code: "authentication-required" },
      };
  await writeJson(join(artifacts, "discovery-run.json"), run);
  if (status === "completed") {
    await writeJson(join(artifacts, "summary.json"), { portal: "M365 Admin" });
    await writeJson(join(artifacts, "candidate-handoff.json"), { candidates: [] });
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    ownerRoot,
    artifacts,
    profilePath,
    bundleCache,
    dependencies: {
      stopOwner: async (options) => {
        assert.equal(options.profileKey, "m365-admin");
        assert.equal(options.ownerRoot, ownerRoot);
        return { state: "stopped", alreadyStopped: true };
      },
      findProfileProcesses: async () => [],
    },
  };
}

test("validates terminal status and rejects an active discovery run", () => {
  assert.throws(
    () => validateTerminalDiscoveryRun({ status: "running", brief: { specId: "x" } }, "C:\\artifacts"),
    (error) => error instanceof PortalDiscoveryCleanupError && error.code === "discovery-run-not-terminal",
  );
});

test("purges only the dedicated profile and preserves evidence and derivative cache", async (t) => {
  const fixtureState = await fixture(t);
  const result = await closePortalDiscovery({
    artifacts: fixtureState.artifacts,
    profileKey: "m365-admin",
    ownerRoot: fixtureState.ownerRoot,
    purgeProfile: true,
  }, fixtureState.dependencies);

  assert.equal(result.profile.action, "purged");
  assert.equal(result.discovery.status, "completed");
  assert.match(result.receiptPath, /cleanup-receipts[\\/]m365-admin-9222-[a-f0-9]{24}\.json$/u);
  await assert.rejects(readFile(fixtureState.profilePath, "utf8"));
  assert.equal(await readFile(join(fixtureState.artifacts, "summary.json"), "utf8").then(() => true), true);
  assert.equal(await readFile(join(fixtureState.artifacts, "candidate-handoff.json"), "utf8").then(() => true), true);
  assert.equal(await readFile(join(fixtureState.bundleCache, "bundle.json"), "utf8"), "derived-cache");
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  assert.equal(receipt.preserved.immutableArtifacts, true);
  assert.equal(receipt.preserved.derivativeBundleCache, true);
  assert.equal(receipt.preserved.worktreesAndBranches, "not-managed-by-this-command");
});

test("stops the owner but retains the profile unless purge is explicitly requested", async (t) => {
  const fixtureState = await fixture(t);
  const result = await closePortalDiscovery({
    artifacts: fixtureState.artifacts,
    profileKey: "m365-admin",
    ownerRoot: fixtureState.ownerRoot,
  }, fixtureState.dependencies);

  assert.equal(result.profile.action, "retained");
  assert.equal(await readFile(join(fixtureState.profilePath, "Cookies"), "utf8"), "dedicated-profile-state");
});

test("fails closed when a process still references the dedicated profile", async (t) => {
  const fixtureState = await fixture(t);
  const dependencies = {
    ...fixtureState.dependencies,
    findProfileProcesses: async () => [{ pid: 7001, executablePath: "C:\\Edge\\msedge.exe" }],
  };
  await assert.rejects(closePortalDiscovery({
    artifacts: fixtureState.artifacts,
    profileKey: "m365-admin",
    ownerRoot: fixtureState.ownerRoot,
    purgeProfile: true,
  }, dependencies), (error) => error.code === "profile-in-use");
  assert.equal(await readFile(join(fixtureState.profilePath, "Cookies"), "utf8"), "dedicated-profile-state");
});

test("does not purge a completed run with incomplete capture evidence", async (t) => {
  const fixtureState = await fixture(t);
  const run = completedRun(fixtureState.artifacts);
  run.capture.captureComplete = false;
  await writeJson(join(fixtureState.artifacts, "discovery-run.json"), run);
  await assert.rejects(closePortalDiscovery({
    artifacts: fixtureState.artifacts,
    profileKey: "m365-admin",
    ownerRoot: fixtureState.ownerRoot,
    purgeProfile: true,
  }, fixtureState.dependencies), (error) => error.code === "capture-incomplete");
  assert.equal(await readFile(join(fixtureState.profilePath, "Cookies"), "utf8"), "dedicated-profile-state");
});
