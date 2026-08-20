import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BrowserCdpOwnerError,
  DEFAULT_CDP_PORT,
  assertDedicatedProfilePath,
  findBrowserProcessesUsingProfile,
  resolveOwnerPaths,
  stopBrowserOwner,
  validateProfileKey,
} from "./browser-cdp-owner.mjs";

const cleanupSchemaVersion = 1;
const terminalDiscoveryStatuses = new Set(["completed", "blocked", "failed"]);
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class PortalDiscoveryCleanupError extends Error {
  constructor(code, message) {
    super(`portal-discovery-cleanup: ${message}`);
    this.name = "PortalDiscoveryCleanupError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PortalDiscoveryCleanupError(code, message);
}

function pathIsWithin(candidate, parent) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function readJsonDefault(filePath) {
  return readFile(filePath, "utf8").then((text) => JSON.parse(text));
}

async function inspectFileDefault(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function measureProfileDefault(profilePath) {
  const root = await inspectFileDefault(profilePath);
  if (!root) return { exists: false, bytes: 0, files: 0, directories: 0 };
  if (root.isSymbolicLink()) fail("profile-symlink", "refusing to remove a symbolic-link profile path.");
  if (!root.isDirectory()) fail("profile-not-directory", "refusing to remove a profile path that is not a directory.");

  const pending = [profilePath];
  let bytes = 0;
  let files = 0;
  let directories = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const currentInfo = current === profilePath ? root : await inspectFileDefault(current);
    if (!currentInfo) continue;
    if (currentInfo.isSymbolicLink()) {
      files += 1;
      bytes += Number(currentInfo.size) || 0;
      continue;
    }
    if (!currentInfo.isDirectory()) {
      files += 1;
      bytes += Number(currentInfo.size) || 0;
      continue;
    }
    directories += 1;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) pending.push(join(current, entry.name));
  }
  return { exists: true, bytes, files, directories };
}

async function writeReceiptDefault(receiptPath, value) {
  await mkdir(dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporaryPath, receiptPath);
}

const defaultDependencies = {
  inspectFile: inspectFileDefault,
  measureProfile: measureProfileDefault,
  readJson: readJsonDefault,
  removeProfile: (profilePath) => rm(profilePath, { force: true, recursive: true }),
  stopOwner: stopBrowserOwner,
  findProfileProcesses: findBrowserProcessesUsingProfile,
  writeReceipt: writeReceiptDefault,
  now: () => new Date().toISOString(),
};

function sanitizeOwnerResult(ownerResult) {
  return {
    state: ownerResult?.state ?? null,
    alreadyStopped: ownerResult?.alreadyStopped === true,
    staleManifestRemoved: ownerResult?.staleManifestRemoved === true,
    pid: Number.isSafeInteger(ownerResult?.pid) ? ownerResult.pid : null,
  };
}

function runDigest(run, artifactDir) {
  return createHash("sha256")
    .update(`${artifactDir}|${JSON.stringify(run)}`)
    .digest("hex")
    .slice(0, 24);
}

function validateArtifactDirectory(artifactDir, profilePath) {
  if (pathIsWithin(artifactDir, moduleRoot)) {
    fail("artifacts-in-repository", "discovery artifacts must remain outside the repository.");
  }
  if (pathIsWithin(artifactDir, profilePath) || pathIsWithin(profilePath, artifactDir)) {
    fail("artifact-profile-overlap", "the discovery artifact directory may not overlap the dedicated browser profile.");
  }
}

export function validateTerminalDiscoveryRun(run, artifactDir) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    fail("discovery-run-invalid", "discovery-run.json must contain an object.");
  }
  if (!terminalDiscoveryStatuses.has(run.status)) {
    fail("discovery-run-not-terminal", `discovery-run.json has non-terminal status ${JSON.stringify(run.status)}.`);
  }
  if (run.artifacts && resolve(run.artifacts) !== resolve(artifactDir)) {
    fail("artifact-path-mismatch", "discovery-run.json does not identify the requested artifact directory.");
  }
  if (!run.brief?.specId && !run.specId) {
    fail("discovery-run-invalid", "discovery-run.json is missing the portal/spec identity.");
  }
  if (run.status === "completed" && run.capture?.captureComplete !== true) {
    fail("capture-incomplete", "a completed close requires capture.captureComplete=true.");
  }
  return {
    status: run.status,
    specId: run.brief?.specId ?? run.specId,
    portal: run.brief?.portal ?? run.portal ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
  };
}

async function requireRegularFile(deps, filePath, label) {
  const info = await deps.inspectFile(filePath);
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    fail("minimum-artifact-missing", `${label} is required for a completed discovery close.`);
  }
}

function resolveReceiptPath(ownerRoot, profileKey, port, run, artifactDir, requestedPath) {
  const receiptsRoot = join(ownerRoot, "cleanup-receipts");
  const receiptPath = resolve(requestedPath ?? join(
    receiptsRoot,
    `${profileKey}-${port}-${runDigest(run, artifactDir)}.json`,
  ));
  if (receiptPath === receiptsRoot || !pathIsWithin(receiptPath, receiptsRoot)) {
    fail("receipt-path-invalid", "cleanup receipts must be a child of nodoc-cdp\\cleanup-receipts.");
  }
  return receiptPath;
}

export async function closePortalDiscovery(options = {}, dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  const profileKey = validateProfileKey(options.profileKey);
  const port = Number(options.port ?? DEFAULT_CDP_PORT);
  const artifactDir = resolve(options.artifacts ?? "");
  const ownerPaths = resolveOwnerPaths({
    profileKey,
    port,
    ownerRoot: options.ownerRoot,
    env: options.env,
    cwd: options.cwd,
  });
  const profilePath = assertDedicatedProfilePath(ownerPaths.profilePath, {
    ownerRoot: ownerPaths.ownerRoot,
    env: options.env,
  });
  validateArtifactDirectory(artifactDir, profilePath);

  let run;
  try {
    run = await deps.readJson(join(artifactDir, "discovery-run.json"));
  } catch (error) {
    if (error?.code === "ENOENT") fail("discovery-run-missing", "discovery-run.json is required before closing a portal run.");
    if (error instanceof SyntaxError) fail("discovery-run-invalid", "discovery-run.json is not valid JSON.");
    throw error;
  }
  const discovery = validateTerminalDiscoveryRun(run, artifactDir);
  if (discovery.status === "completed") {
    await requireRegularFile(deps, join(artifactDir, "summary.json"), "summary.json");
    await requireRegularFile(deps, join(artifactDir, "candidate-handoff.json"), "candidate-handoff.json");
  }

  const ownerResult = await deps.stopOwner({
    profileKey,
    port,
    ownerRoot: ownerPaths.ownerRoot,
    env: options.env,
    cwd: options.cwd,
    processInspectionTimeoutMs: options.processInspectionTimeoutMs,
    stopTimeoutMs: options.stopTimeoutMs,
  }, dependencies.ownerDependencies ?? {});
  const remainingProcesses = await deps.findProfileProcesses(profilePath, {
    platform: options.platform,
    timeoutMs: options.processInspectionTimeoutMs,
  });
  if (remainingProcesses.length > 0) {
    fail("profile-in-use", `refusing profile cleanup while ${remainingProcesses.length} browser process(es) reference the dedicated profile.`);
  }

  const before = await deps.measureProfile(profilePath);
  let profileAction = "retained";
  if (options.purgeProfile === true) {
    if (before.exists) {
      // Recheck immediately before the destructive operation so a concurrent
      // idempotent close cannot turn a missing profile into an unsafe target.
      const latest = await deps.measureProfile(profilePath);
      if (!latest.exists) {
        profileAction = "already-absent";
      } else {
        await deps.removeProfile(profilePath);
      }
      const after = await deps.inspectFile(profilePath);
      if (after) fail("profile-remove-incomplete", "the dedicated browser profile still exists after cleanup.");
      if (profileAction !== "already-absent") profileAction = "purged";
    } else {
      profileAction = "already-absent";
    }
  }

  const receiptPath = resolveReceiptPath(
    ownerPaths.ownerRoot,
    profileKey,
    port,
    run,
    artifactDir,
    options.receiptPath,
  );
  const receipt = {
    schemaVersion: cleanupSchemaVersion,
    operation: "portal-discovery-close",
    status: "closed",
    closedAt: deps.now(),
    profile: {
      key: profileKey,
      path: profilePath,
      action: profileAction,
      existedBefore: before.exists,
      bytesBefore: before.bytes,
      filesBefore: before.files,
      directoriesBefore: before.directories,
    },
    discovery: {
      specId: discovery.specId,
      portal: discovery.portal,
      status: discovery.status,
      startedAt: discovery.startedAt,
      completedAt: discovery.completedAt,
      artifacts: artifactDir,
    },
    owner: sanitizeOwnerResult(ownerResult),
    preserved: {
      immutableArtifacts: true,
      derivativeBundleCache: true,
      worktreesAndBranches: "not-managed-by-this-command",
    },
  };
  await deps.writeReceipt(receiptPath, receipt);
  return { ...receipt, receiptPath };
}

function parseArgs(argv) {
  const args = {
    artifacts: null,
    profileKey: null,
    ownerRoot: null,
    port: DEFAULT_CDP_PORT,
    purgeProfile: false,
    receiptPath: null,
    processInspectionTimeoutMs: undefined,
    stopTimeoutMs: undefined,
  };
  const valueFlags = new Map([
    ["--artifacts", "artifacts"],
    ["--profile-key", "profileKey"],
    ["--owner-root", "ownerRoot"],
    ["--port", "port"],
    ["--receipt-path", "receiptPath"],
    ["--process-inspection-timeout-ms", "processInspectionTimeoutMs"],
    ["--stop-timeout-ms", "stopTimeoutMs"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--purge-profile") {
      args.purgeProfile = true;
      continue;
    }
    const property = valueFlags.get(argument);
    const value = argv[index + 1];
    if (!property || value === undefined) {
      fail("argument-invalid", `unknown or incomplete argument: ${argument}`);
    }
    args[property] = property === "port" || property.endsWith("TimeoutMs")
      ? Number(value)
      : property === "artifacts" || property === "ownerRoot" || property === "receiptPath"
        ? resolve(value)
        : value;
    index += 1;
  }
  if (!args.artifacts || !args.profileKey) {
    fail("argument-invalid", "usage: portal-discovery-cleanup.mjs --artifacts <directory> --profile-key <key> [--purge-profile]");
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    fail("argument-invalid", "--port must be an integer from 1024 through 65535.");
  }
  return args;
}

export async function runPortalDiscoveryCleanupCli(argv = process.argv.slice(2)) {
  return closePortalDiscovery(parseArgs(argv));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPortalDiscoveryCleanupCli()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      const code = error instanceof BrowserCdpOwnerError || error instanceof PortalDiscoveryCleanupError
        ? error.code
        : "unexpected-error";
      console.error(JSON.stringify({ error: code, message: error.message }));
      process.exitCode = 2;
    });
}
