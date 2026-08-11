import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mergeCollectionVariables,
  mergeRequestExamples,
} from "../generate-postman-collections.mjs";

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

test("preserves matching multipart form-data values from the prior collection", () => {
  const current = {
    method: "POST",
    body: {
      mode: "formdata",
      formdata: [
        { key: "file", type: "file" },
        { key: "hasParameters", value: "true", type: "text" },
        { key: "overrideIfExists", value: "true", type: "text" },
      ],
    },
  };
  const previous = {
    method: "POST",
    body: {
      mode: "formdata",
      formdata: [
        { key: "file", type: "file" },
        { key: "hasParameters", value: "false", type: "text" },
        { key: "overrideIfExists", value: "false", type: "text" },
      ],
    },
  };

  assert.deepEqual(mergeRequestExamples(current, previous), {
    ...current,
    body: {
      ...current.body,
      formdata: [
        { key: "file", type: "file" },
        { key: "hasParameters", value: "false", type: "text" },
        { key: "overrideIfExists", value: "false", type: "text" },
      ],
    },
  });
});

test("pins the external Postman generation tools to exact versions", () => {
  const generatorSource = readFileSync(
    new URL("../generate-postman-collections.mjs", import.meta.url),
    "utf8",
  );
  const packageSpecs = [...generatorSource.matchAll(/"--package=([^"]+)"/gu)]
    .map((match) => match[1]);

  assert.deepEqual(packageSpecs, [
    "@redocly/cli@2.46.0",
    "openapi-to-postmanv2@6.0.0",
  ]);
});
