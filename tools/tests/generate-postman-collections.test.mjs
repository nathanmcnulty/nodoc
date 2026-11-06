import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCollectionParity,
  getMediaTypeExample,
  mergeCollectionVariables,
  mergeRequestExamples,
  parseCollectionOptions,
} from "../generate-postman-collections.mjs";

test("Postman check mode selects all collections or the exact requested subset", () => {
  const all = parseCollectionOptions(["--check"]);
  assert.equal(all.check, true);
  assert.equal(all.definitions.length, 22);
  assert.deepEqual(parseCollectionOptions(["--check", "Teams"]).definitions.map(({ name }) => name), ["Teams"]);
  assert.deepEqual(parseCollectionOptions(["--check"], "Teams,Exchange").definitions.map(({ name }) => name), ["Exchange", "Teams"]);
  assert.equal(parseCollectionOptions(["Teams"]).check, false);
});

test("Postman selection rejects any unknown selector instead of silently checking a subset", () => {
  assert.throws(() => parseCollectionOptions(["Teams", "typo"]), /No collections matched: typo/u);
  assert.throws(() => parseCollectionOptions(["--check", "--unknown"]), /Unknown options/u);
});

test("Postman parity requires exact bytes and detects missing or changed collections", () => {
  const committed = Buffer.from('{"item":[]}\n');
  assert.equal(assertCollectionParity(committed, Buffer.from(committed)), true);
  assert.throws(() => assertCollectionParity(committed, Buffer.from('{"item":[{}]}\n'), "Teams"), /Teams differs/u);
  assert.throws(() => assertCollectionParity(committed, Buffer.from('{"item":[]}\r\n')), /differs/u);
  assert.throws(() => assertCollectionParity(null, committed), /differs/u);
  assert.equal(committed.toString(), '{"item":[]}\n');
});

test("selects inline named media-type examples before schema fallback", () => {
  assert.equal(getMediaTypeExample({
    examples: {
      external: { externalValue: "https://example.invalid/example.json" },
      observed: { value: false },
    },
    schema: { example: "fallback" },
  }), false);

  assert.deepEqual(getMediaTypeExample({
    examples: { observedEmpty: { value: [] } },
    schema: { example: ["fallback"] },
  }), []);

  assert.equal(getMediaTypeExample({
    examples: { observedNull: { value: null } },
    schema: { example: "fallback" },
  }), null);
});

test("preserves single media-type example priority and ignores externalValue", () => {
  assert.equal(getMediaTypeExample({
    example: "single",
    examples: { named: { value: "named" } },
    schema: { example: "schema" },
  }), "single");

  assert.equal(getMediaTypeExample({
    examples: { external: { externalValue: "https://example.invalid/example.json" } },
    schema: { example: "schema" },
  }), "schema");
});

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
