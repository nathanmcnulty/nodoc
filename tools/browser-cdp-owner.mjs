import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { matchesExpectedProduct } from "./browser-cdp-preflight.mjs";

export const DEFAULT_CDP_HOST = "127.0.0.1";
export const DEFAULT_CDP_PORT = 9222;
export const OWNER_PREFLIGHT_REQUIRED_CODE = "preflight-required";
const manifestSchemaVersion = 1;
const manifestOwner = "nodoc-browser-cdp";
const maxVersionBytes = 64 * 1024;
const defaultTimeoutMs = 2500;
const defaultProcessInspectionTimeoutMs = 15000;
const supportedBrowsers = new Set(["auto", "edge", "chrome"]);

export class BrowserCdpOwnerError extends Error {
  constructor(code, message) {
    super(`browser-cdp-owner: ${message}`);
    this.name = "BrowserCdpOwnerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BrowserCdpOwnerError(code, message);
}

export function validateProfileKey(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62})$/u.test(key)) {
    fail("profile-key-invalid", "profile key must be 1-63 lowercase letters, digits, dots, underscores, or hyphens.");
  }
  if (key === "default" || key === "system-profile") {
    fail("default-profile-rejected", "the browser default profile is forbidden; choose a stable portal-specific profile key.");
  }
  return key;
}

function normalizeBrowser(value = "auto") {
  const browser = String(value).toLowerCase();
  if (!supportedBrowsers.has(browser)) fail("browser-invalid", "browser must be auto, edge, or chrome.");
  return browser;
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail("port-invalid", "port must be a fixed integer from 1024 through 65535.");
  }
  return port;
}

function validatePortalUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("portal-url-invalid", "start requires a valid HTTPS --portal-url.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("portal-url-invalid", "portal URL must use HTTPS and must not contain credentials.");
  }
  return url;
}

function pathIsWithin(candidate, parent) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveOwnerPaths({
  profileKey,
  port = DEFAULT_CDP_PORT,
  env = process.env,
  cwd = process.cwd(),
  ownerRoot,
} = {}) {
  const key = validateProfileKey(profileKey);
  const fixedPort = validatePort(port);
  const root = resolve(ownerRoot ?? (env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, "nodoc-cdp")
    : join(homedir(), ".nodoc-cdp")));
  if (pathIsWithin(root, cwd)) {
    fail("owner-root-in-repository", "owner state and browser profiles must be outside the repository.");
  }
  return {
    ownerRoot: root,
    profilePath: join(root, "profiles", key),
    manifestPath: join(root, "manifests", `${key}-${fixedPort}.json`),
  };
}

export function profileDigest(profilePath) {
  return createHash("sha256").update(normalizePathForComparison(profilePath)).digest("hex");
}

function windowsBrowserCandidates(env = process.env) {
  const candidates = [];
  const add = (product, browser, root, suffix) => {
    if (root) candidates.push({ product, browser, path: join(root, suffix) });
  };
  add("Edge", "edge", env["ProgramFiles(x86)"], "Microsoft\\Edge\\Application\\msedge.exe");
  add("Edge", "edge", env.ProgramFiles, "Microsoft\\Edge\\Application\\msedge.exe");
  add("Edge", "edge", env.LOCALAPPDATA, "Microsoft\\Edge\\Application\\msedge.exe");
  add("Chrome", "chrome", env.ProgramFiles, "Google\\Chrome\\Application\\chrome.exe");
  add("Chrome", "chrome", env["ProgramFiles(x86)"], "Google\\Chrome\\Application\\chrome.exe");
  add("Chrome", "chrome", env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe");
  return candidates;
}

export async function resolveBrowserBinary({
  browser = "auto",
  binaryPath,
  env = process.env,
  platform = process.platform,
  pathExists = async (path) => access(path).then(() => true, () => false),
} = {}) {
  const requested = normalizeBrowser(browser);
  if (platform !== "win32") fail("platform-unsupported", "browser launch is supported only on Windows.");
  if (binaryPath) {
    if (requested === "auto") fail("browser-required", "--binary requires an explicit --browser edge or chrome.");
    const candidate = resolve(binaryPath);
    if (!await pathExists(candidate)) fail("browser-not-found", `browser binary does not exist: ${candidate}`);
    return { browser: requested, product: requested === "edge" ? "Edge" : "Chrome", path: candidate };
  }
  const candidates = windowsBrowserCandidates(env).filter((candidate) => requested === "auto" || candidate.browser === requested);
  for (const candidate of candidates) {
    if (await pathExists(candidate.path)) return candidate;
  }
  fail("browser-not-found", `could not find ${requested === "auto" ? "Edge or Chrome" : requested} in deterministic Windows install paths.`);
}

export function assertDedicatedProfilePath(profilePath, {
  ownerRoot,
  env = process.env,
} = {}) {
  const resolvedProfile = resolve(profilePath);
  const resolvedRoot = resolve(ownerRoot);
  const forbidden = [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Microsoft", "Edge", "User Data"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Google", "Chrome", "User Data"),
  ].filter(Boolean).map((path) => resolve(path).toLowerCase());
  if (forbidden.includes(resolvedProfile.toLowerCase())) {
    fail("default-profile-rejected", "the normal browser user-data directory cannot be used for CDP.");
  }
  if (!pathIsWithin(resolvedProfile, join(resolvedRoot, "profiles")) || resolvedProfile === join(resolvedRoot, "profiles")) {
    fail("profile-path-invalid", "profile must be a dedicated child of the nodoc-cdp profiles directory.");
  }
  return resolvedProfile;
}

export function buildLaunchCommand({
  binaryPath,
  profilePath,
  ownerRoot,
  port = DEFAULT_CDP_PORT,
  portalUrl,
  ownerToken,
  env = process.env,
} = {}) {
  const fixedPort = validatePort(port);
  const url = validatePortalUrl(portalUrl);
  if (!isAbsolute(binaryPath)) fail("browser-path-invalid", "browser binary path must be absolute.");
  const dedicatedProfile = assertDedicatedProfilePath(profilePath, { ownerRoot, env });
  if (!/^[a-f0-9-]{16,128}$/iu.test(String(ownerToken ?? ""))) fail("owner-token-invalid", "owner token is invalid.");
  return {
    command: resolve(binaryPath),
    args: [
      `--remote-debugging-address=${DEFAULT_CDP_HOST}`,
      `--remote-debugging-port=${fixedPort}`,
      `--user-data-dir=${dedicatedProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--nodoc-cdp-owner=${ownerToken}`,
      url.href,
    ],
  };
}

function productMatches(browser, expectedProduct) {
  return matchesExpectedProduct(browser, expectedProduct);
}

async function boundedResponseText(response, limit = maxVersionBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (declaredLength > limit) fail("cdp-response-too-large", "/json/version response exceeds the size limit.");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) fail("cdp-response-too-large", "/json/version response exceeds the size limit.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      fail("cdp-response-too-large", "/json/version response exceeds the size limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function probeCdpVersion({
  endpoint,
  expectedProduct,
  timeoutMs = defaultTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  const base = new URL(endpoint);
  if (base.protocol !== "http:" || base.hostname !== DEFAULT_CDP_HOST || base.pathname !== "/" || base.search || base.hash) {
    fail("endpoint-invalid", `endpoint must be exactly http://${DEFAULT_CDP_HOST}:<fixed-port>/.`);
  }
  let response;
  try {
    response = await fetchImpl(new URL("/json/version", base), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof BrowserCdpOwnerError) throw error;
    fail("cdp-unavailable", `CDP /json/version was unavailable within ${timeoutMs}ms.`);
  }
  if (!response.ok) fail("cdp-invalid", `/json/version returned HTTP ${response.status}.`);
  let version;
  try {
    version = JSON.parse(await boundedResponseText(response));
  } catch (error) {
    if (error instanceof BrowserCdpOwnerError) throw error;
    fail("cdp-invalid", "/json/version did not return valid JSON.");
  }
  if (typeof version?.Browser !== "string" || typeof version?.webSocketDebuggerUrl !== "string") {
    fail("cdp-invalid", "/json/version is missing required browser metadata.");
  }
  if (!/^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//iu.test(version.webSocketDebuggerUrl)) {
    fail("cdp-invalid", "/json/version returned a non-loopback browser WebSocket.");
  }
  if (expectedProduct && !productMatches(version.Browser, expectedProduct)) {
    fail("product-mismatch", `/json/version product ${JSON.stringify(version.Browser)} is not ${expectedProduct}.`);
  }
  return {
    browser: version.Browser,
    protocolVersion: String(version.Protocol ?? ""),
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
  };
}

function validateManifest(value, expected) {
  const valid = value
    && value.schemaVersion === manifestSchemaVersion
    && value.owner === manifestOwner
    && value.profileKey === expected.profileKey
    && value.host === DEFAULT_CDP_HOST
    && value.port === expected.port
    && value.endpoint === expected.endpoint
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && ["Edge", "Chrome"].includes(value.product)
    && typeof value.binaryPath === "string" && isAbsolute(value.binaryPath)
    && value.profileDigest === profileDigest(expected.profilePath)
    && /^[a-f0-9-]{16,128}$/iu.test(value.ownerToken)
    && typeof value.createdAt === "string";
  if (!valid) fail("manifest-invalid", "owner manifest is corrupt or does not match the requested profile and port.");
  return value;
}

function normalizePathForComparison(value) {
  return resolve(value).replace(/[\\/]+$/u, "").toLowerCase();
}

export function parseWindowsCommandLineArguments(commandLine) {
  const argumentsList = [];
  let current = "";
  let quoted = false;
  for (const character of String(commandLine ?? "")) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/u.test(character) && !quoted) {
      if (current) argumentsList.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quoted) return [];
  if (current) argumentsList.push(current);
  return argumentsList;
}

export function isExactManifestOwner(manifest, processInfo, profilePath = manifest.profilePath) {
  if (!processInfo || Number(processInfo.pid) !== manifest.pid) return false;
  if (normalizePathForComparison(processInfo.executablePath ?? "") !== normalizePathForComparison(manifest.binaryPath)) return false;
  const argumentsList = parseWindowsCommandLineArguments(processInfo.commandLine);
  const switchValues = (name) => argumentsList
    .filter((argument) => argument.toLowerCase().startsWith(`--${name.toLowerCase()}=`))
    .map((argument) => argument.slice(argument.indexOf("=") + 1));
  const ownerTokens = switchValues("nodoc-cdp-owner");
  const ports = switchValues("remote-debugging-port");
  const profiles = switchValues("user-data-dir");
  return ownerTokens.length === 1 && ownerTokens[0] === manifest.ownerToken
    && ports.length === 1 && ports[0] === String(manifest.port)
    && profiles.length === 1
    && normalizePathForComparison(profiles[0]) === normalizePathForComparison(profilePath);
}

async function readOwnerManifest(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) fail("manifest-invalid", "owner manifest is not valid JSON.");
    throw error;
  }
}

async function writeOwnerManifest(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporaryPath, path);
}

async function defaultPortAvailable(host, port) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolvePromise(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolvePromise(true)));
  });
}

function inspectWindowsProcess(pid, timeoutMs = defaultProcessInspectionTimeoutMs) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    "if ($null -ne $p) { $p | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail("process-inspection-failed", "could not inspect the manifest PID.");
  if (!result.stdout.trim()) return null;
  const value = JSON.parse(result.stdout);
  return {
    pid: Number(value.ProcessId),
    executablePath: value.ExecutablePath,
    commandLine: value.CommandLine,
  };
}

function findWindowsOwnerProcesses(ownerToken, timeoutMs = defaultProcessInspectionTimeoutMs) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%--nodoc-cdp-owner=${ownerToken}%'" -ErrorAction SilentlyContinue`,
    "$items = @($p | Select-Object ProcessId,ExecutablePath,CommandLine)",
    "if ($items.Count -gt 0) { ConvertTo-Json -InputObject $items -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail("process-inspection-failed", "could not enumerate owner-token processes.");
  if (!result.stdout.trim()) return [];
  const values = JSON.parse(result.stdout);
  return (Array.isArray(values) ? values : [values]).map((value) => ({
    pid: Number(value.ProcessId),
    executablePath: value.ExecutablePath,
    commandLine: value.CommandLine,
  }));
}

function findWindowsBrowserProcesses(timeoutMs = defaultProcessInspectionTimeoutMs) {
  const script = [
    "$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(msedge|chrome)(\\.exe)?$' -and $_.CommandLine }",
    "$items = @($p | Select-Object ProcessId,ExecutablePath,CommandLine)",
    "if ($items.Count -gt 0) { ConvertTo-Json -InputObject $items -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail("process-inspection-failed", "could not enumerate browser processes.");
  if (!result.stdout.trim()) return [];
  const values = JSON.parse(result.stdout);
  return (Array.isArray(values) ? values : [values]).map((value) => ({
    pid: Number(value.ProcessId),
    executablePath: value.ExecutablePath,
    commandLine: value.CommandLine,
  }));
}

export function isBrowserProcessUsingProfile(processInfo, profilePath) {
  const targetProfile = normalizePathForComparison(profilePath);
  const argumentsList = parseWindowsCommandLineArguments(processInfo?.commandLine);
  const exactProfileArgument = argumentsList
    .filter((argument) => argument.toLowerCase().startsWith("--user-data-dir="))
    .some((argument) => normalizePathForComparison(argument.slice(argument.indexOf("=") + 1)) === targetProfile);
  if (exactProfileArgument) return true;
  // An unbalanced or otherwise unparsable command line is unsafe to ignore
  // when it still contains the validated profile path. Block rather than
  // risk deleting a profile that a browser may have open.
  const rawCommandLine = String(processInfo?.commandLine ?? "")
    .replaceAll("/", "\\")
    .toLowerCase();
  return rawCommandLine.includes(targetProfile);
}

export function findBrowserProcessesUsingProfile(profilePath, {
  platform = process.platform,
  timeoutMs = defaultProcessInspectionTimeoutMs,
} = {}) {
  if (platform !== "win32") fail("platform-unsupported", "browser process inspection is supported only on Windows.");
  return findWindowsBrowserProcesses(timeoutMs)
    .filter((processInfo) => isBrowserProcessUsingProfile(processInfo, profilePath))
    .map(({ pid, executablePath }) => ({ pid, executablePath }));
}

function defaultSpawnBrowser(command, args) {
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  if (!Number.isSafeInteger(child.pid)) fail("launch-failed", "browser process did not return a PID.");
  return { pid: child.pid };
}

function defaultTerminateProcess(pid) {
  process.kill(pid);
}

const defaultDependencies = {
  findOwnerProcesses: findWindowsOwnerProcesses,
  inspectProcess: inspectWindowsProcess,
  isPortAvailable: defaultPortAvailable,
  probeVersion: probeCdpVersion,
  readManifest: readOwnerManifest,
  removeManifest: (path) => rm(path, { force: true }),
  resolveBinary: resolveBrowserBinary,
  spawnBrowser: defaultSpawnBrowser,
  terminateProcess: defaultTerminateProcess,
  writeManifest: writeOwnerManifest,
  randomUUID,
  now: () => new Date().toISOString(),
  delay,
};

function ownerConfiguration(options = {}) {
  const profileKey = validateProfileKey(options.profileKey);
  const port = validatePort(options.port ?? DEFAULT_CDP_PORT);
  const endpoint = `http://${DEFAULT_CDP_HOST}:${port}`;
  const paths = resolveOwnerPaths({ ...options, profileKey, port });
  assertDedicatedProfilePath(paths.profilePath, { ownerRoot: paths.ownerRoot, env: options.env });
  return { profileKey, port, endpoint, ...paths };
}

async function probeSafely(deps, options) {
  try {
    return { ok: true, version: await deps.probeVersion(options) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function inspectProcessSafely(deps, pid, timeoutMs) {
  try {
    return { ok: true, processInfo: await deps.inspectProcess(pid, timeoutMs) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function findExactOwnerCandidatesSafely(deps, manifest, profilePath, timeoutMs) {
  try {
    const candidates = await deps.findOwnerProcesses(manifest.ownerToken, timeoutMs);
    return {
      ok: true,
      candidates: candidates.filter((candidate) => isExactManifestOwner(
        { ...manifest, pid: candidate.pid },
        candidate,
        profilePath,
      )),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function getBrowserOwnerStatus(options = {}, dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  const config = ownerConfiguration(options);
  const rawManifest = await deps.readManifest(config.manifestPath);
  if (!rawManifest) {
    const probe = await probeSafely(deps, { endpoint: config.endpoint, expectedProduct: null, timeoutMs: options.timeoutMs });
    if (probe.ok) return { state: "occupied-unknown", endpoint: config.endpoint, profileKey: config.profileKey, browser: probe.version.browser };
    if (probe.error?.code !== "cdp-unavailable") {
      return { state: "occupied-unknown", endpoint: config.endpoint, profileKey: config.profileKey, reason: probe.error.message };
    }
    const available = await deps.isPortAvailable(DEFAULT_CDP_HOST, config.port);
    return { state: available ? "stopped" : "occupied-unknown", endpoint: config.endpoint, profileKey: config.profileKey };
  }
  const manifest = validateManifest(rawManifest, config);
  const inspection = await inspectProcessSafely(
    deps,
    manifest.pid,
    options.processInspectionTimeoutMs ?? defaultProcessInspectionTimeoutMs,
  );
  if (!inspection.ok) {
    return {
      state: "owner-status-unknown",
      endpoint: config.endpoint,
      profileKey: config.profileKey,
      pid: manifest.pid,
      reason: inspection.error?.message ?? String(inspection.error),
    };
  }
  const processInfo = inspection.processInfo;
  if (!processInfo) {
    const candidates = await findExactOwnerCandidatesSafely(
      deps,
      manifest,
      config.profilePath,
      options.processInspectionTimeoutMs ?? defaultProcessInspectionTimeoutMs,
    );
    if (!candidates.ok) {
      return {
        state: "owner-status-unknown",
        endpoint: config.endpoint,
        profileKey: config.profileKey,
        pid: manifest.pid,
        reason: candidates.error?.message ?? String(candidates.error),
      };
    }
    if (candidates.candidates.length > 0) {
      return {
        state: "owner-identity-changed",
        endpoint: config.endpoint,
        profileKey: config.profileKey,
        pid: manifest.pid,
        exactCandidateCount: candidates.candidates.length,
      };
    }
    const probe = await probeSafely(deps, {
      endpoint: config.endpoint,
      expectedProduct: manifest.product,
      timeoutMs: options.timeoutMs,
    });
    const available = await deps.isPortAvailable(DEFAULT_CDP_HOST, config.port);
    if (probe.ok || !available) {
      return {
        state: "orphaned-owner",
        endpoint: config.endpoint,
        profileKey: config.profileKey,
        pid: manifest.pid,
        reason: probe.ok ? "CDP listener remained live after the recorded owner PID disappeared." : probe.error?.message,
      };
    }
    return { state: "stale-manifest", endpoint: config.endpoint, profileKey: config.profileKey, pid: manifest.pid };
  }
  if (!isExactManifestOwner(manifest, processInfo, config.profilePath)) {
    return { state: "ownership-mismatch", endpoint: config.endpoint, profileKey: config.profileKey, pid: manifest.pid };
  }
  const probe = await probeSafely(deps, {
    endpoint: config.endpoint,
    expectedProduct: manifest.product,
    timeoutMs: options.timeoutMs,
  });
  if (!probe.ok) {
    return {
      state: probe.error?.code === "product-mismatch" ? "product-mismatch" : "owner-unhealthy",
      endpoint: config.endpoint,
      profileKey: config.profileKey,
      pid: manifest.pid,
      reason: probe.error?.message ?? String(probe.error),
    };
  }
  return {
    state: "healthy",
    endpoint: config.endpoint,
    profileKey: config.profileKey,
    product: manifest.product,
    browser: probe.version.browser,
    pid: manifest.pid,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      profileKey: manifest.profileKey,
      endpoint: manifest.endpoint,
      port: manifest.port,
      product: manifest.product,
      pid: manifest.pid,
      createdAt: manifest.createdAt,
    },
  };
}

function ownerReadyNextStep({ endpoint, product, portalUrl }) {
  const host = new URL(portalUrl).hostname;
  return {
    code: OWNER_PREFLIGHT_REQUIRED_CODE,
    lifecycleStatus: "owner-ready",
    authenticationStatus: "unverified",
    message: "Authentication is UNVERIFIED until authenticated preflight succeeds. Leave exactly one intended portal page open, complete sign-in only if the browser UI requires it, then run authenticated preflight.",
    command: `npm run preflight:browser-cdp -- --endpoint ${endpoint} --expected-product ${product} --match-host ${host}`,
  };
}

export async function startBrowserOwner(options = {}, dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  const config = ownerConfiguration(options);
  const portalUrl = validatePortalUrl(options.portalUrl);
  const requestedBrowser = normalizeBrowser(options.browser);
  const status = await getBrowserOwnerStatus(options, deps);
  if (status.state === "healthy") {
    if (requestedBrowser !== "auto" && status.manifest.product.toLowerCase() !== requestedBrowser) {
      fail("browser-mismatch", `healthy owner is ${status.manifest.product}, not requested ${requestedBrowser}.`);
    }
    return {
      state: "running",
      reused: true,
      endpoint: config.endpoint,
      profileKey: config.profileKey,
      product: status.manifest.product,
      pid: status.pid,
      nextStep: ownerReadyNextStep({ endpoint: config.endpoint, product: status.manifest.product, portalUrl }),
    };
  }
  if (status.state !== "stopped") {
    fail(status.state, `refusing to launch while owner status is ${status.state}; inspect status and resolve it explicitly.`);
  }
  const binary = await deps.resolveBinary({
    browser: requestedBrowser,
    binaryPath: options.binaryPath,
    env: options.env,
    platform: options.platform,
    pathExists: options.pathExists,
  });
  await mkdir(config.profilePath, { recursive: true });
  const ownerToken = deps.randomUUID();
  const launch = buildLaunchCommand({
    binaryPath: binary.path,
    profilePath: config.profilePath,
    ownerRoot: config.ownerRoot,
    port: config.port,
    portalUrl,
    ownerToken,
    env: options.env,
  });
  const child = await deps.spawnBrowser(launch.command, launch.args);
  const manifest = {
    schemaVersion: manifestSchemaVersion,
    owner: manifestOwner,
    profileKey: config.profileKey,
    host: DEFAULT_CDP_HOST,
    port: config.port,
    endpoint: config.endpoint,
    pid: child.pid,
    product: binary.product,
    binaryPath: launch.command,
    profileDigest: profileDigest(config.profilePath),
    ownerToken,
    createdAt: deps.now(),
  };
  await deps.writeManifest(config.manifestPath, manifest);
  const deadline = Date.now() + (options.launchTimeoutMs ?? 10000);
  let lastError;
  do {
    try {
      const version = await deps.probeVersion({
        endpoint: config.endpoint,
        expectedProduct: binary.product,
        timeoutMs: Math.min(options.timeoutMs ?? defaultTimeoutMs, Math.max(1, deadline - Date.now())),
      });
      const candidates = await findExactOwnerCandidatesSafely(
        deps,
        manifest,
        config.profilePath,
        options.processInspectionTimeoutMs ?? defaultProcessInspectionTimeoutMs,
      );
      if (!candidates.ok) {
        fail("owner-status-unknown", `could not resolve the long-lived browser owner (${candidates.error?.message ?? String(candidates.error)}).`);
      }
      if (candidates.candidates.length > 1) {
        fail("owner-resolution-failed", `expected exactly one long-lived exact owner process, found ${candidates.candidates.length}; manifest retained for explicit recovery.`);
      }
      if (candidates.candidates.length === 0) {
        lastError = new BrowserCdpOwnerError(
          "owner-resolution-failed",
          "expected exactly one long-lived exact owner process, found 0; manifest retained for explicit recovery.",
        );
        await deps.delay(Math.min(150, Math.max(1, deadline - Date.now())));
        continue;
      }
      const resolvedPid = candidates.candidates[0].pid;
      if (manifest.pid !== resolvedPid) {
        manifest.pid = resolvedPid;
        await deps.writeManifest(config.manifestPath, manifest);
      }
      return {
        state: "running",
        reused: false,
        endpoint: config.endpoint,
        profileKey: config.profileKey,
        product: binary.product,
        browser: version.browser,
        pid: resolvedPid,
        nextStep: ownerReadyNextStep({ endpoint: config.endpoint, product: binary.product, portalUrl }),
      };
    } catch (error) {
      lastError = error;
      if (["product-mismatch", "owner-status-unknown", "owner-resolution-failed"].includes(error?.code)) {
        throw error;
      }
      await deps.delay(Math.min(150, Math.max(1, deadline - Date.now())));
    }
  } while (Date.now() < deadline);
  if (lastError?.code === "owner-resolution-failed") throw lastError;
  fail("launch-validation-failed", `browser launched but bounded CDP validation failed; manifest retained for exact-owner stop (${lastError?.message ?? "unknown error"}).`);
}

export async function rebindBrowserOwner(options = {}, dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  const config = ownerConfiguration(options);
  const rawManifest = await deps.readManifest(config.manifestPath);
  if (!rawManifest) fail("manifest-missing", "cannot rebind without an existing owner manifest.");
  const manifest = validateManifest(rawManifest, config);
  const inspection = await inspectProcessSafely(
    deps,
    manifest.pid,
    options.processInspectionTimeoutMs ?? defaultProcessInspectionTimeoutMs,
  );
  if (!inspection.ok) {
    fail("owner-status-unknown", `could not inspect the recorded owner PID (${inspection.error?.message ?? String(inspection.error)}).`);
  }
  if (inspection.processInfo) {
    fail(
      isExactManifestOwner(manifest, inspection.processInfo, config.profilePath) ? "owner-already-bound" : "ownership-mismatch",
      "refusing to rebind while the recorded manifest PID still exists.",
    );
  }
  const candidates = await findExactOwnerCandidatesSafely(
    deps,
    manifest,
    config.profilePath,
    options.processInspectionTimeoutMs ?? defaultProcessInspectionTimeoutMs,
  );
  if (!candidates.ok) {
    fail("owner-status-unknown", `could not resolve the replacement browser owner (${candidates.error?.message ?? String(candidates.error)}).`);
  }
  if (candidates.candidates.length !== 1) {
    fail("owner-resolution-failed", `rebind requires exactly one fully matching owner process, found ${candidates.candidates.length}; manifest unchanged.`);
  }
  const version = await deps.probeVersion({
    endpoint: config.endpoint,
    expectedProduct: manifest.product,
    timeoutMs: options.timeoutMs,
  });
  const reboundManifest = { ...manifest, pid: candidates.candidates[0].pid };
  await deps.writeManifest(config.manifestPath, reboundManifest);
  return {
    state: "healthy",
    rebound: true,
    lifecycleStatus: "owner-ready",
    authenticationStatus: "unverified",
    endpoint: config.endpoint,
    profileKey: config.profileKey,
    product: manifest.product,
    browser: version.browser,
    previousPid: manifest.pid,
    pid: reboundManifest.pid,
    nextStep: {
      code: OWNER_PREFLIGHT_REQUIRED_CODE,
      message: "Rebind restored lifecycle identity only. Run the recipe-gated authenticated preflight before ledger allocation or capture.",
    },
  };
}

export async function stopBrowserOwner(options = {}, dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  const config = ownerConfiguration(options);
  const rawManifest = await deps.readManifest(config.manifestPath);
  if (!rawManifest) {
    const status = await getBrowserOwnerStatus(options, deps);
    if (status.state === "occupied-unknown") {
      fail("not-manifest-owned", "refusing to stop a listener without a matching owner manifest.");
    }
    return { state: "stopped", alreadyStopped: true, endpoint: config.endpoint, profileKey: config.profileKey };
  }
  const manifest = validateManifest(rawManifest, config);
  const inspectionTimeoutMs = options.processInspectionTimeoutMs ?? defaultProcessInspectionTimeoutMs;
  const inspection = await inspectProcessSafely(deps, manifest.pid, inspectionTimeoutMs);
  if (!inspection.ok) {
    fail("owner-status-unknown", `could not verify the manifest PID; nothing was stopped (${inspection.error?.message ?? String(inspection.error)}).`);
  }
  const processInfo = inspection.processInfo;
  if (!processInfo) {
    const candidates = await findExactOwnerCandidatesSafely(deps, manifest, config.profilePath, inspectionTimeoutMs);
    if (!candidates.ok) {
      fail("owner-status-unknown", `could not verify replacement owner processes; nothing was stopped (${candidates.error?.message ?? String(candidates.error)}).`);
    }
    if (candidates.candidates.length > 0) {
      fail("owner-identity-changed", `recorded PID disappeared but ${candidates.candidates.length} exact owner candidate(s) remain; manifest retained and nothing was stopped.`);
    }
    const probe = await probeSafely(deps, {
      endpoint: config.endpoint,
      expectedProduct: manifest.product,
      timeoutMs: options.timeoutMs,
    });
    const available = await deps.isPortAvailable(DEFAULT_CDP_HOST, config.port);
    if (probe.ok || !available) {
      fail("orphaned-owner", "recorded PID disappeared while the endpoint remained occupied; manifest retained and nothing was stopped.");
    }
    await deps.removeManifest(config.manifestPath);
    return { state: "stopped", staleManifestRemoved: true, endpoint: config.endpoint, profileKey: config.profileKey };
  }
  if (!isExactManifestOwner(manifest, processInfo, config.profilePath)) {
    fail("exact-owner-required", "manifest PID does not exactly match its binary, profile, port, and owner token; nothing was stopped.");
  }
  try {
    await deps.terminateProcess(manifest.pid);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + (options.stopTimeoutMs ?? 5000);
  while (Date.now() < deadline) {
    await deps.delay(50);
    const pollInspection = await inspectProcessSafely(deps, manifest.pid, inspectionTimeoutMs);
    if (!pollInspection.ok) {
      fail("owner-status-unknown", `could not verify whether the exact owner exited; manifest retained (${pollInspection.error?.message ?? String(pollInspection.error)}).`);
    }
    if (!pollInspection.processInfo) {
      await deps.removeManifest(config.manifestPath);
      return { state: "stopped", pid: manifest.pid, endpoint: config.endpoint, profileKey: config.profileKey };
    }
  }
  fail("stop-timeout", "exact owner did not exit before the bounded timeout; manifest retained.");
}

function parseCli(argv) {
  const command = argv[0];
  if (!["status", "start", "rebind", "stop"].includes(command)) {
    fail("command-invalid", "usage: browser-cdp-owner.mjs <status|start|rebind|stop> --profile-key <key> [options]");
  }
  const options = {};
  const flags = new Map([
    ["--profile-key", "profileKey"],
    ["--portal-url", "portalUrl"],
    ["--port", "port"],
    ["--browser", "browser"],
    ["--binary", "binaryPath"],
    ["--timeout-ms", "timeoutMs"],
    ["--process-inspection-timeout-ms", "processInspectionTimeoutMs"],
    ["--launch-timeout-ms", "launchTimeoutMs"],
    ["--stop-timeout-ms", "stopTimeoutMs"],
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const property = flags.get(argv[index]);
    const value = argv[index + 1];
    if (!property || value === undefined) fail("argument-invalid", `unknown or incomplete argument: ${argv[index]}`);
    options[property] = ["port", "timeoutMs", "processInspectionTimeoutMs", "launchTimeoutMs", "stopTimeoutMs"].includes(property) ? Number(value) : value;
  }
  return { command, options };
}

export async function runBrowserCdpOwnerCli(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (command === "status") return getBrowserOwnerStatus(options);
  if (command === "start") return startBrowserOwner(options);
  if (command === "rebind") return rebindBrowserOwner(options);
  return stopBrowserOwner(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBrowserCdpOwnerCli()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ error: error.code ?? "unexpected-error", message: error.message }));
      process.exitCode = 2;
    });
}
