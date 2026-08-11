import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadBundledSpecification,
  validateOperationIds,
} from "../spec-quality-lib.mjs";

test("Entra IAM has a stable unique operation ID for every operation", async () => {
  const specification = await loadBundledSpecification(
    fileURLToPath(new URL(
      "../../specifications/nodoc-ibiza-iam/specification/openapi.yml",
      import.meta.url,
    )),
  );

  assert.deepEqual(validateOperationIds(specification, "Entra IAM"), {
    operationCount: 286,
    operationIds: 286,
  });
});

test("operation ID validation rejects missing and duplicate IDs", () => {
  assert.throws(
    () => validateOperationIds({ paths: {
      "/items": {
        get: { operationId: "Items.Get" },
        post: { operationId: "Items.Get" },
        delete: {},
      },
    } }, "fixture"),
    /fixture has invalid operation IDs .*missing: DELETE \/items.*duplicates: Items\.Get/,
  );
});
