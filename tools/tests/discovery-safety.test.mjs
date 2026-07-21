import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGetProbeUrl,
  sanitizeObservedTransportUrl,
} from "../discovery-safety.mjs";

test("allows same-origin read-like GET probes", () => {
  assert.deepEqual(
    classifyGetProbeUrl("/admin/api/users?top=10", "https://admin.cloud.microsoft"),
    {
      allowed: true,
      code: "allowed",
      url: "https://admin.cloud.microsoft/admin/api/users?top=10",
    },
  );
});

test("rejects cross-origin, credentialed, and active-looking GET probes", () => {
  assert.equal(
    classifyGetProbeUrl("https://example.com/api/users", "https://admin.cloud.microsoft").code,
    "cross-origin-or-unsupported",
  );
  assert.equal(
    classifyGetProbeUrl(
      "https://user:secret@admin.cloud.microsoft/admin/api/users",
      "https://admin.cloud.microsoft",
    ).code,
    "cross-origin-or-unsupported",
  );
  assert.equal(
    classifyGetProbeUrl("/admin/api/export", "https://admin.cloud.microsoft").code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl("/admin/api/%65xport", "https://admin.cloud.microsoft").code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl("/admin/api/export.csv", "https://admin.cloud.microsoft").code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl("/admin/api/remove", "https://admin.cloud.microsoft").code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl("/admin/api/save", "https://admin.cloud.microsoft").code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl("/#/export", "https://admin.cloud.microsoft").code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl(
      "/admin/api/users?action=trigger",
      "https://admin.cloud.microsoft",
    ).code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl(
      "/admin/api/users?action=%2574rigger.csv",
      "https://admin.cloud.microsoft",
    ).code,
    "active-get-denied",
  );
  assert.equal(
    classifyGetProbeUrl(
      "/admin/api/users?%2561ction=%2574rigger",
      "https://admin.cloud.microsoft",
    ).code,
    "active-get-denied",
  );
});

test("redacts passive transport URL values and credentials", () => {
  assert.equal(
    sanitizeObservedTransportUrl(
      "wss://user:secret@example.com/socket?access_token=secret&tenant=contoso#fragment",
    ),
    "wss://example.com/socket?access_token=%5Bredacted%5D&tenant=%5Bredacted%5D",
  );
  assert.equal(sanitizeObservedTransportUrl("not a url"), null);
});
