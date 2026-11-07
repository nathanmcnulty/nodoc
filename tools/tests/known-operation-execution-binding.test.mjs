import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cp, mkdtemp, mkdir, writeFile, rm, readFile, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildKnownOperationExecutionDigest, buildKnownOperationRefreshPlan, classifyKnownOperationExecutionApproval} from '../portal-discovery-evidence-contract.mjs';
import {buildActionBudget, prepareRecipeForRun, verifyKnownOperationRefreshApproval} from '../run-portal-discovery.mjs';
import {repoRoot} from '../spec-quality-lib.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const emptyVariables = prepareRecipeForRun({actions: [], inspectionPolicy: {mode: 'observe-only'}}, []).__resolvedVariableBindingsDigest;
function recipe() {
  return {
    url: 'https://admin.example.com/settings',
    responseBodyLimits: {perBodyBytes: 16777216, totalBytes: 268435456},
    pageTarget: {matchHosts: ['admin.example.com'], matchPathPrefixes: ['/settings']},
    matchHosts: ['admin.example.com'], matchPathPrefixes: ['/api/settings'],
    inspectionPolicy: {mode: 'observe-only', prohibitedControlPatterns: ['Save']},
    settleMs: 1, postActionSettleMs: 1, maxActions: 6,
    actions: [
      {type: 'navigate', value: 'https://admin.example.com/settings', scope: 'root', required: true},
      {type: 'wait-ms', value: '1', required: true},
      {type: 'capture', value: 'known', scope: 'root', required: true},
    ],
    knownOperationRefresh: {
      status: 'active', method: 'GET', host: 'admin.example.com', routes: ['/api/settings'],
      state: 'settings page', actionIndexes: [0, 2],
      approvalArtifact: 'approvals/known.json', approvalDigest: '0'.repeat(64),
      approvalExpiresAt: '2099-01-01T00:00:00.000Z', variableBindingsDigest: emptyVariables,
      documentationObjectives: ['schema-evidence'], evidenceIds: ['fixture-evidence'],
    },
  };
}
async function approvedFixture(t, input = recipe(), cliVars = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodoc-execution-binding-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'approvals'));
  input.knownOperationRefresh.variableBindingsDigest = prepareRecipeForRun(input, cliVars).__resolvedVariableBindingsDigest;
  const rawPlan = buildKnownOperationRefreshPlan(input);
  const resolvedPlan = buildKnownOperationRefreshPlan(prepareRecipeForRun(input, cliVars));
  const source = JSON.stringify({kind: 'synthetic-offline-only', sourceExecutionDigest: rawPlan.executionDigest}) + '\n';
  await writeFile(path.join(root, 'approvals/source.json'), source);
  const approval = {
    decision: 'accept-bounded-known-operation-refresh', workerModel: 'gpt-6-luna', workerReasoning: 'xhigh',
    refreshDigest: resolvedPlan.refreshDigest, sourceRefreshDigest: rawPlan.refreshDigest,
    executionDigest: resolvedPlan.executionDigest, sourceExecutionDigest: rawPlan.executionDigest,
    expiresAt: input.knownOperationRefresh.approvalExpiresAt,
    source: {artifactPath: 'approvals/source.json', artifactSha256: sha(source)},
  };
  async function save(next) {
    const text = JSON.stringify(next) + '\n';
    await writeFile(path.join(root, 'approvals/known.json'), text);
    input.knownOperationRefresh.approvalDigest = sha(text);
  }
  await save(approval);
  return {root, input, cliVars, approval, rawPlan, resolvedPlan, save};
}

test('historical attribution alone does not authorize a new live execution', async t => {
  const f = await approvedFixture(t);
  await f.save({ ...f.approval, workerModel: 'historical-review-model', workerReasoning: 'historical-effort' });
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  await assert.rejects(verifyKnownOperationRefreshApproval(plan, { root: f.root, now: Date.parse('2026-10-31T00:00:00Z') }), /binding or expiry/);
});

for (const [name, fields] of [
  ['explicitly denied live authority', { liveAuthorized: false }],
  ['review not performed', { reviewRequirement: { status: 'not-performed' } }],
  ['proposal pending actual review', { status: 'proposal-pending-actual-independent-review-and-separate-live-authority' }],
]) test(`complete bindings cannot authorize ${name}`, async t => {
  const f = await approvedFixture(t);
  await f.save({ ...f.approval, ...fields });
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  await assert.rejects(verifyKnownOperationRefreshApproval(plan, { root: f.root }), error => {
    assert.equal(error.code, 'known-refresh-approval-not-executable');
    return true;
  });
});

test('read-only analysis can inspect a live-denied approval without bypassing evidence bindings', async t => {
  const f = await approvedFixture(t);
  await f.save({ ...f.approval, liveAuthorized: false });
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  await verifyKnownOperationRefreshApproval(plan, { root: f.root, requireLiveAuthority: false });
  await writeFile(path.join(f.root, 'approvals/source.json'), 'tampered');
  await assert.rejects(verifyKnownOperationRefreshApproval(plan, { root: f.root, requireLiveAuthority: false }), /source hash mismatch/);
});

for (const materialized of [false, null, "false", "true"]) test(`unmaterialized approval ${JSON.stringify(materialized)} cannot authorize live capture`, async t => {
  const f = await approvedFixture(t);
  await f.save({ ...f.approval, materialized });
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  assert.equal(classifyKnownOperationExecutionApproval({ ...f.approval, materialized }, f.rawPlan), 'unmaterialized-non-runnable');
  await assert.rejects(verifyKnownOperationRefreshApproval(plan, {root: f.root}), error => error.code === 'known-refresh-approval-not-materialized');
  // Historical evidence can be inspected offline; this never grants live authority.
  await verifyKnownOperationRefreshApproval(plan, {root: f.root, requireLiveAuthority: false});
});

test('materialization does not replace full approval binding', async t => {
  const f = await approvedFixture(t);
  await f.save({...f.approval, materialized: true});
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  assert.equal(classifyKnownOperationExecutionApproval({...f.approval, materialized: true}, f.rawPlan), 'bound');
  await verifyKnownOperationRefreshApproval(plan, {root: f.root});
  assert.throws(() => classifyKnownOperationExecutionApproval({...f.approval, materialized: true, executionDigest: 'bad'}, f.rawPlan), /full execution approval binding/u);
});

test('public planning preserves the unmaterialized blocker before allocating a ledger or browser', async t => {
  const input = JSON.parse(await readFile(path.join(repoRoot, 'tools/capture-recipes/m365-admin-shell-loop-20261106.json'), 'utf8'));
  input.knownOperationRefresh.approvalArtifact = 'approvals/known.json';
  input.knownOperationRefresh.approvalExpiresAt = '2099-01-01T00:00:00.000Z';
  const f = await approvedFixture(t, input);
  await f.save({...f.approval, materialized: false});
  await cp(path.join(repoRoot, 'tools'), path.join(f.root, 'tools'), {recursive: true, filter: filename => filename !== path.join(repoRoot, 'tools/tests')});
  await mkdir(path.join(f.root, 'specifications'));
  await cp(path.join(repoRoot, 'specifications/nodoc-m365-admin'), path.join(f.root, 'specifications/nodoc-m365-admin'), {recursive: true});
  await symlink(path.join(repoRoot, 'node_modules'), path.join(f.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const recipePath = path.join(f.root, 'tools/capture-recipes/m365-admin-shell-loop-20261106.json');
  await writeFile(recipePath, JSON.stringify(f.input));
  const artifacts = path.join(f.root, 'artifacts'), ledger = path.join(f.root, 'ledger.jsonl');
  const result = spawnSync(process.execPath, [path.join(f.root, 'tools/run-portal-discovery.mjs'), '--portal', 'm365-admin',
    '--recipe', recipePath, '--phase', 'plan', '--require-known-refresh', '--json', '--operation-ceiling', 'observe-only',
    '--model', 'gpt-6-luna', '--reasoning', 'low', '--artifacts', artifacts, '--ledger-path', ledger,
  ], {cwd: f.root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stderr).blocker.code, 'known-refresh-approval-not-materialized');
  const state = JSON.parse(await readFile(path.join(artifacts, 'discovery-run.json'), 'utf8'));
  assert.equal(state.blocker.code, 'known-refresh-approval-not-materialized');
  assert.equal(state.browserPreflight, undefined);
  await assert.rejects(readFile(ledger), {code: 'ENOENT'});
});

const unboundChanges = [
  ['append passive navigation', r => r.actions.push('navigate=https://admin.example.com/other')],
  ['append passive capture', r => r.actions.push('capture=unreviewed')],
  ['unlisted action change', r => {r.actions[1].value = '2';}],
  ['object root-to-iframe scope', r => {r.actions[0].scope = 'iframe';}],
  ['string DSL root-to-iframe scope', r => {r.actions[0] = 'navigate-iframe=https://admin.example.com/settings';}],
  ['required flag', r => {r.actions[2].required = false;}],
  ['action timeout', r => {r.actions[2].timeoutMs = 2000;}],
  ['page host scope', r => r.pageTarget.matchHosts.push('other.example.com')],
  ['page path scope', r => r.pageTarget.matchPathPrefixes.push('/other')],
  ['network host scope', r => r.matchHosts.push('other.example.com')],
  ['network path scope', r => r.matchPathPrefixes.push('/other')],
  ['action cap', r => {r.maxActions = 40;}],
  ['capture byte cap', r => {r.maxResponseBodyBytes = 1048576;}],
  ['settle timeout', r => {r.settleMs = 1000;}],
  ['alternate executable metadata', r => {r.seedRouteGroups = [{routes: ['/other'], scope: 'iframe'}];}],
];
for (const [name, change] of unboundChanges) test('old approval rejects full recipe change: ' + name, async t => {
  const f = await approvedFixture(t);
  const changed = structuredClone(f.input);
  change(changed);
  if (name.startsWith('append ')) assert.equal(buildActionBudget(changed).countedActions, 5, 'appended passive action still fits the old six-action cap');
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(changed, []));
  assert.equal(plan.refreshDigest, f.resolvedPlan.refreshDigest, 'operation/evidence identity remains historical');
  assert.notEqual(plan.executionDigest, f.resolvedPlan.executionDigest);
  await assert.rejects(verifyKnownOperationRefreshApproval(plan, {root: f.root, now: Date.parse('2026-10-31T00:00:00Z')}), /full execution binding/);
});

test('execution projection excludes only cyclic approval hash and exact resolver marker', () => {
  const value = recipe(), original = buildKnownOperationExecutionDigest(value);
  const hashRotation = structuredClone(value);
  hashRotation.knownOperationRefresh.approvalDigest = 'a'.repeat(64);
  hashRotation.__resolvedVariableBindingsDigest = emptyVariables;
  assert.equal(buildKnownOperationExecutionDigest(hashRotation), original);
  hashRotation.__otherResolverMetadata = 'must-remain-bound';
  assert.notEqual(buildKnownOperationExecutionDigest(hashRotation), original);
  const movedApproval = structuredClone(value);
  movedApproval.knownOperationRefresh.approvalArtifact = 'approvals/other.json';
  assert.notEqual(buildKnownOperationExecutionDigest(movedApproval), original);
  const expiry = structuredClone(value);
  expiry.knownOperationRefresh.approvalExpiresAt = '2098-01-01T00:00:00.000Z';
  assert.notEqual(buildKnownOperationExecutionDigest(expiry), original);
});

test('string DSL root and iframe bindings remain exact while canonical key order is stable', () => {
  const root = recipe();
  root.actions[0] = 'navigate-root=https://admin.example.com/settings';
  const iframe = structuredClone(root);
  iframe.actions[0] = 'navigate-iframe=https://admin.example.com/settings';
  assert.equal(buildKnownOperationRefreshPlan(root).refreshDigest, buildKnownOperationRefreshPlan(iframe).refreshDigest);
  assert.notEqual(buildKnownOperationExecutionDigest(root), buildKnownOperationExecutionDigest(iframe));
  const reordered = Object.fromEntries(Object.entries(root).reverse());
  assert.equal(buildKnownOperationExecutionDigest(root), buildKnownOperationExecutionDigest(reordered));
});

test('missing legacy execution binding fails live closed; explicit valid binding passes', async t => {
  const f = await approvedFixture(t);
  const valid = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  assert.equal((await verifyKnownOperationRefreshApproval(valid, {root: f.root})).executionDigest, valid.executionDigest);
  const legacy = {...f.approval};
  delete legacy.executionDigest;
  delete legacy.sourceExecutionDigest;
  await f.save(legacy);
  const missing = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  await assert.rejects(verifyKnownOperationRefreshApproval(missing, {root: f.root}), /full execution binding/);
});

test('a valid historical execution approval without explicit budgets is non-runnable without rewriting its digests', async t => {
  const input = recipe();
  delete input.responseBodyLimits;
  const f = await approvedFixture(t, input);
  const plan = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  assert.equal(plan.executionDigest, f.approval.executionDigest);
  assert.equal(plan.responseBodyLimitsExplicit, false);
  await assert.rejects(verifyKnownOperationRefreshApproval(plan, {root: f.root}), error => error.code === 'response-body-policy-unbound' && /complete explicit responseBodyLimits/.test(error.message));
});

test('raw and resolved variable bindings are separate and the resolver marker is handled exactly', async t => {
  const input = recipe();
  input.variables = {TenantId: 'tenant-a'};
  input.url += '?tid=${TenantId}';
  input.actions[0].value += '?tid=${TenantId}';
  input.knownOperationRefresh.variableBindingsDigest = prepareRecipeForRun(input, []).__resolvedVariableBindingsDigest;
  const f = await approvedFixture(t, input, []);
  assert.notEqual(f.rawPlan.executionDigest, f.resolvedPlan.executionDigest);
  assert.equal(classifyKnownOperationExecutionApproval(f.approval, f.rawPlan, {hasRuntimeVariables: true}), 'bound');
  const live = buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, []));
  assert.equal((await verifyKnownOperationRefreshApproval(live, {root: f.root})).executionDigest, live.executionDigest);
  assert.throws(() => buildKnownOperationRefreshPlan(prepareRecipeForRun(f.input, ['TenantId=tenant-b'])), /variable binding digest mismatch/);
  assert.throws(() => classifyKnownOperationExecutionApproval({...f.approval, sourceExecutionDigest: 'b'.repeat(64)}, f.rawPlan, {hasRuntimeVariables: true}), /full execution approval binding/);
});

test('static metadata distinguishes historical non-runnable approval from new valid and malformed bindings', () => {
  const plan = buildKnownOperationRefreshPlan(recipe());
  assert.equal(classifyKnownOperationExecutionApproval({}, plan), 'legacy-non-runnable');
  assert.equal(classifyKnownOperationExecutionApproval({executionDigest: plan.executionDigest}, plan), 'bound');
  for (const approval of [
    {executionDigest: null}, {executionDigest: 'a'.repeat(64)},
    {sourceExecutionDigest: plan.executionDigest},
    {executionDigest: plan.executionDigest, sourceExecutionDigest: 'b'.repeat(64)},
  ]) assert.throws(() => classifyKnownOperationExecutionApproval(approval, plan), /full execution approval binding/);
});

test('registered legacy CLI phase-plan rejects before emitting a worker packet or allocating a ledger', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'nodoc-legacy-plan-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const artifacts = path.join(temporary, 'artifacts'), ledger = path.join(temporary, 'ledger.jsonl');
  const result = spawnSync(process.execPath, [
    'tools/run-portal-discovery.mjs', '--portal', 'security-copilot',
    '--recipe', path.join(repoRoot, 'tools/capture-recipes/security-copilot-known-refresh-20261029.json'),
    '--profile', 'bounded', '--phase', 'plan', '--worker-packet', '--json', '--require-known-refresh',
    '--operation-ceiling', 'observe-only', '--model', 'gpt-6-luna', '--reasoning', 'low',
    '--artifacts', artifacts, '--ledger-path', ledger,
  ], {cwd: repoRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /full execution binding is missing or invalid before browser allocation/);
  assert.equal(result.stdout.trim(), '');
  const state = JSON.parse(await readFile(path.join(artifacts, 'discovery-run.json'), 'utf8'));
  assert.equal(state.status, 'blocked');
  await assert.rejects(readFile(ledger), {code: 'ENOENT'});
});
