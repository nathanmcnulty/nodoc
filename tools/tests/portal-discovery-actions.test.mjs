import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecipeAction, validateInspectionActions, navigationDescriptors } from "../portal-discovery-actions.mjs";
test("executor parsing and inspection allowlist reject unsupported and click actions", () => {
  for (const value of ["click=Open", { type: "click-label", value: "Open" }, "click-root=Open"]) {
    assert.throws(() => validateInspectionActions([normalizeRecipeAction(value)], { mode: "observe-only" }), /only navigate/);
  }
  for (const value of ["click", "bogus=x", {type:"navigate", scope:"bogus"}]) assert.throws(() => normalizeRecipeAction(value));
  validateInspectionActions(["navigate=https://example.test/a", "reload=", "wait-ms=100", "capture=x"].map(normalizeRecipeAction), {mode:"observe-only"});
});
test("private descriptors preserve exact observed SPA route and attribution", () => {
 const [a,b] = navigationDescriptors([{url:"https://example.test/base", sessionId:"s", targetId:"t", parentFrameId:"f", controls:[{text:"Open", href:"/route?tenant=secret#private", role:"tab", automationId:"open", visible:true, enabled:false},{href:"/clean#/groups"}]}]);
 assert.equal(a.href, null); assert.equal(a.host,"example.test"); assert.equal(a.pathname,"/route"); assert.equal(a.sessionId,"s"); assert.equal(a.targetId,"t"); assert.equal(a.parentFrameId,"f"); assert.equal(a.enabled,false); assert.equal(b.href,"https://example.test/clean#/groups");
 assert.doesNotMatch(JSON.stringify([a,b]), /secret|private/);

});
