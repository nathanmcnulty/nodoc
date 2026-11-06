import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { prepareRefreshProposals, reportRefreshMergeEligibility } from "../portal-refresh-proposals.mjs";
import { inferRefreshSchema, refreshAnalysisDigest, syntheticRefreshExample } from "../portal-refresh.mjs";
import { portalDiscoveryModelPolicy } from "../portal-discovery-model-policy.mjs";
import { repoRoot } from "../spec-quality-lib.mjs";
import { createSourceReviewReceipt, validateSourceReview } from "../source-review-receipt.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const serialized = value => `${JSON.stringify(value, null, 2)}\n`;
const inventory = [
  { specId: "viva-engage", specPath: "specifications/nodoc-viva-engage/specification/openapi.yml" },
  { specId: "defender-xdr", specPath: "specifications/nodoc-defender-xdr/specification/openapi.yml" },
];
const baseEntry = { specId: "viva-engage", method: "GET", path: "/api/v1/oauth2/aad_access_token", status: "200", mimeType: "text/html",
  comparison: "schema-missing", schema: { type: "string" }, syntheticExample: "example", captureId: "synthetic-capture", evidenceId: "synthetic-request", actionIndex: 0,
  observedAt: "2026-11-06T10:00:00Z" };
const splitEntry = { ...baseEntry, specId: "defender-xdr", method: "POST", path: "/mtp/alertsApiService/alerts", mimeType: "application/json", comparison: "compatible-observed-types" };
const analysisFor = (...entries) => ({ schemaVersion: 1, captureComplete: true, captureId: "synthetic-capture", enrichments: entries });
const selection = (entry, kind = "response-schema") => ({ specId: entry.specId, evidenceId: entry.evidenceId, kind });
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-refresh-proposals-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("synthetic proposals reject private dictionary keys at every depth", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t);
  for (const [index, key] of ["person@example.invalid", "@odata.person@example.invalid", "12345678-abcd-1234-abcd-123456789abc", "tenant.onmicrosoft.com", "tenant.example.invalid", "https://private.invalid/path", "C:\\private\\file"].entries()) {
    const body = { items: [{ nested: { [key]: true } }] };
    const entry = { ...splitEntry, schema: inferRefreshSchema(body), syntheticExample: syntheticRefreshExample(body) };
    await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(entry), selections: [selection(entry, "synthetic-example")],
      outputDir: path.join(root, String(index)), inventory, captureDirectory }), /Identifier-like property names require manual/);
    await assert.rejects(readFile(path.join(root, String(index), "manifest.json")), { code: "ENOENT" });
  }
});

test("source proposals preserve exact bytes, do not apply, and satisfy source-review bindings", async t => {
  const outputDir = await temporary(t), captureDirectory = await temporary(t), source = path.join(repoRoot, inventory[0].specPath);
  const before = await readFile(source);
  const analysis = analysisFor(baseEntry);
  const manifest = await prepareRefreshProposals({ analysis, selections: [selection(baseEntry)], outputDir, inventory, captureDirectory });
  assert.deepEqual(await readFile(source), before);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.visibility, "private-evidence-only");
  assert.equal(manifest.requiresIndependentPrivacyReview, true);
  assert.equal(manifest.rawResponseValuesIncluded, false);
  assert.equal(manifest.syntheticScalarExamplesOnly, true);
  assert.equal(manifest.changes.length, 1);
  assert.equal(manifest.analysisDigest, refreshAnalysisDigest(analysis));
  const [change] = manifest.changes;
  assert.equal(change.destination, inventory[0].specPath);
  assert.equal(change.beforeSha256, hash(before));
  assert.equal(change.proposalSha256, hash(await readFile(change.proposal)));
  const proposed = YAML.parse(await readFile(change.proposal, "utf8"));
  assert.deepEqual(proposed.paths[baseEntry.path].get.responses[200].content[baseEntry.mimeType].schema, baseEntry.schema);
  assert.deepEqual(manifest.evidence, [{ destination: inventory[0].specPath, kind: "response-schema", specId: baseEntry.specId, method: baseEntry.method,
    path: baseEntry.path, status: baseEntry.status, mimeType: baseEntry.mimeType, captureId: baseEntry.captureId, evidenceId: baseEntry.evidenceId,
    actionIndex: 0, observedAt: baseEntry.observedAt }]);

  // A synthetic accepted review tests the existing receipt contract, not real approval.
  const manifestPath = path.join(outputDir, "manifest.json"), reviewPath = path.join(outputDir, "fixture-review.json"), receiptPath = path.join(outputDir, "fixture-binding.json");
  await writeFile(reviewPath, serialized({ decision: "accepted", reviewedManifestSha256: hash(await readFile(manifestPath)) }));
  createSourceReviewReceipt({ root: repoRoot, manifestPath, reviewPath, receiptPath });
  const checked = validateSourceReview({ root: repoRoot, manifestPath, reviewPath, receiptPath });
  assert.equal(checked.prepared.length, 1);
  assert.equal(checked.prepared[0].item.proposalSha256, change.proposalSha256);
  assert.deepEqual(await readFile(source), before);
});

test("split-spec references resolve to owning file and examples use synthetic scalar values", async t => {
  const outputDir = await temporary(t), captureDirectory = await temporary(t);
  const splitPath = "specifications/nodoc-defender-xdr/specification/alerts_incidents.yml";
  const rootBefore = await readFile(path.join(repoRoot, inventory[1].specPath));
  const ownerBefore = await readFile(path.join(repoRoot, splitPath));
  const captured = { name: "private-person-986", count: 91327, enabled: true, items: [] };
  const entry = { ...splitEntry, schema: inferRefreshSchema(captured), syntheticExample: syntheticRefreshExample(captured), responseBody: captured };
  const manifest = await prepareRefreshProposals({ analysis: analysisFor(entry), selections: [selection(entry, "synthetic-example")], outputDir, inventory, captureDirectory });
  assert.equal(manifest.changes[0].destination, splitPath);
  assert.equal(manifest.changes[0].beforeSha256, hash(ownerBefore));
  const proposalBytes = await readFile(manifest.changes[0].proposal, "utf8");
  const example = YAML.parse(proposalBytes).paths[entry.path].post.responses[200].content[entry.mimeType].examples.syntheticRefresh;
  assert.match(example.summary, /Synthetic.*not a captured response/);
  assert.deepEqual(example.value, { count: 0, enabled: false, items: [], name: "example" });
  assert.doesNotMatch(proposalBytes, /private-person-986|91327/);
  assert.doesNotMatch(serialized(manifest), /private-person-986|91327/);
  assert.deepEqual(await readFile(path.join(repoRoot, inventory[1].specPath)), rootBefore);
  assert.deepEqual(await readFile(path.join(repoRoot, splitPath)), ownerBefore);
});

test("selection is explicit and missing-schema inference never overwrites declared schemas", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t);
  const empty = await prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [], outputDir: path.join(root, "empty"), inventory, captureDirectory });
  assert.deepEqual(empty.changes, []);
  for (const [name, entry, picked, expected] of [
    ["declared", splitEntry, selection(splitEntry), /Existing schemas are never overwritten/],
    ["false-missing", { ...splitEntry, comparison: "schema-missing" }, selection(splitEntry), /overwrite existing data/],
    ["drift", { ...baseEntry, comparison: "contract-drift" }, selection(baseEntry), /Changed or unsupported contracts/],
    ["wrong-kind", baseEntry, selection(baseEntry, "unsupported-kind"), /Only response-schema/],
    ["missing-id", baseEntry, { ...selection(baseEntry), evidenceId: "not-observed" }, /one exact enrichment/],
    ["unattributed", { ...baseEntry, actionIndex: null }, selection(baseEntry), /complete attributed capture/],
  ]) await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(entry), selections: [picked], outputDir: path.join(root, name), inventory, captureDirectory }), expected);
  await assert.rejects(prepareRefreshProposals({ analysis: { ...analysisFor(baseEntry), captureComplete: false }, selections: [selection(baseEntry)], outputDir: path.join(root, "incomplete"), inventory, captureDirectory }), /complete attributed capture/);
});

test("discovery drafts require ownership review and never overwrite existing operations", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t);
  const source = path.join(repoRoot, inventory[0].specPath), sourceBefore = await readFile(source);
  const draft = { ...baseEntry, path: "/api/v1/synthetic-test-discovery/{itemId}", mimeType: "application/json", serverUrl: "https://engage.cloud.microsoft",
    schema: { type: "object", properties: { enabled: { type: "boolean" } } }, syntheticExample: { enabled: false } };
  const analysis = { ...analysisFor(), discoveryDrafts: [draft] };
  await assert.rejects(prepareRefreshProposals({ analysis, selections: [selection(draft, "new-operation")], outputDir: path.join(root, "unapproved"), inventory, captureDirectory }), /explicit ownership review/);
  const existing = { ...draft, path: baseEntry.path };
  await assert.rejects(prepareRefreshProposals({ analysis: { ...analysis, discoveryDrafts: [existing] }, selections: [{ ...selection(existing, "new-operation"), ownershipConfirmed: true }], outputDir: path.join(root, "existing"), inventory, captureDirectory }), /overwrite existing data/);
  const outputDir = path.join(root, "accepted-fixture");
  const manifest = await prepareRefreshProposals({ analysis, selections: [{ ...selection(draft, "new-operation"), ownershipConfirmed: true }], outputDir, inventory, captureDirectory });
  const proposed = YAML.parse(await readFile(manifest.changes[0].proposal, "utf8"));
  const operation = proposed.paths[draft.path].get;
  assert.equal(operation.servers[0].url, draft.serverUrl);
  assert.deepEqual(operation.parameters, [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }]);
  assert.deepEqual(operation.responses[200].content["application/json"].examples.syntheticRefresh.value, { enabled: false });
  assert.equal(manifest.evidence[0].kind, "new-operation");
  assert.deepEqual(await readFile(source), sourceBefore);
});

test("conflicting variants and overlapping destinations require reconciliation", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t);
  const second = { ...baseEntry, evidenceId: "second-request", schema: { type: "integer" }, syntheticExample: 0 };
  await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(baseEntry, second), selections: [selection(baseEntry)], outputDir: path.join(root, "variants"), inventory, captureDirectory }), /Multiple observed response shapes/);
  await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry), selection(baseEntry)], outputDir: path.join(root, "overlap"), inventory, captureDirectory }), /Overlapping refresh proposal selection/);
});

test("automatic merge eligibility fails closed without complete checks and remains advisory", async t => {
  const outputDir = await temporary(t), captureDirectory = await temporary(t);
  const manifest = await prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry)], outputDir, inventory, captureDirectory });
  const report = await reportRefreshMergeEligibility({ manifest, proposalRoot: outputDir });
  assert.equal(report.mode, "dry-run");
  assert.equal(report.actualAutomaticMergingEnabled, false);
  assert.equal(report.rulesRequireExplicitUserAuthorization, true);
  assert.equal(report.eligible, false);
  assert.ok(report.reasonCodes.includes("checks-not-bound-to-current-revision-and-proposals"));
  for (const check of ["discovery", "spec-quality", "portal-metadata", "evaluations", "graph-research", "site-data", "postman-parity", "typecheck", "build", "privacy"]) assert.ok(report.reasonCodes.includes(`check-unproved:${check}`));
  assert.ok(report.reasonCodes.includes("independent-sanitization-and-evidence-review-required"));
  assert.ok(report.reasonCodes.includes("validated-source-review-receipt-required"));
  assert.ok(report.changes[0].reasonCodes.includes("checks-have-not-validated-final-applied-proposal"));
});

test("nonadditive changes and schema constraints cannot become eligible from asserted passing checks", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t), sourceBytes = await readFile(path.join(repoRoot, inventory[0].specPath), "utf8");
  for (const [name, mutate, expected] of [
    ["replacement", document => { document.info.title = "Changed existing title"; }, "change-needs-contract-review"],
    ["constraint", document => { document.paths[baseEntry.path].get.responses[200].content[baseEntry.mimeType].schema.enum = ["example"]; }, "schema-constraints-or-composition-need-review"],
  ]) {
    const outputDir = path.join(root, name);
    const manifest = await prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry)], outputDir, inventory, captureDirectory });
    const change = manifest.changes[0], proposed = YAML.parse(await readFile(change.proposal, "utf8"));
    mutate(proposed);
    const proposalBytes = YAML.stringify(proposed);
    await writeFile(change.proposal, proposalBytes);
    change.proposalSha256 = hash(proposalBytes);
    change.beforeSource = sourceBytes;
    const manifestDigest = hash(serialized(manifest));
    const checks = { sourceRevision: "fixture-revision", manifestDigest, appliedChanges: { [change.destination]: change.proposalSha256 },
      results: Object.fromEntries(["discovery", "spec-quality", "portal-metadata", "evaluations", "graph-research", "site-data", "postman-parity", "typecheck", "build", "privacy"].map(name => [name, { observed: true, exitCode: 0 }])) };
    const review = { decision: "accepted", reviewedManifestSha256: manifestDigest, sanitized: true, completeEvidence: true,
      model: portalDiscoveryModelPolicy.offlineReview.model, reasoning: portalDiscoveryModelPolicy.offlineReview.reasoning };
    const report = await reportRefreshMergeEligibility({ manifest, review, checks, sourceRevision: "fixture-revision", proposalRoot: outputDir });
    assert.ok(report.reasonCodes.includes("checks-not-bound-to-actual-source-state"));
    assert.equal(report.eligible, false);
    assert.equal(report.actualAutomaticMergingEnabled, false);
    assert.ok(report.changes[0].reasonCodes.includes(expected));
    assert.deepEqual(await readFile(path.join(repoRoot, inventory[0].specPath), "utf8"), sourceBytes);
  }
});

test("proposal boundaries reject capture/repository overlap before creating output directories", async t => {
  const captureDirectory = await temporary(t);
  const captureOutput = path.join(captureDirectory, "must-not-be-created");
  const repositoryOutput = path.join(repoRoot, `.refresh-rejected-${path.basename(captureDirectory)}`, "must-not-be-created");
  for (const outputDir of [captureOutput, repositoryOutput]) {
    await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry)], outputDir, inventory, captureDirectory }), /separate from immutable capture|outside the repository/);
    await assert.rejects(lstat(outputDir), { code: "ENOENT" });
  }
  await assert.rejects(lstat(path.dirname(repositoryOutput)), { code: "ENOENT" });
  const missingCapture = path.join(captureDirectory, "absent-capture");
  const outputDir = path.join(path.dirname(captureDirectory), `${path.basename(captureDirectory)}-output-must-not-exist`);
  await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry)], outputDir, inventory, captureDirectory: missingCapture }), { code: "ENOENT" });
  await assert.rejects(lstat(outputDir), { code: "ENOENT" });
});

test("capture and proposal directory links are rejected before output creation", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t);
  const linked = path.join(root, "linked-capture");
  try { await symlink(captureDirectory, linked, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip("Directory links are unavailable in this environment."); return; } throw error; }
  await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry)], outputDir: path.join(root, "unused-output"), inventory, captureDirectory: linked }), /must not contain links/);
  await assert.rejects(prepareRefreshProposals({ analysis: analysisFor(baseEntry), selections: [selection(baseEntry)], outputDir: path.join(linked, "unused-output"), inventory, captureDirectory }), /must not contain links/);
  await assert.rejects(lstat(path.join(root, "unused-output")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(captureDirectory, "unused-output")), { code: "ENOENT" });
});

test("a synthetic flag cannot make captured scalar values eligible despite bound asserted checks", async t => {
  const root = await temporary(t), captureDirectory = await temporary(t);
  for (const [name, syntheticExample] of [["boolean", { enabled: true }], ["string", { name: "private-person-986" }]]) {
    const outputDir = path.join(root, name);
    const entry = { ...splitEntry, syntheticExample };
    const manifest = await prepareRefreshProposals({ analysis: analysisFor(entry), selections: [selection(entry, "synthetic-example")], outputDir, inventory, captureDirectory });
    assert.equal(manifest.syntheticScalarExamplesOnly, true);
    const manifestDigest = hash(serialized(manifest));
    // These are deliberately false fixture assertions; the classifier must still reject values.
    const review = { decision: "accepted", reviewedManifestSha256: manifestDigest, sanitized: true, completeEvidence: true,
      model: portalDiscoveryModelPolicy.offlineReview.model, reasoning: portalDiscoveryModelPolicy.offlineReview.reasoning };
    const sourceReview = { manifestPath: path.join(outputDir, "manifest.json"), reviewPath: path.join(outputDir, "fixture-review.json"), receiptPath: path.join(outputDir, "fixture-receipt.json") };
    // The existing receipt binds exact bytes; valid review JSON need not use
    // the proposal writer's indentation, key order or newline convention.
    await writeFile(sourceReview.reviewPath, JSON.stringify(review, null, 4).replaceAll("\n", "\r\n") + "\r\n");
    createSourceReviewReceipt({ root: repoRoot, ...sourceReview });
    const checks = { sourceRevision: "fixture-revision", manifestDigest,
      appliedChanges: Object.fromEntries(manifest.changes.map(change => [change.destination, change.proposalSha256])),
      results: Object.fromEntries(["discovery", "spec-quality", "portal-metadata", "evaluations", "graph-research", "site-data", "postman-parity", "typecheck", "build", "privacy"].map(name => [name, { observed: true, exitCode: 0 }])) };
    const report = await reportRefreshMergeEligibility({ manifest, review, checks, sourceRevision: "fixture-revision", sourceReview, proposalRoot: outputDir });
    assert.equal(report.actualAutomaticMergingEnabled, false);
    assert.equal(report.eligible, false);
    assert.ok(report.changes[0].reasonCodes.includes("example-values-are-not-synthetic"), name);
    assert.ok(!report.reasonCodes.includes("source-review-receipt-invalid-or-stale"));
  }
});
