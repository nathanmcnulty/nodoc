import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { compileOrchestrationPlan, validateManagedCaptureAssignment, validateManagedCaptureResult, validateWorkerResult } from "../portal-discovery-control-plane.mjs";
import { enqueueAssignment, claimAssignment, getLedgerViewFromFile, updateAttempt, updateAttemptFromDiscoveryRun } from "../portal-discovery-ledger.mjs";
import { prepareLedgerAttempt, validateCaptureHandoff } from "../portal-discovery-dispatch.mjs";
import { buildCaptureWorkerPacket, prepareRecipeForRun, buildActionBudget, inspectCaptureCompleteness, captureWorkerPacketDigest } from "../run-portal-discovery.mjs";
import { buildKnownOperationRefreshPlan, evaluateKnownOperationRefreshEvidence } from "../portal-discovery-evidence-contract.mjs";
import { writeResponseBodySidecar, hydrateResponseBodySidecars } from "../response-body-sidecars.mjs";
import { summarizeActionResults } from "../discovery-capture-policy.mjs";
import { summarizeOperationReceipts } from "../portal-discovery-operation-safety.mjs";

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../..");
const sha = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";

async function fixture(t, { contractActionIndexes = [0, 1, 2] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-managed-handoff-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recipePath = path.join(root, "recipe.json"), ledgerPath = path.join(root, "ledger.jsonl"), planPath = path.join(root, "plan.json");
  const recipe = { url: "https://example.test/settings", pageTarget: { matchHosts: ["example.test"], matchPathPrefixes: ["/settings"] },
    matchHosts: ["example.test"], matchPathPrefixes: ["/api/settings"], inspectionPolicy: { mode: "observe-only", prohibitedControlPatterns: ["Save"] },
    responseBodyLimits: { perBodyBytes: 4096, totalBytes: 16384 }, captureScripts: false, maxActions: 4,
    actions: [{ type: "navigate", value: "https://example.test/settings", required: true }, { type: "wait-ms", value: "1", required: true }, { type: "capture", value: "fixture", required: true }],
    knownOperationRefresh: { status: "active", method: "GET", host: "example.test", routes: ["/api/settings"], state: "Synthetic passive fixture",
      actionIndexes: contractActionIndexes, approvalArtifact: "fixture-approval.json", approvalDigest: "0".repeat(64), approvalExpiresAt: "2099-01-01T00:00:00.000Z",
      documentationObjectives: ["freshness"], evidenceIds: ["fixture-observation"] } };
  recipe.knownOperationRefresh.variableBindingsDigest = prepareRecipeForRun(recipe, []).__resolvedVariableBindingsDigest;
  await writeFile(recipePath, json(recipe));
  const refreshPlan = buildKnownOperationRefreshPlan(prepareRecipeForRun(recipe, []), { required: true });
  const actionBudget = buildActionBudget(recipe);
  const managedCapture = { kind: "known-operation-refresh", recipeSha256: sha(await readFile(recipePath)), endpoint: "example.test:443",
    refreshDigest: refreshPlan.refreshDigest, executionDigest: refreshPlan.executionDigest, variableBindingsDigest: refreshPlan.variableBindingsDigest,
    operationCeiling: "observe-only", actionBudget, workerId: "fixture-worker" };
  const manifest = { schemaVersion: 1, manifestId: "synthetic", portals: [{ specId: "fixture", title: "Fixture", recipe: recipePath, enabled: true,
    endpoint: { leaseFamily: "example.test", hostFamily: "example.test" }, auth: { profile: "bounded", requiresProfile: true }, riskTier: "low",
    outstandingGapClasses: [], captureBudget: { actionCount: 4 }, managedCapture }] };
  const plan = compileOrchestrationPlan(manifest), assignment = plan.assignments.find(entry => entry.type === "capture");
  await writeFile(planPath, json(plan));
  const args = { orchestrationPlan: planPath, ledgerPath, assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest,
    workerId: "fixture-worker", model: "gpt-6-luna", reasoning: "low", endpoint: "https://example.test", profile: "bounded", phase: "plan",
    requireKnownRefresh: true, operationCeiling: "observe-only", variables: [], cdpEndpoint: "http://127.0.0.1:1", artifacts: path.join(root, "driver"),
    captureSupervisionTimeoutMs: 1000, supervisionTimeoutMs: 1000 };
  const specRecord = { specId: "fixture", title: "Fixture" };
  const input = { ...args, recipePath, specId: "fixture", recipeSha256: managedCapture.recipeSha256, refreshPlan, actionBudget };
  const enqueue = { ledgerPath, assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, workerId: args.workerId,
    specId: "fixture", portal: "Fixture", recipePath, recipeDigest: managedCapture.recipeSha256, endpoint: args.endpoint, profile: args.profile,
    phase: "all", model: args.model, reasoning: args.reasoning };
  return { root, recipe, recipePath, ledgerPath, planPath, plan, assignment, args, input, specRecord, refreshPlan, actionBudget, enqueue, manifest };
}

async function completedCaptureFixture(t, { retainCaptureFiles = true, ...options } = {}) {
  const f = await fixture(t, options);
  await enqueueAssignment(f.enqueue);
  f.args.identityLinkage = await validateCaptureHandoff({ args: f.args, specRecord: f.specRecord, recipePath: f.recipePath,
    knownOperationRefreshPlan: f.refreshPlan, actionBudget: f.actionBudget });
  await prepareLedgerAttempt({ ...f.args, phase: "all" }, f.specRecord, f.recipePath);
  const packet = await buildCaptureWorkerPacket({ args: f.args, actionBudget: f.actionBudget, recipePath: f.recipePath, noveltyPlan: null,
    knownOperationRefreshPlan: f.refreshPlan, brief: { specId: "fixture", portal: "Fixture", portalUrl: f.recipe.url, recipe: f.recipePath,
      allowedEvidence: [], pathPrefixes: [], serverUrls: [], stopConditions: [] } });
  const captureRoot = f.args.artifacts;
  await mkdir(captureRoot);
  const packetPath = path.join(f.root, "packet.json"), runPath = path.join(captureRoot, "discovery-run.json");
  const actions = [{ actionIndex: -1, type: "navigate", required: true, allowCanonicalRedirect: true, value: f.recipe.url, result: { resolvedUrl: f.recipe.url, url: f.recipe.url } },
    { actionIndex: 0, type: "navigate", value: f.recipe.url, required: true, result: { resolvedUrl: f.recipe.url, url: f.recipe.url } },
    { actionIndex: 1, type: "wait-ms", value: "1", required: true, result: { waitedMs: 1 } },
    { actionIndex: 2, type: "capture", value: "fixture", required: true, result: { capturedOnly: true } }];
  let assessment;
  if (retainCaptureFiles) {
    const sidecar = await writeResponseBodySidecar({ artifactDir: captureRoot, evidenceId: "request-managed-fixture", sanitizedBody: '{"value":true}', limits: f.recipe.responseBodyLimits });
    const records = [{ method: "GET", url: "https://example.test/api/settings", path: "/api/settings", status: 200, mimeType: "application/json",
      evidenceId: "request-managed-fixture", observedAt: "2026-11-06T10:00:00Z", attribution: { actionIndex: 0 }, matchesCurrentSpec: true, bodyCapture: sidecar.bodyCapture }];
    await hydrateResponseBodySidecars(records, captureRoot, f.recipe.responseBodyLimits);
    assessment = evaluateKnownOperationRefreshEvidence({ actionResults: actions, apiRecords: records, plan: f.refreshPlan });
    assert.equal(assessment.status, "observed");
    for (const [name, value] of Object.entries({ "summary.json": { portal: "Fixture", finalUrl: f.recipe.url, responseBodyLimits: f.recipe.responseBodyLimits,
      actionValidation: summarizeActionResults(actions) }, "action-results.json": actions, "api-records.json": records, "raw-requests.json": records,
      "known-operation-refresh-assessment.json": assessment })) await writeFile(path.join(captureRoot, name), json(value));
  }
  const run = { status: "completed", phase: "all", artifacts: captureRoot,
    capture: retainCaptureFiles ? await inspectCaptureCompleteness(captureRoot) : { captureComplete: true, captureStatus: "complete" },
    assignmentId: f.assignment.assignmentId, assignmentDigest: f.assignment.assignmentDigest, workerId: f.args.workerId,
    identityLinkage: f.args.identityLinkage, workerPacketSha256: packet.packetSha256, knownOperationRefreshPlan: f.refreshPlan,
    knownOperationRefresh: assessment ?? { status: "observed" },
    ledger: { assignmentId: f.assignment.assignmentId, assignmentDigest: f.assignment.assignmentDigest, workerId: f.args.workerId, attemptNumber: 1, ledgerPath: f.ledgerPath } };
  await writeFile(packetPath, json(packet)); await writeFile(runPath, json(run));
  await updateAttemptFromDiscoveryRun({ ...f.enqueue, artifactDir: captureRoot, attemptNumber: 1, discoveryRun: run });
  const result = { schemaVersion: 1, assignmentId: f.assignment.assignmentId, assignmentDigest: f.assignment.assignmentDigest, assignmentType: "capture",
    attemptNumber: 1, captureRoot, workerId: f.args.workerId, runtimeRole: { model: f.args.model, reasoning: f.args.reasoning }, model: f.args.model, reasoning: f.args.reasoning,
    status: "completed", decision: "accept", reasonCodes: [], blockers: [], metrics: {}, recommendedNextAction: "none", lessons: [],
    lifecycleAccounting: { terminalOwnerShutdown: true, artifactLedgerAccounting: true }, processImprovementDisposition: "not-required" };
  const validate = (report = result, paths = {}) => validateManagedCaptureResult({ result: report, planPath: f.planPath, packetPath, runPath, ledgerPath: f.ledgerPath, ...paths });
  return { ...f, captureRoot, packet, packetPath, run, runPath, result, validate };
}

test("managed plan binds recipe, caller, profile, variables, role and explicit worker", async t => {
  const f = await fixture(t);
  assert.equal(validateManagedCaptureAssignment(f.plan, f.input).assignmentDigest, f.assignment.assignmentDigest);
  for (const [field, value] of [["assignmentDigest", "0".repeat(64)], ["recipeSha256", "0".repeat(64)], ["recipePath", "/another.json"],
    ["endpoint", "https://different.test"], ["profile", "other"], ["workerId", "other-worker"], ["workerId", null], ["model", "other-model"]]) {
    assert.throws(() => validateManagedCaptureAssignment(f.plan, { ...f.input, [field]: value }), /does not match/, field);
  }
  for (const field of ["executionDigest", "refreshDigest", "variableBindingsDigest"]) {
    assert.throws(() => validateManagedCaptureAssignment(f.plan, { ...f.input, refreshPlan: { ...f.refreshPlan, [field]: "0".repeat(64) } }), /does not match/, field);
  }
  const changed = structuredClone(f.plan);
  changed.assignments[0].portal = "Tampered";
  assert.throws(() => validateManagedCaptureAssignment(changed, f.input), /digest mismatch/);
});

test("managed ledger identity is immutable and claims require the planned worker/digest", async t => {
  const f = await fixture(t);
  const created = await enqueueAssignment(f.enqueue);
  assert.equal(created.assignment.assignmentDigest, f.assignment.assignmentDigest);
  await assert.rejects(enqueueAssignment({ ...f.enqueue, assignmentDigest: "d".repeat(64) }), /immutable/);
  await assert.rejects(enqueueAssignment({ ...f.enqueue, workerId: "another" }), /immutable/);
  for (const patch of [{ workerId: "another" }, { assignmentDigest: null }, { assignmentDigest: "d".repeat(64) }, { model: "other" }]) {
    await assert.rejects(claimAssignment({ ...f.enqueue, ...patch }), /Managed assignment/);
  }
  const claimed = await claimAssignment(f.enqueue);
  assert.equal(claimed.assignment.latestAttempt.lease.owner, f.args.workerId);
  const validLedger = await readFile(f.ledgerPath, "utf8");
  await writeFile(f.ledgerPath, validLedger.replaceAll('"owner":"fixture-worker"', '"owner":"another"'));
  await assert.rejects(validateCaptureHandoff({ args: { ...f.args, phase: "all" }, specRecord: f.specRecord, recipePath: f.recipePath,
    knownOperationRefreshPlan: f.refreshPlan, actionBudget: f.actionBudget }), /Managed ledger/, "A different active lease owner blocks before preflight.");
  await writeFile(f.ledgerPath, validLedger);
  await assert.rejects(updateAttempt({ ...f.enqueue, attemptNumber: 1, status: "completed", workerId: "another" }), /Managed assignment/);
  const terminal = await updateAttempt({ ...f.enqueue, attemptNumber: 1, status: "completed" });
  assert.equal(terminal.assignment.latestAttempt.lease, null);
  assert.equal(terminal.assignment.latestAttempt.claimedBy, f.args.workerId, "Claim identity survives terminal lease release.");
  await assert.rejects(validateCaptureHandoff({ args: { ...f.args, phase: "all" }, specRecord: f.specRecord, recipePath: f.recipePath,
    knownOperationRefreshPlan: f.refreshPlan, actionBudget: f.actionBudget }), /Managed ledger/, "Completed assignments cannot be silently reused.");
});

test("managed handoff fails before preflight for missing plan/identity/ledger and detects plan drift", async t => {
  const f = await fixture(t), call = args => validateCaptureHandoff({ args, specRecord: f.specRecord, recipePath: f.recipePath,
    knownOperationRefreshPlan: f.refreshPlan, actionBudget: f.actionBudget });
  f.args.identityLinkage = await call(f.args);
  assert.equal(f.args.identityLinkage.status, "managed-bound");
  const originalRecipe = await readFile(f.recipePath);
  await writeFile(f.recipePath, '{"changed":true}\n');
  await assert.rejects(call(f.args), /does not match/, "Actual recipe-byte drift is rejected.");
  await writeFile(f.recipePath, originalRecipe);
  await assert.rejects(call({ ...f.args, phase: "all" }), /Managed ledger/);
  await enqueueAssignment(f.enqueue);
  for (const patch of [{ workerId: null }, { assignmentDigest: null }, { noLedger: true }]) await assert.rejects(call({ ...f.args, ...patch }), /Managed handoff/);
  await assert.rejects(call({ ...f.args, orchestrationPlan: null, phase: "all" }), /persisted orchestration plan/);
  assert.equal((await call({ ...f.args, phase: "all" })).status, "managed-bound");
  await writeFile(f.planPath, json({ ...f.plan, extraField: "changed-bytes" }));
  await assert.rejects(prepareLedgerAttempt({ ...f.args, phase: "all" }, f.specRecord, f.recipePath), /changed after preflight/);
  assert.equal((await getLedgerViewFromFile({ ledgerPath: f.ledgerPath })).assignments[0].state, "queued");
  const legacy = await call({ ...f.args, orchestrationPlan: null, assignmentId: null, assignmentDigest: null });
  assert.equal(legacy.status, "legacy-identity-unknown");
  assert.equal(legacy.unattendedPromotionEligible, false);
  const portal = { ...f.manifest.portals[0], novelty: { status: "active", approvalDigest: "f".repeat(64), reopenCondition: "synthetic" } };
  delete portal.managedCapture;
  const legacyPlan = compileOrchestrationPlan({ ...f.manifest, portals: [portal] });
  const capture = legacyPlan.assignments.find(entry => entry.type === "capture");
  assert.throws(() => validateWorkerResult({ schemaVersion: 1, assignmentId: capture.assignmentId, assignmentDigest: capture.assignmentDigest, decision: "accept" }, legacyPlan), /Legacy capture identity is unknown/);
});

test("file-backed results require actual retained capture files and exact run/ledger roots", async t => {
  const absent = await completedCaptureFixture(t, { retainCaptureFiles: false });
  await assert.rejects(absent.validate(), /Unable to read JSON/, "Claims and completed ledger status cannot replace capture files.");
  const f = await completedCaptureFixture(t);
  assert.equal((await f.validate()).sanitized, true);
  const other = path.join(f.root, "borrowed");
  await cp(f.captureRoot, other, { recursive: true });
  const otherRunPath = path.join(other, "discovery-run.json");
  await assert.rejects(f.validate(f.result, { runPath: otherRunPath }), /capture root/, "Borrowed run in another directory is rejected.");
  await writeFile(otherRunPath, json({ ...f.run, artifacts: other }));
  await assert.rejects(f.validate({ ...f.result, captureRoot: other }, { runPath: otherRunPath }), /ledger artifact directory/, "Changing the run root still cannot borrow the original ledger proof.");
  await assert.rejects(f.validate({ ...f.result, captureRoot: other }), /exact capture root and attempt/);
  await assert.rejects(f.validate({ ...f.result, attemptNumber: 2 }), /exact capture root and attempt/);
  for (const captureComplete of [null, false]) {
    await updateAttempt({ ...f.enqueue, attemptNumber: 1, status: "completed", captureComplete, captureStatus: captureComplete === null ? null : "response-body-sidecar-incomplete" });
    await assert.rejects(f.validate(), /unblocked successful terminal/, "Unknown/incomplete ledger capture status cannot be upgraded.");
  }
});

test("managed result verifies packet digest, full executable binding and actual worker/lease identity", async t => {
  const f = await completedCaptureFixture(t);
  await assert.rejects(f.validate({ ...f.result, workerId: "another" }), /identity linkage/);
  await assert.rejects(f.validate({ ...f.result, runtimeRole: { model: "wrong", reasoning: "low" } }), /identity linkage/);
  await assert.rejects(f.validate({ ...f.result, status: "failed" }), /unblocked successful terminal/);
  assert.throws(() => validateWorkerResult({ ...f.result, identityEvidence: { packet: f.packet, run: f.run } }, f.plan), /identity linkage/);
  const wrongRun = structuredClone(f.run); wrongRun.ledger.workerId = "another";
  await writeFile(f.runPath, json(wrongRun));
  await assert.rejects(f.validate(), /identity linkage/);
  await writeFile(f.runPath, json(f.run));
  for (const [name, mutate] of [
    ["recipe", argv => { argv[argv.indexOf("--recipe") + 1] = "/other-recipe.json"; }],
    ["known flag", argv => argv.splice(argv.indexOf("--require-known-refresh"), 1)],
    ["var", argv => argv.push("--var", "privateFixture=changed")],
    ["phase", argv => { argv[argv.indexOf("--phase") + 1] = "plan"; }],
    ["plan path", argv => { argv[argv.indexOf("--orchestration-plan") + 1] = "/other-plan.json"; }],
    ["ledger path", argv => { argv[argv.indexOf("--ledger-path") + 1] = "/other-ledger.jsonl"; }],
  ]) {
    const tampered = structuredClone(f.packet); mutate(tampered.execution.driverArgs);
    await writeFile(f.packetPath, json(tampered));
    await assert.rejects(f.validate(), /packet digest/, "Unrehashed " + name);
    // Even updating the packet's own digest cannot change the packet executed by the run.
    tampered.packetSha256 = captureWorkerPacketDigest(tampered);
    await writeFile(f.packetPath, json(tampered));
    await assert.rejects(f.validate(), /argv|executed packet|does not match/, "Rehashed " + name);
    // Repair both packet argv and the run's packet hash to exercise the actual
    // assignment/recipe/runtime checks rather than stopping at a stale digest.
    const fullyRebound = structuredClone(f.packet);
    mutate(fullyRebound.execution.driverArgs); mutate(fullyRebound.execution.verificationArgs);
    fullyRebound.packetSha256 = captureWorkerPacketDigest(fullyRebound);
    await writeFile(f.packetPath, json(fullyRebound));
    await writeFile(f.runPath, json({ ...f.run, workerPacketSha256: fullyRebound.packetSha256 }));
    await assert.rejects(f.validate(), /argv|executed packet|does not match|variable.*digest/, "Consistently rehashed " + name);
    await writeFile(f.runPath, json(f.run));
  }
  await writeFile(f.packetPath, json(f.packet));
  const ledger = await readFile(f.ledgerPath, "utf8");
  await writeFile(f.ledgerPath, ledger.replaceAll('"claimedBy":"fixture-worker"', '"claimedBy":"another"'));
  await assert.rejects(f.validate(), /identity linkage/);
});

test("complete bodies cannot authorize blocked or inconsistent terminal evidence", async t => {
  const f = await completedCaptureFixture(t);
  const ledger = await readFile(f.ledgerPath, "utf8");
  await writeFile(f.ledgerPath, ledger.replaceAll('"status":"completed"', '"status":"blocked"'));
  await writeFile(f.runPath, json({ ...f.run, status: "blocked", blocker: { code: "no-target-signal" } }));
  await assert.rejects(f.validate({ ...f.result, status: "blocked" }), /unblocked successful terminal/);
  await writeFile(f.ledgerPath, ledger); await writeFile(f.runPath, json(f.run));
  const assessmentPath = path.join(f.captureRoot, "known-operation-refresh-assessment.json");
  await writeFile(assessmentPath, json({ ...f.run.knownOperationRefresh, status: "no-target-signal" }));
  await assert.rejects(f.validate(), /incomplete, blocked or inconsistent/);
  await writeFile(assessmentPath, json(f.run.knownOperationRefresh));
  await writeFile(path.join(f.captureRoot, "response-body-sidecars", "request-managed-fixture.body"), "tampered");
  await assert.rejects(f.validate(), /hash or length mismatch/);
});

test("full recipe accounting rejects missing, extra, or changed actions outside the refresh subset", async t => {
  const f = await completedCaptureFixture(t, { contractActionIndexes: [0, 2] });
  assert.equal((await f.validate()).sanitized, true);
  const actionPath = path.join(f.captureRoot, "action-results.json"), original = JSON.parse(await readFile(actionPath, "utf8"));
  for (const [name, mutate] of [
    ["missing required action", actions => actions.splice(actions.findIndex(action => action.actionIndex === 1), 1)],
    ["undeclared action within ceiling", actions => { actions.find(action => action.actionIndex === 1).actionIndex = 3; }],
    ["changed scope", actions => { actions.find(action => action.actionIndex === 1).scope = "iframe"; }],
    ["changed required flag", actions => { actions.find(action => action.actionIndex === 1).required = false; }],
    ["duplicate recipe action", actions => { actions.find(action => action.actionIndex === 1).actionIndex = 0; }],
    ["missing mandatory navigation", actions => actions.splice(0, 1)],
    ["changed mandatory navigation", actions => { actions[0].value = "https://example.test/other"; }],
  ]) {
    const actions = structuredClone(original); mutate(actions);
    await writeFile(actionPath, json(actions));
    await assert.rejects(f.validate(), /incomplete, blocked or inconsistent/, name);
  }
});

test("observe-only mutation safety must reconcile summary, events, run and ledger", async t => {
  const f = await completedCaptureFixture(t);
  const summaryPath = path.join(f.captureRoot, "summary.json"), summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const safe = summarizeOperationReceipts([]), receipts = [{ schemaVersion: 1, operationId: "fixture-operation", mode: "abort-only",
    approvalDigest: "a".repeat(64), executionState: "unresolved-change", unresolvedReason: "fixture-unresolved", accounting: { artifactValidationFailed: true }, evidence: {} }];
  const unsafe = summarizeOperationReceipts(receipts);
  assert.equal(unsafe.safeToContinue, false);
  await writeFile(summaryPath, json({ ...summary, mutationSummary: unsafe }));
  await assert.rejects(f.validate(), /mutation safety/);
  await writeFile(summaryPath, json({ ...summary, mutationSummary: safe }));
  await writeFile(f.runPath, json({ ...f.run, activeOperations: safe }));
  await updateAttempt({ ...f.enqueue, attemptNumber: 1, status: "completed", activeOperations: safe });
  const eventsPath = path.join(f.captureRoot, "mutation-events.json");
  await writeFile(eventsPath, json({ schemaVersion: 1, receipts: [], summary: safe }));
  assert.equal((await f.validate()).sanitized, true, "A real zero-attempt observe-only summary remains valid.");
  await writeFile(eventsPath, json({ schemaVersion: 1, receipts, summary: unsafe }));
  await assert.rejects(f.validate(), /active-operation state does not match/);
  await writeFile(eventsPath, json({ schemaVersion: 1, receipts: [], summary: safe }));
  await writeFile(f.runPath, json({ ...f.run, activeOperations: null }));
  await assert.rejects(f.validate(), /mutation safety/);
  await writeFile(f.runPath, json({ ...f.run, activeOperations: safe }));
  await updateAttempt({ ...f.enqueue, attemptNumber: 1, status: "completed", activeOperations: null });
  await assert.rejects(f.validate(), /mutation safety/);
});

test("registered managed known-refresh CLI compiles and plans offline with fixture authority", { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-managed-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"); await mkdir(source);
  for (const name of ["tools", "specifications", "AGENT_DISCOVERY_RUNBOOK.md", "AGENT_DISCOVERY_PLAYBOOK.md", "PORTAL_DISCOVERY_AGENT_PROMPT.md"]) {
    await cp(path.join(repository, name), path.join(source, name), { recursive: true, filter: file => file !== path.join(repository, "tools", "tests") });
  }
  await symlink(path.join(repository, "node_modules"), path.join(source, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const driver = path.join(root, "driver.mjs");
  await writeFile(driver, `
import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import path from 'node:path'; import {createHash} from 'node:crypto'; import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url'; const source=process.argv[2],root=path.dirname(source),load=file=>import(pathToFileURL(path.join(source,'tools',file)));
const {prepareRecipeForRun}=await load('run-portal-discovery.mjs'),{buildKnownOperationRefreshPlan}=await load('portal-discovery-evidence-contract.mjs');
const recipePath='tools/capture-recipes/m365-admin-shell-loop-20261106.json', recipe=JSON.parse(await fs.readFile(path.join(source,recipePath),'utf8'));
recipe.url='https://admin.cloud.microsoft/#/\u0024{view}'; recipe.actions[0]='navigate=https://admin.cloud.microsoft/#/\u0024{view}';
recipe.knownOperationRefresh.approvalExpiresAt='2099-01-01T00:00:00.000Z'; recipe.knownOperationRefresh.variableBindingsDigest=prepareRecipeForRun(recipe,['view=adminunits']).__resolvedVariableBindingsDigest;
const plan=buildKnownOperationRefreshPlan(prepareRecipeForRun(recipe,['view=adminunits']),{required:true}), hash=b=>createHash('sha256').update(b).digest('hex');
const authority='tools/frontier-approvals/managed-fixture-source.json'; await fs.writeFile(path.join(source,authority),'fixture authority only');
const approval={schemaVersion:1,decision:'accept-bounded-known-operation-refresh',workerModel:'gpt-6-luna',workerReasoning:'xhigh',refreshDigest:plan.refreshDigest,executionDigest:plan.executionDigest,expiresAt:plan.approvalExpiresAt,source:{artifactPath:authority,artifactSha256:hash(await fs.readFile(path.join(source,authority)))}};
const approvalBytes=JSON.stringify(approval); await fs.writeFile(path.join(source,recipe.knownOperationRefresh.approvalArtifact),approvalBytes); recipe.knownOperationRefresh.approvalDigest=hash(approvalBytes); await fs.writeFile(path.join(source,recipePath),JSON.stringify(recipe));
const planPath=path.join(root,'managed-plan.json'),ledger=path.join(root,'ledger.jsonl');
const compile=['tools/portal-discovery-control-plane.mjs','compile-plan','--managed-known-refresh','--portal','m365-admin','--recipe',recipePath,'--worker-id','fixture-worker','--var','view=adminunits','--output',planPath,'--ledger',ledger,'--apply'];
execFileSync(process.execPath,compile,{cwd:source,stdio:'pipe'}); const managed=JSON.parse(await fs.readFile(planPath,'utf8')),capture=managed.assignments.find(e=>e.type==='capture'); assert.ok(capture.assignmentDigest);
const argv=['tools/run-portal-discovery.mjs','--portal','m365-admin','--recipe',recipePath,'--phase','plan','--require-known-refresh','--orchestration-plan',planPath,'--assignment-id',capture.assignmentId,'--assignment-digest',capture.assignmentDigest,'--worker-id','fixture-worker','--model','gpt-6-luna','--reasoning','low','--endpoint','https://admin.cloud.microsoft','--var','view=adminunits','--ledger-path',ledger,'--json'];
const planned=JSON.parse(execFileSync(process.execPath,argv,{cwd:source,encoding:'utf8'})); assert.equal(planned.status,'planned'); assert.equal(planned.workerPacket.bindings.identityLinkage.status,'managed-bound'); assert.ok(planned.workerPacket.execution.driverArgs.includes('--orchestration-plan')); assert.ok(planned.workerPacket.execution.driverArgs.includes(ledger));
for(const patch of ['missing-worker','changed-var','missing-plan']){const bad=[...argv]; if(patch==='changed-var')bad[bad.indexOf('--var')+1]='view=other';else {const flag=patch==='missing-worker'?'--worker-id':'--orchestration-plan';bad.splice(bad.indexOf(flag),2);}bad[bad.indexOf('--phase')+1]='all';bad.push('--artifacts',path.join(root,patch));try{execFileSync(process.execPath,bad,{cwd:source,encoding:'utf8',stdio:'pipe'});assert.fail('Must reject '+patch);}catch(error){const blocked=JSON.parse(error.stderr);assert.equal(error.status,2);assert.equal(blocked.blocker.code,patch==='changed-var'?'recipe-target-invalid':'capture-handoff-invalid',patch);assert.equal(blocked.preflight,undefined);}}
const {getLedgerViewFromFile}=await load('portal-discovery-ledger.mjs'); const state=await getLedgerViewFromFile({ledgerPath:ledger});assert.equal(state.assignments[0].state,'queued');
console.log(JSON.stringify({planned:true,browserAllocated:false,identityBound:true}));
`);
  const { stdout } = await execute(process.execPath, [driver, source], { cwd: source, timeout: 110000, maxBuffer: 4 * 1024 * 1024 });
  assert.deepEqual(JSON.parse(stdout), { planned: true, browserAllocated: false, identityBound: true });
});
