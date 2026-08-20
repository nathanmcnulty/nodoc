import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProcessSupervisionTimeoutError,
  runNode,
  runNodeJson,
  writeParentSupervisionFailure,
} from "../portal-discovery-process.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("productive child work may exceed the finalization-equivalent timeout", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-process-complete-"));
  const childPath = path.join(artifactDir, "child.mjs");
  try {
    await writeFile(childPath, "await new Promise((resolve) => setTimeout(resolve, 250));\n", "utf8");
    await runNode(childPath, [], 1000, { cwd: repoRoot, stdio: "ignore" });
    assert.equal(250 > 25, true);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("bounded child JSON capture returns one structured result", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-process-json-"));
  const childPath = path.join(artifactDir, "child.mjs");
  try {
    await writeFile(childPath, "console.log(JSON.stringify({ status: 'ready', controls: 2 }));\n", "utf8");
    assert.deepEqual(
      await runNodeJson(childPath, [], 1000, { cwd: repoRoot }),
      { status: "ready", controls: 2 },
    );
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("parent supervision failure metadata is explicit and does not fabricate capture health", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-process-failure-"));
  const failurePath = path.join(artifactDir, "capture-failure.json");
  try {
    const failure = await writeParentSupervisionFailure(failurePath, 25, "parent deadline exceeded");
    assert.deepEqual(JSON.parse(await readFile(failurePath, "utf8")), failure);
    assert.equal(failure.phase, "parent-supervision");
    assert.equal(failure.source, "run-portal-discovery");
    assert.equal(failure.interactionHealth, undefined);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("stalled child produces a typed parent supervision timeout", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-process-timeout-"));
  const childPath = path.join(artifactDir, "child.mjs");
  try {
    await writeFile(childPath, "await new Promise(() => {});\n", "utf8");
    await assert.rejects(
      runNode(childPath, [], 25, { cwd: repoRoot, stdio: "ignore" }),
      (error) => error instanceof ProcessSupervisionTimeoutError
        && error.timeoutMs === 25,
    );
    assert.equal(await readFile(childPath, "utf8"), "await new Promise(() => {});\n");
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});
