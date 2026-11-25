import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createNavigationObservation } from "../portal-discovery-actions.mjs";

const source = await readFile(new URL("../cdp-deep-capture.mjs", import.meta.url), "utf8");
const body = source.slice(source.indexOf("  async function navigateRoot(targetUrl) {"), source.indexOf("  async function reloadRoot()"));
async function run({ root = "root", responseDelay = 25, settleDelay = 15, load = false } = {}) {
  const listeners = { observation: null, load: null };
  const client = { send(method) {
    if (method === "Page.getFrameTree") return Promise.resolve(root ? { frameTree: { frame: { id: root } } } : {});
    if (method === "Page.navigate") { if (load) setTimeout(() => listeners.load?.(), 5); return new Promise((resolve) => setTimeout(() => resolve({ frameId: "root", loaderId: "loader" }), responseDelay)); }
    throw Error(method);
  }};
  const emit = (params, metadata = {}) => listeners.observation?.recordEvent(params, metadata);
  const evaluateJson = async () => { emit({frameId:"root",navigationType:"fragment"}); emit({frameId:"child"}); emit({frameId:"other"},{sessionId:"child-session"}); if (load) listeners.load?.(); };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const factory = new Function("client", "args", "delay", "evaluateJson", "getRootUrl", "waitForNetworkIdle", "isAbsoluteUrl", "resolveMaybeRelativeUrl", "createNavigationObservation", "listeners", `let currentLoadResolver = null; let currentWithinDocumentEvents = null; ${body} return {run: async () => { const timer = setInterval(() => { listeners.observation = currentWithinDocumentEvents; listeners.load = currentLoadResolver; }, 1); try { return await navigateRoot('https://example.test/#/groups'); } finally { clearInterval(timer); listeners.observation = currentWithinDocumentEvents; listeners.load = currentLoadResolver; } }};`);
  const instance = factory(client, {navigationTimeoutMs:20, settleMs:1}, delay, evaluateJson, async()=>"https://example.test/#/groups", async()=>{await delay(settleDelay);return {};}, ()=>true, ()=>null, createNavigationObservation, listeners);
  const result = await instance.run();
  return {result,listeners};
}
test("fallback retains root and child events and late response during settlement", async () => {
 const {result,listeners} = await run();
 assert.equal(result.didLoad,false); assert.equal(result.url,result.resolvedUrl);
 assert.equal(result.navigateResponseStatus,"received"); assert.equal(result.navigateResponse.loaderId,"loader");
 assert.deepEqual(result.navigatedWithinDocument.map(x=>x.attribution),["root-frame","child-frame","child-session"]);
 assert.equal(listeners.observation,null);
});
test("unavailable identity remains unknown and response after settlement stays pending", async () => {
 const {result,listeners} = await run({root:null,responseDelay:80,settleDelay:1,load:true});
 assert.equal(result.didLoad,true); assert.equal(result.navigateResponseStatus,"pending");
 assert.deepEqual(result.navigatedWithinDocument.map(x=>x.attribution),["unknown","unknown","child-session"]);
 await new Promise(resolve=>setTimeout(resolve,90)); assert.equal(result.navigateResponseStatus,"pending"); assert.equal(listeners.observation,null);
});
