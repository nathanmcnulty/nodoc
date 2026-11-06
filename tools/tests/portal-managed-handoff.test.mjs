import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { compileOrchestrationPlan, validateManagedCaptureAssignment, validateManagedCaptureResult, validateWorkerResult } from "../portal-discovery-control-plane.mjs";
import { enqueueAssignment, claimAssignment, getLedgerViewFromFile, updateAttempt } from "../portal-discovery-ledger.mjs";
import { prepareLedgerAttempt, validateCaptureHandoff } from "../portal-discovery-dispatch.mjs";
import { buildCaptureWorkerPacket } from "../run-portal-discovery.mjs";

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../..");
const sha = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-managed-handoff-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recipePath = path.join(root, "recipe.json"), ledgerPath = path.join(root, "ledger.jsonl"), planPath = path.join(root, "plan.json");
  await writeFile(recipePath, "{}\n");
  const refreshPlan = { refreshDigest: "a".repeat(64), executionDigest: "b".repeat(64), variableBindingsDigest: "c".repeat(64) };
  const actionBudget = { countedActions: 4, maxActions: 4 };
  const managedCapture = { kind: "known-operation-refresh", recipeSha256: sha(await readFile(recipePath)), endpoint: "example.test:443", ...refreshPlan,
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
  return { root, recipePath, ledgerPath, planPath, plan, assignment, args, input, specRecord, refreshPlan, actionBudget, enqueue, manifest };
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

test("file-backed result checks packet/run/ledger/lease identity instead of worker-supplied snapshots", async t => {
  const f = await fixture(t);
  await enqueueAssignment(f.enqueue);
  f.args.identityLinkage = await validateCaptureHandoff({ args: f.args, specRecord: f.specRecord, recipePath: f.recipePath,
    knownOperationRefreshPlan: f.refreshPlan, actionBudget: f.actionBudget });
  await prepareLedgerAttempt({ ...f.args, phase: "all" }, f.specRecord, f.recipePath);
  const packet = await buildCaptureWorkerPacket({ args: f.args, actionBudget: f.actionBudget, recipePath: f.recipePath, noveltyPlan: null,
    knownOperationRefreshPlan: f.refreshPlan, brief: { specId: "fixture", recipe: f.recipePath, allowedEvidence: [], pathPrefixes: [], serverUrls: [] } });
  const packetPath = path.join(f.root, "packet.json"), runPath = path.join(f.root, "run.json");
  const run = { status: "completed", capture: { captureComplete: true }, assignmentId: f.assignment.assignmentId, assignmentDigest: f.assignment.assignmentDigest, workerId: f.args.workerId,
    identityLinkage: f.args.identityLinkage, knownOperationRefreshPlan: f.refreshPlan,
    ledger: { assignmentId: f.assignment.assignmentId, assignmentDigest: f.assignment.assignmentDigest, workerId: f.args.workerId, attemptNumber: 1 } };
  await writeFile(packetPath, json(packet)); await writeFile(runPath, json(run));
  await updateAttempt({ ...f.enqueue, attemptNumber: 1, status: "completed" });
  const result = { schemaVersion: 1, assignmentId: f.assignment.assignmentId, assignmentDigest: f.assignment.assignmentDigest, assignmentType: "capture",
    workerId: f.args.workerId, runtimeRole: { model: f.args.model, reasoning: f.args.reasoning }, model: f.args.model, reasoning: f.args.reasoning,
    status: "completed", decision: "accept", reasonCodes: [], blockers: [], metrics: {}, recommendedNextAction: "none", lessons: [],
    lifecycleAccounting: { terminalOwnerShutdown: true, artifactLedgerAccounting: true }, processImprovementDisposition: "not-required" };
  const validate = report => validateManagedCaptureResult({ result: report, planPath: f.planPath, packetPath, runPath, ledgerPath: f.ledgerPath });
  assert.equal((await validate(result)).sanitized, true);
  await assert.rejects(validate({ ...result, workerId: "another" }), /identity linkage/);
  await assert.rejects(validate({ ...result, runtimeRole: { model: "wrong", reasoning: "low" } }), /identity linkage/);
  await assert.rejects(validate({ ...result, status: "failed" }), /identity linkage/, "Reported completion status must match actual run and ledger.");
  assert.throws(() => validateWorkerResult({ ...result, identityEvidence: { packet, run } }, f.plan), /identity linkage/, "Untrusted report snapshots cannot supply the evidence.");
  const wrongRun = structuredClone(run); wrongRun.ledger.workerId = "another";
  await writeFile(runPath, json(wrongRun));
  await assert.rejects(validate(result), /identity linkage/);
  await writeFile(runPath, json(run));
  const wrongPacket = structuredClone(packet); wrongPacket.execution.driverArgs[wrongPacket.execution.driverArgs.indexOf("--worker-id") + 1] = "another";
  await writeFile(packetPath, json(wrongPacket));
  await assert.rejects(validate(result), /packet argv identity/);
  await writeFile(packetPath, json(packet));
  const originalLedger = await readFile(f.ledgerPath, "utf8");
  await writeFile(f.ledgerPath, originalLedger.replaceAll('"claimedBy":"fixture-worker"', '"claimedBy":"another"'));
  await assert.rejects(validate(result), /identity linkage/, "A different persisted claimant cannot be replaced by the report's worker ID.");
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
