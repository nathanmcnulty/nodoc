import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCollectionParity,
  getMediaTypeExample,
  mergeCollectionVariables,
  mergeRequestExamples,
  parseCollectionOptions,
  runPostmanTool,
} from "../generate-postman-collections.mjs";

test("Postman tools preserve literal Windows metacharacters and all temporary path arguments", t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nodoc-postman spaces &^%PATH%! (test)-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "CLI spaces &^%PATH%!.mjs");
  writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  const bundled = path.join(root, "m365-admin.collection.bundled.json");
  const checked = path.join(root, "m365-admin.collection.json");
  const generated = path.join(root, "repository & (copy)", "postman", "collections", "m365-admin.collection.json");
  const bundleArgs = ["bundle", "specification/openapi.yml", "--ext", "json", "-o", bundled];
  assert.deepEqual(JSON.parse(runPostmanTool(script, bundleArgs, { cwd: root, stdio: "pipe" }).stdout.toString()), bundleArgs);
  for (const output of [checked, generated]) {
    const args = ["-s", bundled, "-o", output, "-c", "postman_to_openapi.json", "spaces here", "%PATH%", "!PATH!", "^", "&", "|", ">", "<", '(parentheses)', 'embedded"quote', "trailing\\", "& echo injected > injected.txt"];
    const result = runPostmanTool(script, args, { cwd: root, stdio: "pipe" });
    assert.deepEqual(JSON.parse(result.stdout.toString()), args);
  }
  assert.equal(existsSync(path.join(root, "injected.txt")), false);
});

test("Postman check mode uses real pinned CLIs under a Windows TEMP path with spaces and metacharacters", { timeout: 120000 }, t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nodoc-postman TEMP &^%PATH%! (test)-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const temporary = path.join(root, "temporary &^%PATH%! (files)");
  mkdirSync(temporary);
  const repository = path.resolve(import.meta.dirname, "../..");
  const collection = path.join(repository, "postman/collections/m365-admin.collection.json");
  const before = readFileSync(collection);
  const result = spawnSync(process.execPath, [path.join(repository, "tools/generate-postman-collections.mjs"), "--check", "M365 Admin"], {
    cwd: root, encoding: "utf8", timeout: 110000,
    env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary, COMSPEC: path.join(root, "no-shell.exe"), npm_execpath: path.join(root, "no-npm-cli.js") },
    shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified M365 Admin collection parity/u);
  assert.deepEqual(readFileSync(collection), before);
  assert.equal(existsSync(path.join(temporary, "injected.txt")), false);
});

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
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
  for (const [name, version] of [["@redocly/cli", "2.46.0"], ["openapi-to-postmanv2", "6.0.0"]]) {
    assert.equal(manifest.devDependencies[name], version);
    assert.equal(lock.packages[""].devDependencies[name], version);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
});
