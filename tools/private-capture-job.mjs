import { execFile, execFileSync, spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { repoRoot, buildSpecInventory } from "./spec-quality-lib.mjs";
import { assertNoRefreshLinks, privateRefreshDirectory } from "./portal-refresh-paths.mjs";
import { archiveDirectory, digestPattern, jsonBytes, openPrivateBlobStore, restoreArchive, sha256 } from "./private-capture-store.mjs";

export function validateCapturePlan(plan) {
  const keys = ["schemaVersion", "runId", "sourceRevision", "specId", "recipe", "recipeSha256", "tenantId", "targetId", "timeoutSeconds"];
  if (!plan || Object.keys(plan).sort().join() !== keys.sort().join() || plan.schemaVersion !== 1
    || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(plan.runId) || !/^[a-f0-9]{40}$/u.test(plan.sourceRevision)
    || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(plan.specId) || !/^tools\/capture-recipes\/[a-zA-Z0-9_-]+\.json$/u.test(plan.recipe)
    || !digestPattern.test(plan.recipeSha256) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(plan.tenantId)
    || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/u.test(plan.targetId)
    || !Number.isInteger(plan.timeoutSeconds) || plan.timeoutSeconds < 1 || plan.timeoutSeconds > 2700) {
    throw new Error("Invalid private capture plan.");
  }
  return plan;
}

export async function verifyCaptureSource(plan) {
  validateCapturePlan(plan);
  let revision;
  try { revision = (await readFile(path.join(repoRoot, ".capture-revision"), "utf8")).trim(); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" }).trim()) throw new Error("Capture requires a clean source checkout.");
  }
  if (plan.sourceRevision !== revision) throw new Error("Capture image/source revision mismatch.");
  const filename = path.join(repoRoot, plan.recipe);
  await assertNoRefreshLinks(filename);
  if (sha256(await readFile(filename)) !== plan.recipeSha256) throw new Error("Approved recipe digest mismatch.");
  if (!(await buildSpecInventory()).some(spec => spec.specId === plan.specId)) throw new Error("Unknown capture specification.");
}

export function captureArguments(plan, directory) {
  return ["--portal", plan.specId, "--recipe", path.join(repoRoot, plan.recipe), "--phase", "all",
    "--profile", "bounded", "--operation-ceiling", "observe-only",
    "--target-id", plan.targetId,
    "--cdp-endpoint", "http://127.0.0.1:9222", "--expected-product", "Chrome",
    "--artifacts", path.join(directory, "capture"), "--ledger-path", path.join(directory, "ledger.jsonl"),
    "--bundle-cache-dir", path.join(directory, "bundle-cache"),
    "--capture-supervision-timeout-ms", String(plan.timeoutSeconds * 1000)];
}

// The cloud supervisor owns the entire subprocess tree. Child diagnostics never enter job logs.
export async function executeCapture(plan, directory, signal, { driver = path.join(repoRoot, "tools", "run-portal-discovery.mjs"), refreshPortfolio = null } = {}) {
  const log = [];
  let size = 0, stopReason = null, escalation;
  const child = spawn(process.execPath, [driver, ...captureArguments(plan, directory)], {
    cwd: repoRoot, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: Object.fromEntries(["PATH", "SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP", "DISPLAY"].filter(key => process.env[key]).map(key => [key, process.env[key]])),
  });
  function kill(signalName) {
    if (!child.pid) return;
    if (process.platform === "win32") {
      execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], error => {
        if (error && child.exitCode === null) child.kill();
      });
    } else {
      try { process.kill(-child.pid, signalName); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
  function stop(reason) {
    if (stopReason) return;
    stopReason = reason;
    kill("SIGTERM");
    escalation = setTimeout(() => kill("SIGKILL"), 5000);
  }
  const abort = () => stop("capture-cancelled");
  const deadline = setTimeout(() => stop("capture-timeout"), plan.timeoutSeconds * 1000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const consume = chunk => {
    size += chunk.length;
    if (size <= 4 * 1024 * 1024) log.push(chunk);
    else stop("diagnostic-budget-exhausted");
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    await writeFile(path.join(directory, "driver-private.log"), Buffer.concat(log), { flag: "wx", mode: 0o600 });
    if (stopReason) return { status: "blocked", reason: stopReason };
    const run = JSON.parse(await readFile(path.join(directory, "capture", "discovery-run.json"), "utf8"));
    if (code !== 0 || run.status !== "completed") return { status: "blocked", reason: "capture-driver-blocked" };
    const runPortfolioRefresh = refreshPortfolio ?? (await import("./portal-refresh.mjs")).runPortfolioRefresh;
    const refresh = await runPortfolioRefresh({
      captures: [{ specId: plan.specId, artifacts: path.join(directory, "capture") }],
      cacheDir: path.join(directory, "refresh-cache"), outputDir: path.join(directory, "refresh"),
      asOf: new Date().toISOString(), freshnessDays: 30,
    });
    return refresh.execution.blockedCaptureCount || !Array.isArray(refresh.report?.captures)
      || refresh.report.captures.length !== 1 || refresh.report.captures[0]?.specId !== plan.specId
      || refresh.report.captures[0]?.captureComplete !== true
      ? { status: "blocked", reason: "capture-analysis-blocked" }
      : { status: "capture-completed", reason: "independent-review-required" };
  } catch (error) {
    await writeFile(path.join(directory, "driver-error.private.json"), jsonBytes({ message: error.message }), { flag: "wx", mode: 0o600 });
    return { status: "blocked", reason: "capture-process-failed" };
  } finally {
    clearTimeout(deadline);
    clearTimeout(escalation);
    signal.removeEventListener("abort", abort);
  }
}

const outcomeReasons = new Set(["independent-review-required", "capture-cancelled", "capture-timeout",
  "diagnostic-budget-exhausted", "capture-driver-blocked", "capture-analysis-blocked",
  "capture-process-failed", "authentication-required", "rate-limited"]);

function assertOutcome(outcome) {
  if (!["blocked", "capture-completed"].includes(outcome?.status) || !outcomeReasons.has(outcome.reason)) throw new Error("Invalid capture outcome.");
}

function readCompleted(bytes, planDigest) {
  const result = JSON.parse(bytes);
  assertOutcome(result);
  if (Object.keys(result).sort().join() !== ["status", "reason", "planDigest", "archiveDigest", "reused"].sort().join()
    || result.planDigest !== planDigest || !digestPattern.test(result.archiveDigest) || result.reused !== false) throw new Error("Completed run binding mismatch.");
  return result;
}

export async function restorePrivateCapture({ plan, store, directory }) {
  validateCapturePlan(plan);
  const planDigest = sha256(jsonBytes(plan));
  const binding = { runId: plan.runId, planDigest, sourceRevision: plan.sourceRevision };
  const started = await store.get(`runs/${plan.runId}/started.json`, 1024 * 1024);
  const completed = await store.get(`runs/${plan.runId}/completed.json`, 1024 * 1024);
  if (!started?.equals(jsonBytes(binding)) || !completed) throw new Error("No completed archive exists for this exact plan.");
  const result = readCompleted(completed, planDigest);
  await restoreArchive(store, result.archiveDigest, directory, binding);
  return { ...result, reused: true };
}

export async function runPrivateCapture({ plan, store, directory, execute = executeCapture, verify = verifyCaptureSource, renewalMs = 20000, recover = false }) {
  validateCapturePlan(plan);
  await verify(plan);
  directory = await privateRefreshDirectory(directory, { create: true });
  const planDigest = sha256(jsonBytes(plan));
  const binding = { runId: plan.runId, planDigest, sourceRevision: plan.sourceRevision };
  const prefix = `runs/${plan.runId}`;
  const lease = await store.acquire();
  const aborter = new AbortController();
  let leaseError = null, stopped = false, renew = Promise.resolve(), timer;
  const scheduleRenewal = () => {
    timer = setTimeout(() => {
      renew = lease.renew().then(() => { if (!stopped) scheduleRenewal(); }).catch(error => {
        leaseError = error;
        aborter.abort();
      });
    }, renewalMs);
  };
  scheduleRenewal();
  try {
    const started = await store.get(`${prefix}/started.json`, 1024 * 1024);
    if (started && !started.equals(jsonBytes(binding))) throw new Error("Run ID already belongs to a different plan.");
    const completed = await store.get(`${prefix}/completed.json`, 1024 * 1024);
    if (completed) {
      if (!started) throw new Error("Completed run lacks its original claim.");
      const result = readCompleted(completed, planDigest);
      await restoreArchive(store, result.archiveDigest, directory, binding);
      return { ...result, reused: true };
    }
    if (started && !recover) {
      // A lost runner may have sent requests. Do not infer it is safe to capture again.
      return { status: "blocked", reason: "interrupted-run-requires-review", planDigest, reused: true };
    }
    let outcome;
    if (recover) {
      if (!started) throw new Error("Recovery requires an existing claim; it never starts a capture.");
      const receipt = JSON.parse(await readFile(path.join(directory, "cloud-receipt.json")));
      if (Object.keys(receipt).sort().join() !== ["runId", "planDigest", "sourceRevision", "status", "reason"].sort().join()
        || Object.entries(binding).some(([key, value]) => receipt[key] !== value)) throw new Error("Retained capture receipt does not match the interrupted run.");
      outcome = { status: receipt.status, reason: receipt.reason };
    } else {
      if ((await readdir(directory)).length) throw new Error("A new run needs an empty private work directory.");
      await lease.renew();
      await store.put(`${prefix}/started.json`, jsonBytes(binding));
      outcome = await execute(plan, directory, aborter.signal);
      assertOutcome(outcome);
      await writeFile(path.join(directory, "cloud-receipt.json"), jsonBytes({ ...binding, status: outcome.status, reason: outcome.reason }), { flag: "wx", mode: 0o600 });
    }
    if (leaseError) throw leaseError;
    assertOutcome(outcome);
    const archiveDigest = await archiveDirectory(store, directory, binding);
    if (leaseError) throw leaseError;
    const result = { ...outcome, planDigest, archiveDigest, reused: false };
    // Completion is published only after every archived file has passed a remote readback.
    await lease.renew();
    await store.put(`${prefix}/completed.json`, jsonBytes(result));
    return result;
  } finally {
    stopped = true;
    clearTimeout(timer);
    await renew;
    await lease.release();
    if (leaseError) throw leaseError;
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    plan: { type: "string" }, "plan-digest": { type: "string" }, directory: { type: "string" },
    stage: { type: "boolean", default: false }, restore: { type: "boolean", default: false }, recover: { type: "boolean", default: false },
  } });
  if ([values.stage, values.restore, values.recover].filter(Boolean).length > 1) throw new Error("Select one operation.");
  const planDigest = values["plan-digest"] ?? process.env.CAPTURE_PLAN_DIGEST;
  const store = await openPrivateBlobStore();
  let bytes;
  if (values.plan) {
    if (planDigest) throw new Error("Use one private plan input.");
    await privateRefreshDirectory(path.dirname(path.resolve(values.plan)));
    await assertNoRefreshLinks(values.plan);
    bytes = await readFile(values.plan);
  } else if (digestPattern.test(planDigest ?? "")) {
    bytes = await store.get(`plans/${planDigest}.json`, 1024 * 1024);
    if (!bytes || sha256(bytes) !== planDigest) throw new Error("Private plan integrity failed.");
  } else throw new Error("Supply a private --plan or --plan-digest.");
  if (bytes.length > 1024 * 1024) throw new Error("Private plan exceeds the size limit.");
  const plan = validateCapturePlan(JSON.parse(bytes));
  if (values.stage) {
    const normalized = jsonBytes(plan), digest = sha256(normalized);
    await store.put(`plans/${digest}.json`, normalized);
    console.log(`Private plan staged: ${digest}`);
    return;
  }
  const options = { plan, store, directory: values.directory ?? "/work/capture" };
  const result = values.restore ? await restorePrivateCapture(options) : await runPrivateCapture({ ...options, recover: values.recover });
  if (values.restore) {
    console.log("Private archive restored and verified. No capture or publication performed.");
    return;
  }
  console.log(`Private capture: ${result.status}; ${result.reason}. No publication or fresh coverage claim.`);
  if (result.status === "blocked") process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error("Private capture failed. Preserve the private work directory and inspect private storage; do not blindly retry.");
  process.exitCode = 1;
});
