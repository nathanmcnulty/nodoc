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
  isBrowserProcessUsingProfile,
  isExactManifestOwner,
  rebindBrowserOwner,
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
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --nodoc-cdp-owner=${ownerToken}`,
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
  const validationOrder = [];
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
        validationOrder.push("version");
        return { browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" };
      },
      probeTargets: async () => {
        validationOrder.push("targets");
        return { pageTargetCount: 1 };
      },
      findOwnerProcesses: async () => {
        validationOrder.push("owner");
        return [{
          pid: 6161,
          executablePath: binaryPath,
          commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir=${join(ownerRoot, "profiles", "m365-admin")} --nodoc-cdp-owner=${ownerToken}`,
        }];
      },
      randomUUID: () => ownerToken,
    });
    assert.equal(result.reused, false);
    assert.equal(result.pid, 6161);
    assertOwnerReadyNextStep(result.nextStep);
    assert.equal(writtenManifest.ownerToken, ownerToken);
    assert.equal(writtenManifest.pid, 6161);
    assert.deepEqual(validationOrder, ["version", "targets", "owner"]);
  } finally {
    await rm(ownerRoot, { force: true, recursive: true });
  }
});

test("accepts Edge-quoted dedicated profile arguments without weakening exact identity", () => {
  assert.equal(isExactManifestOwner(manifest(), exactProcess({
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --nodoc-cdp-owner=${ownerToken}`,
  }), profilePath), true);
  const noSpaceProfile = "C:\\nodoc-cdp\\profiles\\m365-admin";
  assert.equal(isExactManifestOwner(manifest(), exactProcess({
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir=${noSpaceProfile} --nodoc-cdp-owner=${ownerToken}`,
  }), noSpaceProfile), true);
  assert.equal(isExactManifestOwner(manifest(), exactProcess({
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}-other" --nodoc-cdp-owner=${ownerToken}`,
  }), profilePath), false);
  assert.equal(isExactManifestOwner(manifest(), exactProcess({
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir=${profilePath}-other --nodoc-cdp-owner=${ownerToken}`,
  }), profilePath), false);
  assert.equal(isExactManifestOwner(manifest(), exactProcess({
    commandLine: `"${binaryPath}" --remote-debugging-port=92220 --user-data-dir="${profilePath}" --nodoc-cdp-owner=${ownerToken}`,
  }), profilePath), false);
  assert.equal(isExactManifestOwner(manifest(), exactProcess({
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --nodoc-cdp-owner=${ownerToken}-other`,
  }), profilePath), false);
});

test("new owner launch fails closed when CDP has no page target", async () => {
  const ownerRoot = await mkdtemp(join(tmpdir(), "nodoc-cdp-owner-targetless-"));
  const ownerProfile = join(ownerRoot, "profiles", "m365-admin");
  let launched = false;
  try {
    await assert.rejects(startBrowserOwner(options({ ownerRoot, launchTimeoutMs: 5 }), {
      readManifest: async () => null,
      isPortAvailable: async () => true,
      resolveBinary: async () => ({ product: "Edge", path: binaryPath }),
      spawnBrowser: async () => { launched = true; return { pid: 5151 }; },
      writeManifest: async () => {},
      probeVersion: async () => {
        if (!launched) throw new BrowserCdpOwnerError("cdp-unavailable", "not launched");
        return { browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" };
      },
      probeTargets: async () => { throw new BrowserCdpOwnerError("target-unavailable", "CDP owner launched without a page target."); },
      findOwnerProcesses: async () => [{
        pid: 6161,
        executablePath: binaryPath,
        commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${ownerProfile}" --nodoc-cdp-owner=${ownerToken}`,
      }],
      randomUUID: () => ownerToken,
      delay: async () => new Promise((resolvePromise) => setTimeout(resolvePromise, 1)),
    }), (error) => error.code === "launch-validation-failed" && /page target/u.test(error.message));
  } finally {
    await rm(ownerRoot, { force: true, recursive: true });
  }
});

test("treats an exact or suspicious profile reference as in-use", () => {
  assert.equal(isBrowserProcessUsingProfile({
    commandLine: `"${binaryPath}" --user-data-dir="${profilePath}"`,
  }, profilePath), true);
  assert.equal(isBrowserProcessUsingProfile({
    commandLine: `"${binaryPath}" --user-data-dir="${profilePath}-other"`,
  }, profilePath), true);
  assert.equal(isBrowserProcessUsingProfile({
    commandLine: `"${binaryPath}" --user-data-dir="C:\\other-profile"`,
  }, profilePath), false);
  assert.equal(isBrowserProcessUsingProfile({
    commandLine: `"${binaryPath}" --user-data-dir="${profilePath}`,
  }, profilePath), true);
});

test("launch retries a transient zero-candidate handoff before binding the exact owner", async () => {
  const ownerRoot = await mkdtemp(join(tmpdir(), "nodoc-cdp-owner-handoff-"));
  const ownerProfile = join(ownerRoot, "profiles", "m365-admin");
  let searches = 0;
  let launched = false;
  try {
    const result = await startBrowserOwner(options({ ownerRoot, launchTimeoutMs: 1000 }), {
      readManifest: async () => null,
      isPortAvailable: async () => true,
      resolveBinary: async () => ({ product: "Edge", path: binaryPath }),
      spawnBrowser: async () => { launched = true; return { pid: 5151 }; },
      writeManifest: async () => {},
      probeVersion: async () => {
        if (!launched) throw new BrowserCdpOwnerError("cdp-unavailable", "not launched");
        return { browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" };
      },
      probeTargets: async () => ({ pageTargetCount: 1 }),
      findOwnerProcesses: async () => {
        searches += 1;
        return searches === 1 ? [] : [{
          pid: 6161,
          executablePath: binaryPath,
          commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${ownerProfile}" --nodoc-cdp-owner=${ownerToken}`,
        }];
      },
      randomUUID: () => ownerToken,
      delay: async () => {},
    });
    assert.equal(searches, 2);
    assert.equal(result.pid, 6161);
  } finally {
    await rm(ownerRoot, { force: true, recursive: true });
  }
});

test("reports and refuses a stale manifest until explicit stop cleanup", async () => {
  const deps = {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    findOwnerProcesses: async () => [],
    probeVersion: unavailable,
    isPortAvailable: async () => true,
  };
  const status = await getBrowserOwnerStatus(options(), deps);
  assert.equal(status.state, "stale-manifest");
  await assert.rejects(startBrowserOwner(options(), deps), (error) => error.code === "stale-manifest");
});

test("launch fails closed when the long-lived exact owner is ambiguous", async () => {
  const ownerRoot = await mkdtemp(join(tmpdir(), "nodoc-cdp-owner-ambiguous-"));
  const ownerProfile = join(ownerRoot, "profiles", "m365-admin");
  const candidate = (pid) => ({
    pid,
    executablePath: binaryPath,
    commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir=${ownerProfile} --nodoc-cdp-owner=${ownerToken}`,
  });
  try {
    let launched = false;
    let delays = 0;
    await assert.rejects(startBrowserOwner(options({ ownerRoot }), {
      readManifest: async () => null,
      isPortAvailable: async () => true,
      resolveBinary: async () => ({ product: "Edge", path: binaryPath }),
      spawnBrowser: async () => { launched = true; return { pid: 5151 }; },
      writeManifest: async () => {},
      probeVersion: async () => {
        if (!launched) throw new BrowserCdpOwnerError("cdp-unavailable", "not launched");
        return { browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" };
      },
      findOwnerProcesses: async () => [candidate(5152), candidate(5153)],
      randomUUID: () => ownerToken,
      delay: async () => { delays += 1; },
    }), (error) => error.code === "owner-resolution-failed");
    assert.equal(delays, 0);
  } finally {
    await rm(ownerRoot, { force: true, recursive: true });
  }
});

test("launch bounds a persistent zero-candidate handoff and retains its manifest", async () => {
  const ownerRoot = await mkdtemp(join(tmpdir(), "nodoc-cdp-owner-zero-"));
  let writes = 0;
  let launched = false;
  try {
    await assert.rejects(startBrowserOwner(options({ ownerRoot, launchTimeoutMs: 5 }), {
      readManifest: async () => null,
      isPortAvailable: async () => true,
      resolveBinary: async () => ({ product: "Edge", path: binaryPath }),
      spawnBrowser: async () => { launched = true; return { pid: 5151 }; },
      writeManifest: async () => { writes += 1; },
      probeVersion: async () => {
        if (!launched) throw new BrowserCdpOwnerError("cdp-unavailable", "not launched");
        return { browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" };
      },
      probeTargets: async () => ({ pageTargetCount: 1 }),
      findOwnerProcesses: async () => [],
      randomUUID: () => ownerToken,
      delay: async () => new Promise((resolvePromise) => setTimeout(resolvePromise, 1)),
    }), (error) => error.code === "owner-resolution-failed");
    assert.equal(writes, 1);
  } finally {
    await rm(ownerRoot, { force: true, recursive: true });
  }
});

test("explicit rebind repairs only one exact replacement owner after launcher handoff", async () => {
  let writtenManifest;
  const result = await rebindBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    findOwnerProcesses: async () => [exactProcess({
      pid: 6161,
      commandLine: `"${binaryPath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --nodoc-cdp-owner=${ownerToken}`,
    })],
    probeVersion: async () => ({ browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }),
    writeManifest: async (path, value) => {
      assert.equal(path, manifestPath);
      writtenManifest = value;
    },
  });
  assert.equal(result.rebound, true);
  assert.equal(result.authenticationStatus, "unverified");
  assert.equal(result.nextStep.code, OWNER_PREFLIGHT_REQUIRED_CODE);
  assert.equal(result.previousPid, 4242);
  assert.equal(result.pid, 6161);
  assert.equal(writtenManifest.pid, 6161);
});

test("rebind leaves the manifest unchanged without exactly one fully matching owner", async () => {
  for (const candidates of [[], [exactProcess({ pid: 6161 }), exactProcess({ pid: 7171 })]]) {
    let wrote = false;
    await assert.rejects(rebindBrowserOwner(options(), {
      readManifest: async () => manifest(),
      inspectProcess: async () => null,
      findOwnerProcesses: async () => candidates,
      probeVersion: async () => ({ browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }),
      writeManifest: async () => { wrote = true; },
    }), (error) => error.code === "owner-resolution-failed");
    assert.equal(wrote, false);
  }
});

test("fails closed without launch or cleanup when process inspection times out", async () => {
  const timeout = Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), { code: "ETIMEDOUT" });
  let launched = false;
  let terminated = false;
  let removed = false;
  const deps = {
    readManifest: async () => manifest(),
    inspectProcess: async (_pid, timeoutMs) => {
      assert.equal(timeoutMs, 15000);
      throw timeout;
    },
    spawnBrowser: async () => { launched = true; return { pid: 9999 }; },
    terminateProcess: async () => { terminated = true; },
    removeManifest: async () => { removed = true; },
  };

  const status = await getBrowserOwnerStatus(options(), deps);
  assert.equal(status.state, "owner-status-unknown");
  assert.match(status.reason, /ETIMEDOUT/);
  await assert.rejects(startBrowserOwner(options(), deps), (error) => error.code === "owner-status-unknown");
  await assert.rejects(stopBrowserOwner(options(), deps), (error) => error.code === "owner-status-unknown");
  assert.equal(launched, false);
  assert.equal(terminated, false);
  assert.equal(removed, false);
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
    "--new-window",
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

test("stop tolerates an exact owner exiting between inspection and termination", async () => {
  let running = true;
  let removed = false;
  const result = await stopBrowserOwner(options({ stopTimeoutMs: 100 }), {
    readManifest: async () => manifest(),
    inspectProcess: async () => running ? exactProcess() : null,
    terminateProcess: async () => {
      running = false;
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    },
    removeManifest: async () => { removed = true; },
    delay: async () => {},
  });
  assert.equal(result.state, "stopped");
  assert.equal(removed, true);
});

test("stop removes a stale manifest without terminating any PID", async () => {
  let terminated = false;
  let removed = false;
  const result = await stopBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    findOwnerProcesses: async () => [],
    probeVersion: unavailable,
    isPortAvailable: async () => true,
    terminateProcess: async () => { terminated = true; },
    removeManifest: async () => { removed = true; },
  });
  assert.equal(result.staleManifestRemoved, true);
  assert.equal(terminated, false);
  assert.equal(removed, true);
});

test("stop retains the manifest when the recorded PID handed off to an exact owner", async () => {
  let terminated = false;
  let removed = false;
  await assert.rejects(stopBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    findOwnerProcesses: async () => [exactProcess({ pid: 6161 })],
    terminateProcess: async () => { terminated = true; },
    removeManifest: async () => { removed = true; },
  }), (error) => error.code === "owner-identity-changed");
  assert.equal(terminated, false);
  assert.equal(removed, false);
});

test("stop retains the manifest when a live listener has no exact owner", async () => {
  let terminated = false;
  let removed = false;
  await assert.rejects(stopBrowserOwner(options(), {
    readManifest: async () => manifest(),
    inspectProcess: async () => null,
    findOwnerProcesses: async () => [],
    probeVersion: async () => ({ browser: "Microsoft Edge/140.0", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/root" }),
    isPortAvailable: async () => false,
    terminateProcess: async () => { terminated = true; },
    removeManifest: async () => { removed = true; },
  }), (error) => error.code === "orphaned-owner");
  assert.equal(terminated, false);
  assert.equal(removed, false);
});
