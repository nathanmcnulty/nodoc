import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../..");

test("applied additive proposal remains eligible with verified baseline evidence and final source checks", { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-eligibility-positive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await mkdir(source);
  for (const name of ["tools", "specifications", "package-lock.json", ".gitignore", "AGENT_DISCOVERY_RUNBOOK.md", "AGENT_DISCOVERY_PLAYBOOK.md", "PORTAL_DISCOVERY_AGENT_PROMPT.md"]) {
    await cp(path.join(repository, name), path.join(source, name), {
      recursive: true,
      filter: filename => filename !== path.join(repository, "tools", "tests"),
    });
  }
  // Reuse installed libraries without installation, network or copied credentials.
  await symlink(path.join(repository, "node_modules"), path.join(source, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const git = args => execute("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "user.name=Nodoc Synthetic Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: source });
  await git(["init", "--quiet"]);
  await git(["add", "--all"]);
  await git(["commit", "--quiet", "-m", "Synthetic refresh eligibility baseline"]);

  // This driver imports the COPIED modules, whose repoRoot is the isolated Git
  // fixture. Review/check declarations below are test data, never tenant proof.
  const driver = path.join(root, "driver.mjs");
  await writeFile(driver, `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const source = process.argv[2], root = path.dirname(source);
const module = name => import(pathToFileURL(path.join(source, "tools", name)).href);
const { analyzeRefreshCapture, loadVerifiedRefreshAnalysis, refreshAnalysisDigest } = await module("portal-refresh.mjs");
const { prepareRefreshProposals, reportRefreshMergeEligibility } = await module("portal-refresh-proposals.mjs");
const { refreshSourceState } = await module("portal-refresh-binding.mjs");
const { buildSpecRouteInventory } = await module("spec-quality-lib.mjs");
const { writeResponseBodySidecar } = await module("response-body-sidecars.mjs");
const { aggregateInteractionHealth } = await module("discovery-capture-policy.mjs");
const { createSourceReviewReceipt } = await module("source-review-receipt.mjs");
const { portalDiscoveryModelPolicy: policy } = await module("portal-discovery-model-policy.mjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const serialized = value => JSON.stringify(value, null, 2) + "\\n";
async function snapshot(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name), filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await snapshot(filename, relative));
    else files.push([relative, hash(await readFile(filename))]);
  }
  return files.sort(([a], [b]) => a.localeCompare(b));
}
const artifacts = path.join(root, "capture"), cacheDir = path.join(root, "cache"), outputDir = path.join(root, "proposals");
await mkdir(artifacts);
const inventory = await buildSpecRouteInventory();
const spec = inventory.find(item => item.specId === "m365-admin");
const route = "/admin/api/navigation/darkmode";
const operation = spec.operations.find(item => item.method === "GET" && item.path === route);
assert.ok(operation, "The real M365 darkmode GET remains present.");
const url = operation.serverUrls[0].replace(/\\/$/u, "") + route;
const evidenceId = "request-synthetic-darkmode";
const retained = await writeResponseBodySidecar({ artifactDir: artifacts, evidenceId, sanitizedBody: '{"IsDarkModeOn":true}' });
const records = [{ method: "GET", url, path: new URL(url).pathname, status: 200, mimeType: "application/json", evidenceId,
  observedAt: "2026-11-06T10:00:00Z", attribution: { actionIndex: 0 }, bodyCapture: retained.bodyCapture }];
for (const [filename, value] of Object.entries({
  "api-records.json": records,
  "raw-requests.json": records,
  "action-results.json": [{ actionIndex: 0, type: "capture", required: true, result: {} }],
  "summary.json": { portal: "M365 Admin", interactionHealth: aggregateInteractionHealth([]), actionValidation: { requiredActionFailures: [] } },
})) await writeFile(path.join(artifacts, filename), serialized(value));
const captureBefore = await snapshot(artifacts);
const analyzed = await analyzeRefreshCapture({ artifacts, cacheDir, specId: spec.specId, inventory });
assert.equal(analyzed.analysis.captureComplete, true);
const analysisPath = path.join(cacheDir, analyzed.cacheKey + ".json");
assert.equal(refreshAnalysisDigest(await loadVerifiedRefreshAnalysis(analysisPath)), refreshAnalysisDigest(analyzed.analysis));
const entry = analyzed.analysis.enrichments.find(item => item.evidenceId === evidenceId && item.path === route);
assert.equal(entry.comparison, "compatible-observed-types");
assert.equal(entry.exampleMissing, true);
const manifest = await prepareRefreshProposals({ analysis: analyzed.analysis, inventory, outputDir,
  selections: [{ specId: spec.specId, evidenceId, kind: "synthetic-example" }] });
assert.equal(manifest.changes.length, 1);
const manifestPath = path.join(outputDir, "manifest.json"), manifestDigest = hash(await readFile(manifestPath));
const review = { schemaVersion: 1, syntheticFixtureOnly: true, decision: "accepted", reviewedManifestSha256: manifestDigest,
  sanitized: true, completeEvidence: true, model: policy.offlineReview.model, reasoning: policy.offlineReview.reasoning };
const reviewPath = path.join(root, "synthetic-review.json"), receiptPath = path.join(root, "synthetic-receipt.json");
await writeFile(reviewPath, serialized(review));
const sourceReview = { manifestPath, reviewPath, receiptPath };
createSourceReviewReceipt({ root: source, ...sourceReview });
for (const change of manifest.changes) await writeFile(path.join(source, change.destination), await readFile(change.proposal));
await assert.rejects(loadVerifiedRefreshAnalysis(analysisPath), /stale/u);
const baseline = await loadVerifiedRefreshAnalysis(analysisPath, { baselineChanges: manifest.changes });
assert.equal(refreshAnalysisDigest(baseline), manifest.analysisDigest);
const actualSource = await refreshSourceState();
const checks = { ...actualSource, syntheticFixtureOnly: true, manifestDigest,
  appliedChanges: Object.fromEntries(manifest.changes.map(change => [change.destination, change.proposalSha256])),
  results: Object.fromEntries(["discovery", "spec-quality", "portal-metadata", "evaluations", "graph-research", "site-data", "postman-parity", "typecheck", "build", "privacy"]
    .map(name => [name, { observed: true, exitCode: 0, syntheticFixtureOnly: true }])) };
const report = await reportRefreshMergeEligibility({ manifest, review, checks, sourceRevision: actualSource.sourceRevision,
  sourceReview, proposalRoot: outputDir, analysisPath });
assert.equal(report.eligible, true, JSON.stringify(report));
assert.equal(report.actualAutomaticMergingEnabled, false);
assert.equal(report.rulesRequireExplicitUserAuthorization, true);
assert.equal(report.changes[0].eligible, true);
assert.deepEqual(await snapshot(artifacts), captureBefore, "Every original capture byte must remain unchanged.");
assert.deepEqual(await refreshSourceState(), actualSource, "Eligibility must not mutate the applied fixture source.");
process.stdout.write(JSON.stringify({ eligible: report.eligible, actualAutomaticMergingEnabled: report.actualAutomaticMergingEnabled, captureUnchanged: true, syntheticFixtureOnly: true }));
`);
  const { stdout } = await execute(process.execPath, [driver, source], { cwd: source, timeout: 110000, maxBuffer: 4 * 1024 * 1024 });
  assert.deepEqual(JSON.parse(stdout), { eligible: true, actualAutomaticMergingEnabled: false, captureUnchanged: true, syntheticFixtureOnly: true });
  assert.equal(await readFile(path.join(repository, "tools", "portal-refresh-proposals.mjs"), "utf8"), await readFile(path.join(source, "tools", "portal-refresh-proposals.mjs"), "utf8"));
});
