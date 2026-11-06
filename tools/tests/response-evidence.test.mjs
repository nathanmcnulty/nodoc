import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectVerifiedResponse, jsonTokenType, primitiveTypeCompatible, scanPublicResponseFingerprints, summarizeJsonTokens } from "../response-evidence.mjs";
import { writeResponseBodySidecar } from "../response-body-sidecars.mjs";

test("JSON token facts distinguish nullable, integer, date strings and empty collections without values", () => {
  const value = { date: "2026-10-30T00:00:00.000Z", rows: [{ optional: null, count: 1 }, { optional: "private-value", count: 1.5 }], empty: [] };
  const facts = summarizeJsonTokens(value);
  assert.deepEqual(facts.find((field) => field.pointer === "/rows/*/optional").types, ["null", "string"]);
  assert.deepEqual(facts.find((field) => field.pointer === "/rows/*/count").types, ["integer", "number"]);
  assert.deepEqual(facts.find((field) => field.pointer === "/date").types, ["string"]);
  assert.equal(facts.some((field) => field.pointer === "/empty/*"), false);
  assert.equal(JSON.stringify(facts).includes("private-value"), false);
  assert.equal(primitiveTypeCompatible(null, { type: "string", nullable: true }), true);
  assert.equal(primitiveTypeCompatible(1.5, { type: "integer" }), false);
  assert.equal(primitiveTypeCompatible(1, { type: "number" }), true);
  assert.equal(primitiveTypeCompatible("a", { $ref: "#/A" }), null);
  assert.throws(() => jsonTokenType(new Date()), /JSON object/);
  assert.throws(() => jsonTokenType(new Date().getTime() / 0), /JSON number/);
});

test("private inspection requires complete verified sidecars and rejects tampering", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-response-facts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const body = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-facts", sanitizedBody: '{"flag":true}' });
  const record = { evidenceId: "request-facts", bodyCapture: body.bodyCapture };
  assert.equal((await inspectVerifiedResponse(dir, record)).visibility, "private-evidence-only");
  await writeFile(path.join(dir, body.bodyCapture.path), '{"flag":false}');
  await assert.rejects(inspectVerifiedResponse(dir, record), /hash or length/);
  await assert.rejects(inspectVerifiedResponse(dir, { ...record, bodyCapture: { state: "truncated" } }), /not complete/);
  const nonJson = await writeResponseBodySidecar({ artifactDir: dir, evidenceId: "request-nonjson", sanitizedBody: "private-response-marker" });
  await assert.rejects(inspectVerifiedResponse(dir, { evidenceId: "request-nonjson", bodyCapture: nonJson.bodyCapture }), (error) => {
    assert.match(error.message, /not valid JSON/);
    assert.equal(error.message.includes("private-response-marker"), false);
    return true;
  });
});

test("publication scan includes orphan bodies, detects body fingerprints/lengths, preserves query identities", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-response-scan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const captureRoot = path.join(dir, "private");
  const publicRoot = path.join(dir, "public");
  await mkdir(path.join(captureRoot, "failed", "response-body-sidecars"), { recursive: true });
  await mkdir(path.join(publicRoot, "specifications"), { recursive: true });
  const body = "[]";
  const digest = createHash("sha256").update(body).digest("hex");
  await writeFile(path.join(captureRoot, "failed", "response-body-sidecars", "orphan.body"), body);
  const spec = path.join(publicRoot, "specifications", "api.yml");
  await writeFile(spec, `note: complete 2-byte response\nbodyDigest: ${digest}\nquery: ${"a".repeat(64)}\n`);
  const found = await scanPublicResponseFingerprints({ captureRoot, publicRoot });
  assert.equal(found.status, "fail");
  assert.deepEqual(found.matches.map((entry) => entry.reason).sort(), ["private-response-fingerprint", "public-response-length-metadata"]);
  assert.equal(JSON.stringify(found).includes(digest), false);
  await writeFile(spec, `note: complete 2 bytes response\nbodyDigest: prefix_${digest}_suffix\n`);
  assert.deepEqual((await scanPublicResponseFingerprints({ captureRoot, publicRoot })).matches.map((entry) => entry.reason).sort(), ["private-response-fingerprint", "public-response-length-metadata"]);
  await writeFile(spec, `bodyDigest: 0${digest}0\n`);
  assert.equal((await scanPublicResponseFingerprints({ captureRoot, publicRoot })).matches[0]?.reason, "private-response-fingerprint");
  await writeFile(spec, `queryIdentityHash: ${"a".repeat(64)}\n`);
  assert.equal((await scanPublicResponseFingerprints({ captureRoot, publicRoot })).status, "pass");
});

test("empty privacy universes fail rather than report success", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-empty-scan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(scanPublicResponseFingerprints({ captureRoot: dir, publicRoot: dir }), /No private/);
});

test("privacy scans fail closed on public and capture junctions instead of skipping evidence", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodoc-linked-scan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const captureRoot = path.join(dir, "capture");
  const publicRoot = path.join(dir, "public");
  const linked = path.join(dir, "linked");
  await mkdir(path.join(captureRoot, "response-body-sidecars"), { recursive: true });
  await mkdir(path.join(publicRoot, "static"), { recursive: true });
  await mkdir(linked);
  await writeFile(path.join(captureRoot, "response-body-sidecars", "private.body"), "true");
  await writeFile(path.join(publicRoot, "static", "clean.txt"), "clean");
  await writeFile(path.join(linked, "leak.txt"), createHash("sha256").update("true").digest("hex"));
  const publicLink = path.join(publicRoot, "specifications");
  await symlink(linked, publicLink, "junction");
  await assert.rejects(scanPublicResponseFingerprints({ captureRoot, publicRoot }), /Symbolic link/);
  await rm(publicLink);
  const markdownLink = path.join(publicRoot, "README.md");
  await symlink(linked, markdownLink, "junction");
  await assert.rejects(scanPublicResponseFingerprints({ captureRoot, publicRoot }), /public Markdown/);
  await rm(markdownLink);
  await symlink(linked, path.join(captureRoot, "linked"), "junction");
  await assert.rejects(scanPublicResponseFingerprints({ captureRoot, publicRoot }), /Symbolic link/);
  const rootLink = path.join(dir, "capture-link");
  await symlink(captureRoot, rootLink, "junction");
  await assert.rejects(scanPublicResponseFingerprints({ captureRoot: rootLink, publicRoot }), /Scan root/);
});
