import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("click actions activate a matched control exactly once", async () => {
  const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /if \(typeof match\.element\.click === "function"\) \{\s+match\.element\.click\(\);\s+\} else \{\s+match\.element\.dispatchEvent/,
  );
  assert.doesNotMatch(
    source,
    /dispatchEvent\(new MouseEvent\("click"[\s\S]{0,200}match\.element\.click\(\)/,
  );
});

test("the summary is built only after the final reversible receipt refresh", async () => {
  const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
  const finalFlush = source.indexOf("await flushArtifacts();\n    if (args.activeOperationPlan?.mode === \"reversible-scalar\")");
  const finalRefresh = source.indexOf("await refreshReversibleOperationReceipt();", finalFlush);
  const summary = source.indexOf("const summary = {", finalRefresh);
  const summaryWritten = source.indexOf("summaryWritten = true;", summary);
  const guardedFallback = source.indexOf("&& !summaryWritten", summaryWritten);

  assert.notEqual(finalFlush, -1);
  assert.ok(finalRefresh > finalFlush);
  assert.ok(summary > finalRefresh);
  assert.ok(summaryWritten > summary);
  assert.ok(guardedFallback > summaryWritten);
});

test("an abort interception setup failure persists an unresolved receipt before throwing", async () => {
  const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /context = await beginAbortInterception\(plan\);[\s\S]{0,600}setupFailureCount: 1,[\s\S]{0,300}await replaceOperationReceipt\(receipt\);[\s\S]{0,80}throw error;/,
  );
});

test("a reversible mutation persists unresolved intent before Fetch continue acknowledgement", async () => {
  const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
  const intent = source.indexOf("await persistReversibleInterceptionContext(context);");
  const continueHandler = source.indexOf("const outcome = await handlePausedOperationRequest", intent);
  assert.notEqual(intent, -1);
  assert.ok(continueHandler > intent);
});

test("reversible setup failure and unproven late requests are persisted and contained", async () => {
  const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /beginAbortInterception\(plan, operationStep\.name\);[\s\S]{0,800}persistReversibleInterceptionContext\(failedContext\);[\s\S]{0,80}throw error;/,
  );
  assert.match(
    source,
    /Page\.navigate", \{ url: "about:blank" \}[\s\S]{0,800}Target\.closeTarget[\s\S]{0,900}endAbortInterception\(\{[\s\S]{0,300}disable:/,
  );
  const endInterception = source.indexOf("async function endAbortInterception");
  const endContainment = source.indexOf("activeAbortContext.containmentOnly = true;", endInterception);
  const handlerDrain = source.indexOf("if (pendingFetchHandlers.size > 0)", endInterception);
  assert.ok(endContainment > endInterception);
  assert.ok(handlerDrain > endContainment);
  const reversibleCleanup = source.indexOf("if (clickResult?.clicked && context.approvedRequestCount === 0)");
  const cleanupContainment = source.indexOf("context.containmentOnly = true;", reversibleCleanup);
  const cleanupNavigation = source.indexOf('client.send("Page.navigate", { url: "about:blank" })', reversibleCleanup);
  const cleanupEndInterception = source.indexOf("await endAbortInterception", reversibleCleanup);
  assert.ok(cleanupContainment > reversibleCleanup);
  assert.ok(cleanupNavigation > cleanupContainment);
  assert.ok(cleanupEndInterception > cleanupNavigation);
  assert.match(source, /boundSessionId: context\.boundSessionId,[\s\S]{0,160}boundTargetId: context\.boundTargetId,[\s\S]{0,160}containmentOnly: context\.containmentOnly === true/);
  assert.match(source, /boundInventory\.sessionId[\s\S]{0,250}boundInventory\.targetId/);
});

test("bundle capture timeout preserves network evidence and emits a scoped diagnostic", async () => {
  const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /error instanceof CapturePhaseTimeoutError[\s\S]{0,180}error\.phase !== "script-capture"[\s\S]{0,500}bundle-capture-failure\.json[\s\S]{0,300}bundle-analysis-incomplete-network-evidence-preserved/,
  );
  const timeoutCatch = source.indexOf('error.phase !== "script-capture"');
  const apiWrite = source.indexOf('path.join(args.outDir, "api-records.json")', timeoutCatch);
  assert.ok(timeoutCatch >= 0);
  assert.ok(apiWrite > timeoutCatch);
});
