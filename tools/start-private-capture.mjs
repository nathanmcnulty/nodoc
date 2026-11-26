import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const apiVersion = "2025-01-01";
const jobPattern = /^\/subscriptions\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/resourceGroups\/[a-zA-Z0-9_-]{1,90}\/providers\/Microsoft\.App\/jobs\/[a-z][a-z0-9-]{0,30}[a-z0-9]$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;

function matchesTemplate(template, planDigest, expectedImage) {
  const containers = template?.containers;
  const variables = containers?.[0]?.env;
  const planVariables = Array.isArray(variables) ? variables.filter(variable => variable?.name === "CAPTURE_PLAN_DIGEST") : [];
  return Array.isArray(containers) && containers.length === 1 && !template.initContainers?.length
    && /^.+@sha256:[a-f0-9]{64}$/u.test(containers[0]?.image ?? "")
    && (!expectedImage || containers[0].image === expectedImage)
    && planVariables.length === 1 && planVariables[0].value === planDigest && !planVariables[0].secretRef;
}

async function azure(method, url) {
  try {
    const { stdout } = await execute("az", ["rest", "--method", method, "--url", url, "--output", "json", "--only-show-errors"], {
      timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    return JSON.parse(stdout);
  } catch {
    // Azure errors and job templates can contain private configuration. Do not echo them to CI.
    throw new Error("Azure capture control request failed; inspect the approved Azure resource privately.");
  }
}

export async function startPrivateCapture({
  jobId, planDigest, request = azure, sleep = delay, now = Date.now, timeoutMs = 65 * 60 * 1000,
}) {
  if (!jobPattern.test(jobId ?? "") || !digestPattern.test(planDigest ?? "")
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 65 * 60 * 1000) {
    throw new Error("Supply an approved job resource ID, plan SHA-256 and bounded timeout.");
  }
  const base = `https://management.azure.com${jobId}`;
  const job = await request("get", `${base}?api-version=${apiVersion}`);
  const config = job?.properties?.configuration, template = job?.properties?.template;
  if (config?.triggerType !== "Manual" || config.replicaRetryLimit !== 0
    || !Number.isInteger(config.replicaTimeout) || config.replicaTimeout < 1 || config.replicaTimeout > 3600
    || config.manualTriggerConfig?.parallelism !== 1 || config.manualTriggerConfig?.replicaCompletionCount !== 1
    || !matchesTemplate(template, planDigest)) {
    throw new Error("Job configuration does not match the approved manual capture bounds and plan.");
  }
  const deadline = now() + timeoutMs;
  // Never retry start: an uncertain response may already have launched a capture.
  let execution;
  try { execution = await request("post", `${base}/start?api-version=${apiVersion}`); }
  catch { throw new Error("Capture start response is uncertain; inspect executions privately before any retry."); }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/u.test(execution?.name ?? "")) {
    throw new Error("Capture start response is uncertain; inspect executions privately before any retry.");
  }
  while (now() < deadline) {
    const result = await request("get", `${base}/executions/${execution.name}?api-version=${apiVersion}`);
    if (!matchesTemplate(result?.properties?.template, planDigest, template.containers[0].image)) {
      throw new Error("Execution template differs from the checked plan/image; it may be running. Inspect privately before any retry.");
    }
    const status = result?.properties?.status;
    if (status === "Succeeded") return { status, execution: execution.name };
    if (!["Running", "Processing", "Pending"].includes(status)) {
      throw new Error("Capture execution did not succeed; inspect private receipts before any retry.");
    }
    await sleep(Math.min(15000, Math.max(0, deadline - now())));
  }
  throw new Error("Capture wait timed out; the Azure execution may still be running. Inspect it before any retry.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startPrivateCapture({ jobId: process.env.CAPTURE_JOB_ID, planDigest: process.env.CAPTURE_PLAN_DIGEST })
    .then(() => console.log("Azure execution succeeded. Independent private receipt review is still required; no publication performed."))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
