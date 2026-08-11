import assert from "node:assert/strict";
import test from "node:test";

import { mergeCollectionVariables } from "../generate-postman-collections.mjs";

test("preserves matching collection variable values while retaining current-only values", () => {
  const current = [
    { key: "assessmentId", value: "converter-id" },
    { key: "date", value: "converter-date" },
  ];
  const previous = [
    { key: "assessmentId", value: "stable-id" },
  ];

  assert.deepEqual(mergeCollectionVariables(current, previous), [
    { key: "assessmentId", value: "stable-id" },
    { key: "date", value: "converter-date" },
  ]);
});

test("leaves generated variables unchanged when no prior collection exists", () => {
  const current = [
    { key: "assessmentId", value: "converter-id" },
    { key: "date", value: "converter-date" },
  ];

  assert.deepEqual(mergeCollectionVariables(current, undefined), current);
});
