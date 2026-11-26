import assert from "node:assert/strict";
import test from "node:test";
import { startPrivateCapture } from "../start-private-capture.mjs";

const jobId = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/synthetic/providers/Microsoft.App/jobs/synthetic-job";
const planDigest = "a".repeat(64);
function job() {
  return { properties: {
    configuration: { triggerType: "Manual", replicaRetryLimit: 0, replicaTimeout: 3600,
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 } },
    template: { containers: [{ image: `example.invalid/capture@sha256:${"b".repeat(64)}`,
      env: [{ name: "CAPTURE_PLAN_DIGEST", value: planDigest }] }] },
  } };
}
function harness({ configured = job(), statuses = ["Running", "Succeeded"], startError = false, executionTemplate = configured.properties.template } = {}) {
  let time = 0;
  const calls = [];
  return { jobId, planDigest, now: () => time, sleep: async ms => { time += ms; }, calls,
    request: async (method, url) => {
      calls.push({ method, url });
      if (url.includes("/start?")) {
        if (startError) throw new Error("uncertain start");
        return { name: "synthetic-execution" };
      }
      if (url.includes("/executions/")) return { properties: { status: statuses.shift() ?? "Running", template: executionTemplate } };
      return configured;
    } };
}

test("manual start uses no overrides, polls bounded execution and never publishes", async () => {
  const options = harness();
  assert.deepEqual(await startPrivateCapture(options), { status: "Succeeded", execution: "synthetic-execution" });
  assert.equal(options.calls.filter(call => call.method === "post").length, 1);
  assert.ok(options.calls.every(call => call.url.startsWith(`https://management.azure.com${jobId}`)));
});

test("rejects unsafe configuration and wrong plans before starting", async () => {
  for (const mutate of [
    value => { value.properties.configuration.triggerType = "Schedule"; },
    value => { value.properties.configuration.replicaRetryLimit = 1; },
    value => { value.properties.configuration.replicaTimeout = 3601; },
    value => { value.properties.configuration.manualTriggerConfig.parallelism = 2; },
    value => { value.properties.template.containers[0].image = "example.invalid/latest"; },
    value => { value.properties.template.containers[0].env[0].value = "b".repeat(64); },
    value => { value.properties.template.containers.push(value.properties.template.containers[0]); },
    value => { value.properties.template.containers[0].env.push(value.properties.template.containers[0].env[0]); },
    value => { value.properties.template.initContainers = [{ image: "synthetic" }]; },
  ]) {
    const configured = job(); mutate(configured);
    const options = harness({ configured });
    await assert.rejects(startPrivateCapture(options), /configuration/);
    assert.equal(options.calls.length, 1);
  }
  for (const patch of [{ jobId: `${jobId}/../other` }, { planDigest: "bad" }, { timeoutMs: Infinity }]) {
    const options = harness();
    await assert.rejects(startPrivateCapture({ ...options, ...patch }), /approved job/);
    assert.equal(options.calls.length, 0);
  }
});

test("failed, unknown and uncertain executions never automatically retry", async () => {
  for (const statuses of [["Failed"], ["Stopped"], ["Unknown"]]) {
    const options = harness({ statuses });
    await assert.rejects(startPrivateCapture(options), /did not succeed/);
    assert.equal(options.calls.filter(call => call.method === "post").length, 1);
  }
  const uncertain = harness({ startError: true });
  await assert.rejects(startPrivateCapture(uncertain), /start response is uncertain/);
  assert.equal(uncertain.calls.filter(call => call.method === "post").length, 1);
  const timeout = harness({ statuses: ["Running"] });
  await assert.rejects(startPrivateCapture({ ...timeout, timeoutMs: 1 }), /may still be running/);
  assert.equal(timeout.calls.filter(call => call.method === "post").length, 1);
});

test("changed or missing execution bindings cannot report success", async () => {
  for (const mutate of [
    template => { template.containers[0].env[0].value = "c".repeat(64); },
    template => { template.containers[0].image = `example.invalid/changed@sha256:${"c".repeat(64)}`; },
  ]) {
    const executionTemplate = job().properties.template;
    mutate(executionTemplate);
    const options = harness({ statuses: ["Succeeded"], executionTemplate });
    await assert.rejects(startPrivateCapture(options), /Execution template differs/);
    assert.equal(options.calls.filter(call => call.method === "post").length, 1);
  }
});
