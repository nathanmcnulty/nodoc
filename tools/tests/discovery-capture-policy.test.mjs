import assert from "node:assert/strict";
import test from "node:test";

import {
  actionResultSucceeded,
  decodeBoundedCdpBody,
  shouldRequestResponseBody,
  summarizeActionResults,
} from "../discovery-capture-policy.mjs";

test("response bodies require a known bounded transfer size", () => {
  assert.equal(shouldRequestResponseBody(undefined), false);
  assert.equal(shouldRequestResponseBody(Number.NaN), false);
  assert.equal(shouldRequestResponseBody(512 * 1024), true);
  assert.equal(shouldRequestResponseBody(512 * 1024 + 1), false);
});

test("decoded response bodies are rejected above the byte limit", () => {
  assert.equal(decodeBoundedCdpBody({ body: "hello" }, 5), "hello");
  assert.equal(decodeBoundedCdpBody({ body: "hello!" }, 5), null);
  assert.equal(
    decodeBoundedCdpBody({
      base64Encoded: true,
      body: Buffer.from("hello").toString("base64"),
    }, 5),
    "hello",
  );
});

test("required action failures are surfaced deterministically", () => {
  const results = [
    {
      page: "seed",
      required: true,
      result: {
        resolvedUrl: "https://security.microsoft.com/incidents",
        url: "https://security.microsoft.com/incidents",
      },
      type: "navigate",
      value: "https://security.microsoft.com/incidents",
    },
    {
      page: "click",
      required: true,
      result: { clicked: false },
      type: "click-label",
      value: "Incidents",
    },
  ];
  assert.equal(actionResultSucceeded(results[0]), true);
  assert.deepEqual(summarizeActionResults(results), {
    requiredActionCount: 2,
    requiredActionFailureCount: 1,
    requiredActionFailures: [{
      page: "click",
      type: "click-label",
      value: "Incidents",
    }],
  });
});

test("confirmed required probes count as successful actions", () => {
  assert.equal(actionResultSucceeded({
    result: { outcome: "confirmed" },
    type: "probe-get",
  }), true);
});

test("initial navigation accepts a same-origin canonical landing route", () => {
  assert.equal(actionResultSucceeded({
    allowCanonicalRedirect: true,
    result: {
      resolvedUrl: "https://security.microsoft.com",
      url: "https://security.microsoft.com/homepage",
    },
    type: "navigate",
  }), true);
});
