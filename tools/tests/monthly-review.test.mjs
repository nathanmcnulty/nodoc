import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { link, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { assertMonth, assertMonthlyReport, buildMonthlyPacket, buildMonthlyReport, loadMonthlyPacket, prepareMonthlyReview, reviewerArgs, validateSelections } from "../monthly-review.mjs";
import { publicationTarget, publishReport } from "../publish-monthly-review.mjs";
import { maxUsageBytes, parseUsageReceipt, readUsageBytes, storeUsage, usageBlobUrl } from "../store-monthly-usage.mjs";

const operation = { method: "GET", path: "/sample", schema: { gapLocations: ["responses/200/content-unknown"] }, examples: { gapLocations: [] } };
const spec = specId => ({ specId, title: specId, specPath: `specifications/nodoc-${specId}/specification/openapi.yml`,
  operationCount: 1, freshness: { schemaGaps: 1, exampleGaps: 0 }, operations: [operation] });
const fixture = () => buildMonthlyPacket({
  month: "2026-11", sourceRevision: "a".repeat(40), inventory: { specs: [spec("zeta"), spec("alpha")] },
  snapshot: { snapshotId: "2026-11-06", assessedAt: "2026-11-06T00:00:00Z", windowDays: 30, source: {}, totals: { currentObservations: 5 } },
});
const providerReceipt = () => ({ totalNanoAiu: 123456789, totalPremiumRequestCost: 0, modelMetrics: {}, agentMetrics: {} });
const receiptBytes = () => `${JSON.stringify(providerReceipt())}\n`;
const redacted = error => {
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(error.message, /PRIVATE_SENTINEL|synthetic-token|sig=|packetDigest/u);
  return /nothing will be published|cost remains unknown|upload failed/u.test(error.message);
};

test("offline report keeps historical observations separate and is reproducible", () => {
  const packet = fixture();
  const report = buildMonthlyReport(packet);
  assert.deepEqual(report, buildMonthlyReport(fixture()));
  assert.equal(report.month, "2026-11");
  assert.equal(report.observationAssessment.snapshotId, "2026-11-06");
  assert.equal(report.observationAssessment.totals.currentObservations, 5);
  assert.equal(report.review.status, "deterministic-only");
  assert.equal(report.review.model, null);
  assert.equal(report.review.usage.usd, null);
  assert.deepEqual(report.currentSource.map(entry => entry.specId), ["alpha", "zeta"]);
  assert.equal(assertMonthlyReport(report, packet), report);
});

test("review responses are capped, source bound and cannot introduce text or new routes", () => {
  const packet = fixture();
  const selection = { candidateId: packet.candidates[0].id, reason: "response-schema-gap" };
  const output = { packetDigest: packet.packetDigest, selections: [selection] };
  assert.deepEqual(validateSelections(output, packet), [selection]);
  assert.deepEqual(validateSelections({ ...output, selections: [] }, packet), []);
  for (const value of [
    { ...output, packetDigest: "old" }, { ...output, text: "unexpected" },
    { ...output, selections: Array(4).fill(selection) }, { ...output, selections: [selection, selection] },
    { ...output, selections: [{ ...selection, candidateId: "unknown" }] },
    { ...output, selections: [{ ...selection, reason: "request-schema-gap" }] },
    { ...output, selections: [{ ...selection, path: "/invented" }] },
  ]) assert.throws(() => validateSelections(value, packet));
  const report = buildMonthlyReport(packet, { model: "gpt-6-luna", output });
  assert.equal(assertMonthlyReport(report, packet), report);
  report.observationAssessment.assessedAt = "2026-12-01";
  assert.throws(() => assertMonthlyReport(report, fixture()), /checked-out public source/u);
});

test("publication path cannot escape reports/monthly and review fields are allowlisted", () => {
  for (const month of ["../2026-11", "2026-13", "2026-1", "2026-11\n"]) assert.throws(() => assertMonth(month));
  assert.deepEqual(publicationTarget("2026-11"), { branch: "automation/monthly-review-2026-11", file: "reports/monthly/2026-11.json" });
  const packet = fixture();
  for (const mutate of [
    value => { value.review.usage.usd = 0; }, value => { value.review.status = "observed"; },
    value => { value.extra = "unexpected"; }, value => { value.review.rawModelOutput = "unexpected"; },
    value => { value.review.selections = []; },
  ]) {
    const report = structuredClone(buildMonthlyReport(packet));
    mutate(report);
    assert.throws(() => assertMonthlyReport(report, packet));
  }
});

test("model invocation denies tools, pins identity, records usage and bounds execution", () => {
  const args = reviewerArgs(fixture(), "gpt-6-luna", "usage.json");
  assert.equal(args[args.indexOf("--deny-tool") + 1], "*");
  assert.equal(args[args.indexOf("--model") + 1], "gpt-6-luna");
  assert.equal(args[args.indexOf("--max-ai-credits") + 1], "30");
  for (const flag of ["--no-custom-instructions", "--disable-builtin-mcps", "--no-ask-user"]) assert.ok(args.includes(flag));
  assert.throws(() => reviewerArgs(fixture(), "auto", "usage.json"));
  assert.throws(() => reviewerArgs({ data: "x".repeat(32_000) }, "gpt-6-luna", "usage.json"), /32 KB/u);
});

test("private usage upload is Azure-only, create-only, nonredirecting and redacts failures", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const sas = "https://samplestorage.blob.core.windows.net/receipts?sp=c&sr=c&sig=example";
  assert.equal(usageBlobUrl(sas, id).pathname, `/receipts/monthly-usage/${id}.json`);
  for (const bad of [sas.replace("https:", "http:"), sas.replace(".blob.core.windows.net", ".example.com"),
    sas.replace("sp=c", "sp=rc"), sas.replace("sr=c", "sr=b"), sas.replace("/receipts?", "/?")]) {
    assert.throws(() => usageBlobUrl(bad, id));
  }
  await storeUsage(receiptBytes(), sas, { id, request: async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["If-None-Match"], "*");
    assert.equal(options.body, receiptBytes());
    return { status: 201 };
  } });
  await assert.rejects(storeUsage(receiptBytes(), sas, { id, request: async () => { throw new Error(`leaked ${sas}`); } }), error => {
    assert.ok(!error.message.includes("sig"));
    return /upload failed/u.test(error.message);
  });
  await assert.rejects(storeUsage("private-corrupted-data", sas), error => {
    assert.match(error.message, /malformed.*cost remains unknown/u);
    return true;
  });
  for (const status of [200, 302, 403, 409, 412, 500]) {
    await assert.rejects(storeUsage(receiptBytes(), sas, { request: async () => ({ status }) }), redacted);
  }
  assert.throws(() => usageBlobUrl("PRIVATE_SENTINEL?sig=synthetic-token", id), error => {
    assert.doesNotMatch(error.message, /PRIVATE_SENTINEL|sig=|synthetic-token/u);
    return true;
  });
});

test("only bounded provider accounting is a receipt; unknown is not converted to zero", async () => {
  assert.deepEqual(parseUsageReceipt(receiptBytes()), providerReceipt());
  const unavailable = { ...providerReceipt(), totalNanoAiu: null };
  assert.equal(parseUsageReceipt(JSON.stringify(unavailable)).totalNanoAiu, null);
  for (const value of [
    {}, null, [], { usd: 0 }, { ...providerReceipt(), totalNanoAiu: -1 },
    { ...providerReceipt(), totalNanoAiu: "0" }, { ...providerReceipt(), totalNanoAiu: 0.5 },
    { ...providerReceipt(), totalPremiumRequestCost: null },
    { ...providerReceipt(), totalPremiumRequestCost: -1 },
    { ...providerReceipt(), modelMetrics: null }, { ...providerReceipt(), agentMetrics: "PRIVATE_SENTINEL" },
  ]) assert.throws(() => parseUsageReceipt(JSON.stringify(value)), redacted);
  assert.throws(() => parseUsageReceipt(`{"PRIVATE_SENTINEL":"${"x".repeat(maxUsageBytes)}"}`), redacted);
  let called = false;
  await assert.rejects(storeUsage("{}", "PRIVATE_SENTINEL", { request: async () => { called = true; } }), redacted);
  assert.equal(called, false);
});

test("real fake CLI failures preserve current receipts without accepting answers or leaking diagnostics", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-fake-"));
  const fake = path.join(directory, "fake.mjs");
  // No live CLI or provider: a real child process exercises exit, timeout and buffer failure.
  await writeFile(fake, `
import { writeFileSync } from "node:fs";
const [scenario, ...args] = process.argv.slice(2);
const usage = args[args.indexOf("--usage-output-file") + 1];
const packet = JSON.parse(args[args.indexOf("-p") + 1].split("\\n").at(-1));
if (scenario !== "missing") writeFileSync(usage, scenario === "malformed-receipt" ? "PRIVATE_SENTINEL"
  : scenario === "oversized-receipt" ? "x".repeat(${maxUsageBytes + 1})
  : scenario === "empty-receipt" ? "{}"
  : ${JSON.stringify(receiptBytes())});
if (scenario === "exit") { console.error("PRIVATE_SENTINEL synthetic-token " + args.join(" ")); process.exit(7); }
if (scenario === "timeout") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
if (scenario === "overflow") process.stdout.write("PRIVATE_SENTINEL".repeat(10000));
else if (scenario === "parse") console.log("PRIVATE_SENTINEL malformed JSON");
else console.log(JSON.stringify({ packetDigest: packet.packetDigest, selections: scenario === "selection"
  ? [{ candidateId: "PRIVATE_SENTINEL", reason: "response-schema-gap" }] : [] }));
`);
  try {
    for (const scenario of ["success", "exit", "parse", "selection", "timeout", "overflow", "missing", "malformed-receipt", "empty-receipt", "oversized-receipt", "spawn"]) {
      const outputDirectory = path.join(directory, scenario);
      let isolated;
      const options = { outputDirectory, reviewer: "copilot", env: { ...process.env, COPILOT_GITHUB_TOKEN: "synthetic-token" },
        execute: (_command, args, config) => {
          isolated = config.cwd;
          assert.equal(config.env.HOME, isolated);
          assert.equal(config.env.COPILOT_HOME, path.join(isolated, "config"));
          assert.equal(config.env.GH_TOKEN, undefined);
          assert.equal(config.env.NODOC_USAGE_BLOB_SAS_URL, undefined);
          assert.equal(config.env.GITHUB_TOKEN, undefined);
          assert.equal(config.timeout, 180000);
          assert.equal(config.maxBuffer, 65536);
          return execFileSync(scenario === "spawn" ? path.join(directory, "nonexistent") : process.execPath,
            [fake, scenario, ...args], { ...config, timeout: scenario === "timeout" ? 1000 : config.timeout });
        } };
      if (scenario === "success") {
        const report = await prepareMonthlyReview(fixture(), options);
        assert.equal(report.review.status, "model-selected-unverified");
        assert.equal(report.review.usage.usd, null);
        assert.doesNotMatch(await readFile(path.join(outputDirectory, "report.json"), "utf8"), /PRIVATE_SENTINEL|totalNanoAiu|synthetic-token/u);
      } else {
        await assert.rejects(prepareMonthlyReview(fixture(), options), redacted);
        await assert.rejects(readFile(path.join(outputDirectory, "report.json")), { code: "ENOENT" });
      }
      if (["missing", "oversized-receipt", "spawn"].includes(scenario)) {
        await assert.rejects(readFile(path.join(outputDirectory, "model-usage.private.json")), { code: "ENOENT" });
      } else {
        const bytes = await readFile(path.join(outputDirectory, "model-usage.private.json"), "utf8");
        assert.equal(bytes, scenario === "malformed-receipt" ? "PRIVATE_SENTINEL" : scenario === "empty-receipt" ? "{}" : receiptBytes());
        if (process.platform !== "win32") assert.equal((await stat(path.join(outputDirectory, "model-usage.private.json"))).mode & 0o777, 0o600);
      }
      await assert.rejects(stat(isolated), { code: "ENOENT" });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh outputs preserve canonical deterministic bytes and reject stale or conflicting files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-output-"));
  let invoked = false;
  const execute = () => { invoked = true; throw new Error("PRIVATE_SENTINEL"); };
  try {
    const fresh = path.join(directory, "fresh");
    await prepareMonthlyReview(fixture(), { outputDirectory: fresh });
    const bytes = await readFile(path.join(fresh, "report.json"), "utf8");
    assert.equal(bytes, `${JSON.stringify(buildMonthlyReport(fixture()), null, 2)}\n`);
    await assert.rejects(prepareMonthlyReview(fixture(), { outputDirectory: fresh }), redacted);
    for (const files of [[], ["report.json"], ["model-usage.private.json"], ["report.json", "model-usage.private.json"]]) {
      const stale = path.join(directory, `stale-${files.length}-${files[0] ?? "empty"}`);
      await mkdir(stale);
      for (const file of files) await writeFile(path.join(stale, file), "PRIVATE_SENTINEL");
      await assert.rejects(prepareMonthlyReview(fixture(), { outputDirectory: stale, reviewer: "copilot", execute }), redacted);
      for (const file of files) assert.equal(await readFile(path.join(stale, file), "utf8"), "PRIVATE_SENTINEL");
    }
    const conflict = path.join(directory, "conflict");
    await assert.rejects(prepareMonthlyReview(fixture(), {
      outputDirectory: conflict, reviewer: "copilot", env: { COPILOT_GITHUB_TOKEN: "synthetic-token" },
      execute: (_command, args) => {
        execFileSync(process.execPath, ["-e", `require("fs").writeFileSync(process.argv[1], ${JSON.stringify(receiptBytes())})`,
          args[args.indexOf("--usage-output-file") + 1]]);
        execFileSync(process.execPath, ["-e", 'require("fs").writeFileSync(process.argv[1], "PRIVATE_SENTINEL")',
          path.join(conflict, "model-usage.private.json")]);
        return JSON.stringify({ packetDigest: fixture().packetDigest, selections: [] });
      },
    }), redacted);
    assert.equal(await readFile(path.join(conflict, "model-usage.private.json"), "utf8"), "PRIVATE_SENTINEL");
    await assert.rejects(readFile(path.join(conflict, "report.json")), { code: "ENOENT" });
    assert.equal(invoked, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("model output cannot resolve into any checkout, including a symlinked parent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-location-"));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const other = path.join(directory, "other-checkout");
    await mkdir(other);
    execFileSync("git", ["init", other], { stdio: "pipe" });
    const alias = path.join(directory, "alias");
    await symlink(other, alias, process.platform === "win32" ? "junction" : "dir");
    for (const outputDirectory of [path.join(root, "monthly-forbidden"), path.join(other, "output"), path.join(alias, "output")]) {
      await assert.rejects(prepareMonthlyReview(fixture(), { outputDirectory, reviewer: "copilot", execute: () => assert.fail("must not invoke") }), redacted);
      await assert.rejects(stat(outputDirectory), { code: "ENOENT" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("receipt reader rejects hard links, directories, missing files and oversized files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-receipt-"));
  try {
    const file = path.join(directory, "usage.json");
    await writeFile(file, receiptBytes());
    assert.equal((await readUsageBytes(file)).toString(), receiptBytes());
    await link(file, path.join(directory, "hardlink"));
    await assert.rejects(readUsageBytes(file), redacted);
    await assert.rejects(readUsageBytes(directory), redacted);
    await assert.rejects(readUsageBytes(path.join(directory, "missing")), redacted);
    await writeFile(path.join(directory, "huge"), "x".repeat(maxUsageBytes + 1));
    await assert.rejects(readUsageBytes(path.join(directory, "huge")), redacted);
    if (process.platform !== "win32") {
      await symlink(file, path.join(directory, "symlink"));
      await assert.rejects(readUsageBytes(path.join(directory, "symlink")), redacted);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI entrypoint diagnostics redact invalid inputs, receipts and signed storage URLs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-diagnostics-"));
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  const failsPrivately = (script, args, extraEnv = {}) => {
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...extraEnv },
    }), error => {
      assert.equal(error.status, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /nothing (?:will|may) be published/u);
      assert.doesNotMatch(error.stderr, /PRIVATE_SENTINEL|synthetic-token|sig=|SyntaxError|at .*\.mjs/u);
      return true;
    });
  };
  try {
    failsPrivately("../monthly-review.mjs", ["--PRIVATE_SENTINEL"]);
    failsPrivately("../monthly-review.mjs", ["--month", "PRIVATE_SENTINEL", "--output", directory]);
    const usage = path.join(directory, "usage.json");
    await writeFile(usage, "PRIVATE_SENTINEL");
    failsPrivately("../store-monthly-usage.mjs", [usage], { NODOC_USAGE_BLOB_SAS_URL: "PRIVATE_SENTINEL?sig=synthetic-token" });
    await writeFile(usage, receiptBytes());
    failsPrivately("../store-monthly-usage.mjs", [usage], { NODOC_USAGE_BLOB_SAS_URL: "PRIVATE_SENTINEL?sig=synthetic-token" });
    failsPrivately("../store-monthly-usage.mjs", [path.join(directory, "PRIVATE_SENTINEL-missing")],
      { NODOC_USAGE_BLOB_SAS_URL: "PRIVATE_SENTINEL?sig=synthetic-token" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a temp directory inside the checkout is rejected before creating model files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-temp-policy-"));
  const previous = Object.fromEntries(["TEMP", "TMP", "TMPDIR"].map(key => [key, process.env[key]]));
  try {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    for (const key of Object.keys(previous)) process.env[key] = root;
    await assert.rejects(prepareMonthlyReview(fixture(), {
      outputDirectory: path.join(directory, "review"), reviewer: "copilot",
      env: { COPILOT_GITHUB_TOKEN: "synthetic-token" }, execute: () => assert.fail("must not invoke"),
    }), redacted);
    await assert.rejects(readFile(path.join(directory, "review", "model-usage.private.json")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(directory, "review", "report.json")), { code: "ENOENT" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("workflow isolates the writer and never publishes usage or runs on pull requests", async () => {
  const workflow = load(await readFile(new URL("../../.github/workflows/monthly-review.yml", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.match(workflow.jobs.review.if, /NODOC_MONTHLY_ENABLED/u);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.publish.permissions.contents, "write");
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  const uploads = workflow.jobs.review.steps.filter(step => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploads.length, 1);
  assert.ok(uploads[0].with.path.endsWith("/report.json"));
  const checkout = workflow.jobs.publish.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ needs.review.outputs.revision }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.match(workflow.jobs.publish.if, /needs.review.result == 'success'/u);
  const steps = workflow.jobs.review.steps;
  assert.equal(steps.filter(step => step.env?.COPILOT_GITHUB_TOKEN).length, 1);
  assert.equal(steps.find(step => step.env?.COPILOT_GITHUB_TOKEN).id, "model");
  assert.equal(steps.filter(step => step.env?.USAGE_BLOB_SAS || step.env?.NODOC_USAGE_BLOB_SAS_URL).length, 2);
  assert.equal(steps.find(step => step.id === "model").env.NODOC_USAGE_BLOB_SAS_URL, undefined);
  assert.ok(steps.every(step => !step["continue-on-error"]));
  const destination = steps.find(step => step.id === "destination");
  assert.match(destination.run, /mktemp -d "\$RUNNER_TEMP\/monthly\.XXXXXXXX"/u);
  assert.match(destination.run, /directory=\$directory\/review/u);
  const accounting = steps.find(step => step.id === "accounting");
  assert.match(accounting.run, /steps.destination.outputs.directory/u);
  assert.match(uploads[0].with.path, /steps.destination.outputs.directory/u);
  const evaluate = (expression, { success, cancelled, reviewer, model, accounting }) => {
    const source = expression.replace(/^\$\{\{\s*|\s*\}\}$/gu, "")
      .replaceAll("success()", String(success)).replaceAll("cancelled()", String(cancelled))
      .replaceAll("steps.mode.outputs.reviewer", JSON.stringify(reviewer))
      .replaceAll("steps.model.outcome", JSON.stringify(model))
      .replaceAll("steps.accounting.outcome", JSON.stringify(accounting));
    return Function(`"use strict"; return (${source});`)();
  };
  for (const model of ["success", "failure", "skipped", "cancelled"]) {
    for (const saved of ["success", "failure", "skipped"]) {
      for (const cancelled of [false, true]) {
        const state = { success: model === "success" && saved === "success" && !cancelled,
          cancelled, reviewer: "copilot", model, accounting: saved };
        assert.equal(evaluate(accounting.if, state), !cancelled && ["success", "failure"].includes(model));
        assert.equal(evaluate(uploads[0].if, state), state.success);
      }
    }
  }
  const deterministic = { success: true, cancelled: false, reviewer: "none", model: "skipped", accounting: "skipped" };
  assert.equal(evaluate(accounting.if, deterministic), false);
  assert.equal(evaluate(uploads[0].if, deterministic), true);
  const failedEarlier = { ...deterministic, success: false, reviewer: "copilot" };
  assert.equal(evaluate(accounting.if, failedEarlier), false);
  assert.equal(evaluate(uploads[0].if, failedEarlier), false);
  const ci = load(await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"));
  assert.ok(ci.jobs["windows-postman"].steps.some(step => step.run?.includes("tools/tests/monthly-review.test.mjs")));
});

test("publisher creates only the report branch, is idempotent and refuses to overwrite edits", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodoc-monthly-push-"));
  const original = process.cwd();
  const run = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    await mkdir(path.join(directory, "work"));
    run("init", "--bare", "remote.git");
    run("init", "--initial-branch=main", "work");
    process.chdir(path.join(directory, "work"));
    const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    await writeFile("README.md", "Test repository\n");
    git("add", "README.md");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Initial");
    git("remote", "add", "origin", path.join(directory, "remote.git"));
    git("push", "origin", "HEAD:main");
    const base = git("rev-parse", "HEAD");
    const packet = await loadMonthlyPacket("2026-11", base);
    const report = buildMonthlyReport(packet);
    const result = await publishReport(report);
    assert.equal(result.status, "pushed");
    assert.equal(git("ls-remote", "origin", "refs/heads/main").split(/\s/u)[0], base);
    assert.equal(git("diff", "--name-only", `${base}..HEAD`), "reports/monthly/2026-11.json");
    git("switch", "--detach", base);
    assert.equal((await publishReport(report)).status, "unchanged");
    const review = { model: "gpt-6-luna", output: { packetDigest: packet.packetDigest, selections: [] } };
    await assert.rejects(publishReport(buildMonthlyReport(packet, review)), /already exists/u);
    assert.equal(git("status", "--porcelain"), "");
  } finally {
    process.chdir(original);
    await rm(directory, { recursive: true, force: true });
  }
});
