import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../..");

test("a YAML response alias cannot authorize an unobserved operation through another route's evidence", { timeout: 120000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nodoc-alias-evidence-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await mkdir(source);
  for (const name of ["tools", "package-lock.json", ".gitignore", "AGENT_DISCOVERY_RUNBOOK.md", "AGENT_DISCOVERY_PLAYBOOK.md", "PORTAL_DISCOVERY_AGENT_PROMPT.md"]) {
    await cp(path.join(repository, name), path.join(source, name), { recursive: true, filter: file => file !== path.join(repository, "tools/tests") });
  }
  await symlink(path.join(repository, "node_modules"), path.join(source, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const destination = "specifications/nodoc-fixture/specification/openapi.yml";
  await mkdir(path.dirname(path.join(source, destination)), { recursive: true });
  await writeFile(path.join(source, destination), `openapi: 3.0.3
info: {title: Fixture, version: '1.0'}
servers: [{url: 'https://fixture.example.invalid'}]
paths:
  /observed:
    get:
      operationId: observed
      responses:
        '200': &sharedResponse
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  enabled: {type: boolean}
  /unobserved:
    get:
      operationId: unobserved
      responses:
        '200': *sharedResponse
`);
  const git = args => execute("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: source });
  await git(["init", "--quiet"]); await git(["add", "--all"]); await git(["commit", "--quiet", "-m", "Synthetic baseline"]);
  const driver = path.join(root, "driver.mjs");
  await writeFile(driver, `
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {pathToFileURL} from "node:url";
const source=process.argv[2],root=path.dirname(source),destination=${JSON.stringify(destination)};
const YAML=createRequire(path.join(source,"package-lock.json"))("yaml");
const mod=name=>import(pathToFileURL(path.join(source,"tools",name)));
const {analyzeRefreshCapture,refreshAnalysisDigest}=await mod("portal-refresh.mjs");
const {prepareRefreshProposals,reportRefreshMergeEligibility}=await mod("portal-refresh-proposals.mjs");
const {buildSpecRouteInventory}=await mod("spec-quality-lib.mjs");
const {writeResponseBodySidecar}=await mod("response-body-sidecars.mjs");
const {aggregateInteractionHealth}=await mod("discovery-capture-policy.mjs");
const {createSourceReviewReceipt}=await mod("source-review-receipt.mjs");
const {refreshSourceState}=await mod("portal-refresh-binding.mjs");
const {portalDiscoveryModelPolicy:policy}=await mod("portal-discovery-model-policy.mjs");
const json=x=>JSON.stringify(x,null,2)+"\\n",hash=x=>createHash("sha256").update(x).digest("hex");
const capture=path.join(root,"capture"),cache=path.join(root,"cache"),proposals=path.join(root,"proposals");await mkdir(capture);await mkdir(proposals);
const evidenceId="request-synthetic-observed",body=await writeResponseBodySidecar({artifactDir:capture,evidenceId,sanitizedBody:'{"enabled":true}'});
const records=[{method:"GET",url:"https://fixture.example.invalid/observed",path:"/observed",status:200,mimeType:"application/json",evidenceId,observedAt:"2026-11-06T10:00:00Z",attribution:{actionIndex:0},bodyCapture:body.bodyCapture}];
for(const[name,value]of Object.entries({"raw-requests.json":records,"api-records.json":records,"action-results.json":[{actionIndex:0,type:"capture",required:true,result:{}}],"summary.json":{portal:"Fixture",interactionHealth:aggregateInteractionHealth([]),actionValidation:{requiredActionFailures:[]}}}))await writeFile(path.join(capture,name),json(value));
const inventory=await buildSpecRouteInventory(),result=await analyzeRefreshCapture({artifacts:capture,specId:"fixture",cacheDir:cache,inventory});
assert.equal(result.analysis.captureComplete,true);
const entry=result.analysis.enrichments[0];assert.equal(entry.path,"/observed");assert.equal(result.analysis.enrichments.length,1);
const before=await readFile(path.join(source,destination),"utf8"),document=YAML.parseDocument(before);
document.setIn(["paths","/observed","get","responses","200","content","application/json","examples","syntheticRefresh"],{summary:"Synthetic values illustrating an observed response shape; not a captured response.",description:\`Based on passive portal observation \${entry.observedAt}, evidence \${entry.evidenceId}. Scalar values are synthesized; this example illustrates one observed shape.\`,value:entry.syntheticExample});
const proposed=document.toString({lineWidth:0});
assert.ok(YAML.parse(proposed).paths["/unobserved"].get.responses[200].content["application/json"].examples.syntheticRefresh,"The alias actually changes the unobserved route.");
const proposal=path.join(proposals,"manual.yml");await writeFile(proposal,proposed);
const evidence={destination,kind:"synthetic-example"};for(const key of ["specId","method","path","status","mimeType","captureId","evidenceId","actionIndex","observedAt","supportingObservations"])evidence[key]=entry[key];
const manifest={schemaVersion:1,visibility:"private-evidence-only",captureId:result.analysis.captureId,analysisDigest:refreshAnalysisDigest(result.analysis),changes:[{destination,beforeSha256:hash(before),beforeSource:before,proposalSha256:hash(proposed),proposal}],evidence:[evidence],requiresIndependentPrivacyReview:true,rawResponseValuesIncluded:false,syntheticScalarExamplesOnly:true};
const manifestPath=path.join(proposals,"manifest.json");await writeFile(manifestPath,json(manifest));const manifestDigest=hash(await readFile(manifestPath));
const review={decision:"accepted",reviewedManifestSha256:manifestDigest,sanitized:true,completeEvidence:true,model:policy.offlineReview.model,reasoning:policy.offlineReview.reasoning,syntheticFixtureOnly:true};
const reviewPath=path.join(root,"review.json"),receiptPath=path.join(root,"receipt.json");await writeFile(reviewPath,json(review));const sourceReview={manifestPath,reviewPath,receiptPath};createSourceReviewReceipt({root:source,...sourceReview});await writeFile(path.join(source,destination),proposed);
const state=await refreshSourceState(),checks={...state,manifestDigest,appliedChanges:{[destination]:hash(proposed)},results:Object.fromEntries(["discovery","spec-quality","portal-metadata","evaluations","graph-research","site-data","postman-parity","typecheck","build","privacy"].map(name=>[name,{observed:true,exitCode:0,syntheticFixtureOnly:true}]))};
const report=await reportRefreshMergeEligibility({manifest,review,checks,sourceRevision:state.sourceRevision,sourceReview,proposalRoot:proposals,analysisPath:path.join(cache,result.cacheKey+".json")});
assert.deepEqual(report.reasonCodes,[],"All capture/source/review/check bindings must pass.");
assert.equal(report.eligible,false,JSON.stringify(report));
assert.ok(report.changes[0].reasonCodes.includes("semantic-edit-outside-verified-target"),JSON.stringify(report));
assert.equal(report.actualAutomaticMergingEnabled,false);
// Proposal generation must catch the same implicit cross-operation mutation.
await writeFile(path.join(source,destination),before);
await assert.rejects(prepareRefreshProposals({analysis:result.analysis,inventory,selections:[{specId:"fixture",evidenceId,kind:"synthetic-example"}],outputDir:path.join(root,"generated"),captureDirectory:capture}),/Shared YAML aliases or unrelated semantic edits/);
console.log("unobserved alias edit rejected with all other bindings valid");
`);
  const { stdout } = await execute(process.execPath, [driver, source], { cwd: source, timeout: 110000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(stdout, /unobserved alias edit rejected/);
  assert.equal(await readFile(path.join(repository, "tools/portal-refresh-proposals.mjs"), "utf8"), await readFile(path.join(source, "tools/portal-refresh-proposals.mjs"), "utf8"));
});
