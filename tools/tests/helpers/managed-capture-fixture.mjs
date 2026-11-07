// Synthetic file-backed proof shared by copied-repository eligibility fixtures.
// Production modules are imported from the fixture checkout, never the host repo.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const json = value => JSON.stringify(value, null, 2) + "\n";
const sha = value => createHash("sha256").update(value).digest("hex");

export async function attachManagedCaptureFixture({ sourceRoot, captureRoot, specId, title, targetUrl }) {
  const mod = file => import(pathToFileURL(path.join(sourceRoot, "tools", file)).href);
  const [{ compileOrchestrationPlan }, { enqueueAssignment, updateAttemptFromDiscoveryRun, normalizeEndpoint },
    { validateCaptureHandoff, prepareLedgerAttempt }, { prepareRecipeForRun, buildActionBudget, buildCaptureWorkerPacket, inspectCaptureCompleteness },
    { buildKnownOperationRefreshPlan, evaluateKnownOperationRefreshEvidence }, { hydrateResponseBodySidecars }, { summarizeActionResults }] = await Promise.all([
    mod("portal-discovery-control-plane.mjs"), mod("portal-discovery-ledger.mjs"), mod("portal-discovery-dispatch.mjs"), mod("run-portal-discovery.mjs"),
    mod("portal-discovery-evidence-contract.mjs"), mod("response-body-sidecars.mjs"), mod("discovery-capture-policy.mjs"),
  ]);
  const identityRoot = path.join(path.dirname(captureRoot), path.basename(captureRoot) + "-managed-identity");
  await mkdir(identityRoot);
  const target = new URL(targetUrl), nativeUrl = new URL("/settings", target).href;
  const recipe = { portal: title, url: nativeUrl, pageTarget: { matchHosts: [target.hostname], matchPathPrefixes: ["/settings"] },
    matchHosts: [target.hostname], matchPathPrefixes: ["/"], captureScripts: false, maxActions: 4,
    inspectionPolicy: { mode: "observe-only", prohibitedControlPatterns: ["Save", "Delete"] }, responseBodyLimits: { perBodyBytes: 4096, totalBytes: 16384 },
    actions: [{ type: "navigate", value: nativeUrl, required: true }, { type: "wait-ms", value: "1", required: true }, { type: "capture", value: "fixture", required: true }], knownOperationRefresh: { status: "active", method: "GET", host: target.hostname,
      routes: [target.pathname], state: "Synthetic fixture only", actionIndexes: [0, 1, 2], approvalArtifact: "fixture-not-live.json", approvalDigest: "0".repeat(64),
      approvalExpiresAt: "2099-01-01T00:00:00.000Z", documentationObjectives: ["freshness"], evidenceIds: ["synthetic-fixture"] } };
  recipe.knownOperationRefresh.variableBindingsDigest = prepareRecipeForRun(recipe, []).__resolvedVariableBindingsDigest;
  const refresh = buildKnownOperationRefreshPlan(prepareRecipeForRun(recipe, []), { required: true }), actionBudget = buildActionBudget(recipe);
  const recipePath = path.join(identityRoot, "recipe.json"), planPath = path.join(identityRoot, "plan.json"), ledgerPath = path.join(identityRoot, "ledger.jsonl"),
    packetPath = path.join(identityRoot, "packet.json"), resultPath = path.join(identityRoot, "result.json");
  await writeFile(recipePath, json(recipe));
  const recipeSha256 = sha(await readFile(recipePath)), workerId = "fixture-" + sha(captureRoot).slice(0, 16), endpoint = normalizeEndpoint(target.origin);
  const managedCapture = { kind: "known-operation-refresh", recipeSha256, endpoint, workerId, operationCeiling: "observe-only", actionBudget,
    refreshDigest: refresh.refreshDigest, executionDigest: refresh.executionDigest, variableBindingsDigest: refresh.variableBindingsDigest };
  const plan = compileOrchestrationPlan({ schemaVersion: 1, manifestId: "synthetic-fixture", portals: [{ specId, title, enabled: true, recipe: recipePath,
    endpoint: { leaseFamily: endpoint, hostFamily: target.hostname }, auth: { profile: "bounded", requiresProfile: true }, riskTier: "low",
    outstandingGapClasses: [], captureBudget: { actionCount: 4 }, managedCapture }] });
  await writeFile(planPath, json(plan));
  const assignment = plan.assignments.find(entry => entry.type === "capture"), args = { phase: "plan", requireKnownRefresh: true, orchestrationPlan: planPath,
    assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, workerId, profile: "bounded", model: "gpt-6-luna", reasoning: "low",
    endpoint, ledgerPath, operationCeiling: "observe-only", variables: [], cdpEndpoint: "http://127.0.0.1:1", artifacts: captureRoot,
    captureSupervisionTimeoutMs: 900000, supervisionTimeoutMs: 120000 };
  const specRecord = { specId, title };
  await enqueueAssignment({ ...args, specId, portal: title, recipePath, recipeDigest: recipeSha256, phase: "all" });
  args.identityLinkage = await validateCaptureHandoff({ args, specRecord, recipePath, knownOperationRefreshPlan: refresh, actionBudget });
  await prepareLedgerAttempt({ ...args, phase: "all" }, specRecord, recipePath);
  const actions = [{ actionIndex: -1, type: "navigate", required: true, allowCanonicalRedirect: true, value: nativeUrl, result: { resolvedUrl: nativeUrl, url: nativeUrl } },
    { actionIndex: 0, type: "navigate", value: nativeUrl, required: true, result: { resolvedUrl: nativeUrl, url: nativeUrl } },
    { actionIndex: 1, type: "wait-ms", value: "1", required: true, result: { waitedMs: 1 } },
    { actionIndex: 2, type: "capture", value: "fixture", required: true, result: { capturedOnly: true } }];
  const api = JSON.parse(await readFile(path.join(captureRoot, "api-records.json"), "utf8"));
  await hydrateResponseBodySidecars(api, captureRoot, recipe.responseBodyLimits);
  const assessment = evaluateKnownOperationRefreshEvidence({ actionResults: actions, apiRecords: api, plan: refresh });
  if (assessment.status !== "observed") throw new Error("Synthetic fixture must contain real complete target sidecars.");
  await writeFile(path.join(captureRoot, "summary.json"), json({ portal: title, finalUrl: nativeUrl, responseBodyLimits: recipe.responseBodyLimits,
    actionValidation: summarizeActionResults(actions), syntheticFixtureOnly: true }));
  await writeFile(path.join(captureRoot, "action-results.json"), json(actions));
  await writeFile(path.join(captureRoot, "known-operation-refresh-assessment.json"), json(assessment));
  const packet = await buildCaptureWorkerPacket({ args, actionBudget, recipePath, noveltyPlan: null, knownOperationRefreshPlan: refresh,
    brief: { specId, portal: title, portalUrl: nativeUrl, recipe: recipePath, allowedEvidence: [], pathPrefixes: [], serverUrls: [], stopConditions: [] } });
  await writeFile(packetPath, json(packet));
  const run = { status: "completed", phase: "all", artifacts: captureRoot, assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest,
    workerId, identityLinkage: args.identityLinkage, workerPacketSha256: packet.packetSha256, capture: await inspectCaptureCompleteness(captureRoot),
    knownOperationRefreshPlan: refresh, knownOperationRefresh: assessment,
    ledger: { assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest, workerId, attemptNumber: 1, ledgerPath }, syntheticFixtureOnly: true };
  await writeFile(path.join(captureRoot, "discovery-run.json"), json(run));
  await updateAttemptFromDiscoveryRun({ ...args, attemptNumber: 1, discoveryRun: run, artifactDir: captureRoot });
  await writeFile(resultPath, json({ schemaVersion: 1, assignmentId: assignment.assignmentId, assignmentDigest: assignment.assignmentDigest,
    assignmentType: "capture", workerId, runtimeRole: { model: args.model, reasoning: args.reasoning }, model: args.model, reasoning: args.reasoning,
    attemptNumber: 1, captureRoot, status: "completed", decision: "accept", reasonCodes: [], blockers: [], metrics: {}, recommendedNextAction: "none", lessons: [],
    lifecycleAccounting: { terminalOwnerShutdown: true, artifactLedgerAccounting: true }, processImprovementDisposition: "not-required", syntheticFixtureOnly: true }));
  return { resultPath, planPath, packetPath, ledgerPath };
}
