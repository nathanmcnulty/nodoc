import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";
import { assertMonth, assertMonthlyReport, buildMonthlyPacket, buildMonthlyReport, loadMonthlyPacket, reviewerArgs, validateSelections } from "../monthly-review.mjs";
import { publicationTarget, publishReport } from "../publish-monthly-review.mjs";
import { storeUsage, usageBlobUrl } from "../store-monthly-usage.mjs";

const operation = { method: "GET", path: "/sample", schema: { gapLocations: ["responses/200/content-unknown"] }, examples: { gapLocations: [] } };
const spec = specId => ({ specId, title: specId, specPath: `specifications/nodoc-${specId}/specification/openapi.yml`,
  operationCount: 1, freshness: { schemaGaps: 1, exampleGaps: 0 }, operations: [operation] });
const fixture = () => buildMonthlyPacket({
  month: "2026-11", sourceRevision: "a".repeat(40), inventory: { specs: [spec("zeta"), spec("alpha")] },
  snapshot: { snapshotId: "2026-11-06", assessedAt: "2026-11-06T00:00:00Z", windowDays: 30, source: {}, totals: { currentObservations: 5 } },
});

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
  await storeUsage("{}", sas, { id, request: async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["If-None-Match"], "*");
    return { status: 201 };
  } });
  await assert.rejects(storeUsage("{}", sas, { id, request: async () => { throw new Error(`leaked ${sas}`); } }), error => {
    assert.ok(!error.message.includes("sig"));
    return /upload failed/u.test(error.message);
  });
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
