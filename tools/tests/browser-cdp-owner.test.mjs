import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BrowserCdpOwnerError,
  OWNER_PREFLIGHT_REQUIRED_CODE,
  assertDedicatedProfilePath,
  buildLaunchCommand,
  getBrowserOwnerStatus,
  resolveBrowserBinary,
  startBrowserOwner,
  stopBrowserOwner,
  validateProfileKey,
  profileDigest,
} from "../browser-cdp-owner.mjs";

const root = "C:\\Users\\operator\\AppData\\Local\\nodoc-cdp";
const profilePath = `${root}\\profiles\\m365-admin`;
const manifestPath = `${root}\\manifests\\m365-admin-9222.json`;
const binaryPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const endpoint = "http://127.0.0.1:9222";
const ownerToken = "12345678-1234-1234-1234-123456789abc";

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    owner: "nodoc-browser-cdp",
    profileKey: "m365-admin",
    host: "127.0.0.1",
    port: 9222,
    endpoint,
    pid: 4242,
    product: "Edge",
    binaryPath,
    profileDigest: profileDigest(profilePath),
    ownerToken,
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function exactProcess(overrides = {}) {
  return {
    pid: 4242,
    executablePath: binaryPath,
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir=${profilePath} --nodoc-cdp-owner=${ownerToken}`,
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    profileKey: "m365-admin",
    portalUrl: "https://admin.cloud.microsoft/",
    ownerRoot: root,
    cwd: "C:\\work\\nodoc",
    env: { LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local" },
    platform: "win32",
    ...overrides,
  };
}

function unavailable() {
  return Promise.reject(new BrowserCdpOwnerError("cdp-unavailable", "unavailable"));
}

function assertOwnerReadyNextStep(nextStep) {
  assert.equal(nextStep.code, OWNER_PREFLIGHT_REQUIRED_CODE);
  assert.notEqual(nextStep.code, "authentication-required");
  assert.equal(nextStep.lifecycleStatus, "owner-ready");
  assert.equal(nextStep.authenticationStatus, "unverified");
  assert.match(nextStep.message, /UNVERIFIED until authenticated preflight succeeds/);
  assert.match(nextStep.message, /Leave exactly one intended portal page open, complete sign-in only if the browser UI requires it, then run authenticated preflight/);
}

test("rejects default profile keys and normal browser data roots", () => {
  assert.throws(() => validateProfileKey("Default"), (error) => error.code === "default-profile-rejected");
  assert.throws(() => assertDedicatedProfilePath(
    "C:\\Users\\operator\\AppData\\Local\\Microsoft\\Edge\\User Data",
    { ownerRoot: root, env: { LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local" } },
  ), (error) => error.code === "default-profile-rejected");
});

test("resolves Edge before Chrome deterministically", async () => {
  const result = await resolveBrowserBinary({
    browser: "auto",
    platform: "win32",
    env: {
      "ProgramFiles(x86)": "C:\\PF86",
      ProgramFiles: "C:\\PF",
      LOCALAPPDATA: "C:\\Local",
    },
    pathExists: async (path) => path.endsWith("msedge.exe") || path.endsWith("chrome.exe"),
  });
  assert.equal(result.product, "Edge");
  assert.equal(result.path, "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe");
});

test("fails closed when the fixed port is occupied by an unknown process", async () => {
  const status = await getBrowserOwnerStatus(options(), {
    readManifest: async () => null,
    probeVersion: unavailable,
    isPortAvailable: async () => false,
  });
  assert.equal(status.state, "occupied-unknown");
  await assert.rejects(startBrowserOwner(options(), {
    readManifest: async () => null,
    probeVersion: unavailable,
    isPortAvailable: async () => false,
  }), (error) => error.code === "occupied-unknown");
});

test("reuses an idempotent healthy manifest owner without launching", async () => {
  let launches = 0;
  const result = await startBrowserOwner(options(), {
    readManifest: async (path) => {
      assert.equal(path, manifestPath);
      return manifest();
    },
    inspectProcess: async () => exactProcess(),
    probeVersion: async () => ({ browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }),
    spawnBrowser: async () => { launches += 1; return { pid: 9999 }; },
  });
  assert.equal(result.reused, true);
  assert.equal(result.pid, 4242);
  assertOwnerReadyNextStep(result.nextStep);
  assert.equal(launches, 0);
});

test("launches a new owner with an unverified preflight contract", async () => {
  const ownerRoot = await mkdtemp(join(tmpdir(), "nodoc-cdp-owner-"));
  let launched = false;
  let writtenManifest;
  try {
    const result = await startBrowserOwner(options({ ownerRoot }), {
      readManifest: async () => null,
      isPortAvailable: async () => true,
      resolveBinary: async () => ({ product: "Edge", path: binaryPath }),
      spawnBrowser: async () => {
        launched = true;
        return { pid: 5151 };
      },
      writeManifest: async (path, value) => {
        assert.equal(path, join(ownerRoot, "manifests", "m365-admin-9222.json"));
        writtenManifest = value;
      },
      probeVersion: async () => {
        if (!launched) throw new BrowserCdpOwnerError("cdp-unavailable", "not launched");
        return { browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" };
      },
      randomUUID: () => ownerToken,
    });
    assert.equal(result.reused, false);
    assert.equal(result.pid, 5151);
    assertOwnerReadyNextStep(result.nextStep);
    assert.equal(writtenManifest.ownerToken, ownerToken);
  } finally {
    await rm(ownerRoot, { force: true, recursive: true });
  }
});

test("reports and refuses a stale manifest until explicit stop cleanup", async () => {
  const deps = {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    probeVersion: unavailable,
  };
  const status = await getBrowserOwnerStatus(options(), deps);
  assert.equal(status.state, "stale-manifest");
  await assert.rejects(startBrowserOwner(options(), deps), (error) => error.code === "stale-manifest");
});

test("fails closed on manifest owner product mismatch", async () => {
  await assert.rejects(startBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => exactProcess(),
    probeVersion: async () => {
      throw new BrowserCdpOwnerError("product-mismatch", "Google Chrome is not Edge");
    },
  }), (error) => error.code === "product-mismatch");
});

test("constructs a loopback fixed-port dedicated-profile launch command", () => {
  const launch = buildLaunchCommand({
    binaryPath,
    profilePath,
    ownerRoot: root,
    port: 9222,
    portalUrl: "https://admin.cloud.microsoft/",
    ownerToken,
    env: { LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local" },
  });
  assert.equal(launch.command, binaryPath);
  assert.deepEqual(launch.args, [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--nodoc-cdp-owner=${ownerToken}`,
    "https://admin.cloud.microsoft/",
  ]);
});

test("stop refuses a PID that is not the exact manifest owner", async () => {
  let terminated = false;
  let removed = false;
  await assert.rejects(stopBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => exactProcess({ commandLine: `"${binaryPath}" --remote-debugging-port=9222` }),
    terminateProcess: async () => { terminated = true; },
    removeManifest: async () => { removed = true; },
  }), (error) => error.code === "exact-owner-required");
  assert.equal(terminated, false);
  assert.equal(removed, false);
});

test("stop terminates and removes only the exact manifest owner", async () => {
  let running = true;
  let terminatedPid = null;
  let removed = false;
  const result = await stopBrowserOwner(options({ stopTimeoutMs: 100 }), {
    readManifest: async () => manifest(),
    inspectProcess: async () => running ? exactProcess() : null,
    terminateProcess: async (pid) => { terminatedPid = pid; running = false; },
    removeManifest: async () => { removed = true; },
    delay: async () => {},
  });
  assert.equal(result.state, "stopped");
  assert.equal(terminatedPid, 4242);
  assert.equal(removed, true);
});

test("stop removes a stale manifest without terminating any PID", async () => {
  let terminated = false;
  let removed = false;
  const result = await stopBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    terminateProcess: async () => { terminated = true; },
    removeManifest: async () => { removed = true; },
  });
  assert.equal(result.staleManifestRemoved, true);
  assert.equal(terminated, false);
  assert.equal(removed, true);
});
