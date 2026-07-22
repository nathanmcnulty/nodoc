import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("Purview unsafe POST observations are suppressed from generated queues", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-purview-suppressions-"));
  const unsafePaths = [
    "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{placeholder}/IRMEasyPolicy",
    "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{placeholder}/OnboardingChecklist",
    "/apiproxy/msgraph/v1.0/$batch",
  ];
  const normalizedUnsafePaths = unsafePaths.map((candidatePath) => (
    candidatePath.replace("{placeholder}", "{id}")
  ));

  try {
    await Promise.all([
      writeFile(
        path.join(artifactDir, "api-records.json"),
        JSON.stringify(unsafePaths.map((candidatePath) => ({
          method: "POST",
          path: candidatePath,
          seenOnPages: ["tenant-neutral-test"],
        }))),
        "utf8",
      ),
      writeFile(
        path.join(artifactDir, "bundle-candidates.json"),
        JSON.stringify({
          candidates: unsafePaths.map((candidatePath) => ({
            candidatePath,
            method: "POST",
            sourceFile: "tenant-neutral-fixture.js",
          })),
        }),
        "utf8",
      ),
    ]);

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
      "--spec",
      "purview",
      "--artifacts",
      artifactDir,
      "--json",
    ], { cwd: repoRoot });
    const queue = JSON.parse(stdout);
    const candidateKey = ({ method, normalizedPath }) => `${method} ${normalizedPath}`;
    const expectedKeys = normalizedUnsafePaths
      .map((candidatePath) => `POST ${candidatePath}`)
      .sort();

    assert.deepEqual(
      queue.suppressedCandidates.map(candidateKey).sort(),
      expectedKeys,
    );
    assert.equal(queue.summary.suppressedCandidateCount, unsafePaths.length);
    assert.ok(queue.suppressedCandidates.every(({ evidence, sourceArtifacts }) => (
      evidence === "confirmed"
      && sourceArtifacts.includes("api-records.json")
      && sourceArtifacts.includes("bundle-candidates.json")
    )));
    assert.ok(queue.candidates.every((candidate) => (
      !expectedKeys.includes(candidateKey(candidate))
    )));
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("mined methods flow into the crawl candidate queue", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-discovery-"));
  try {
    const bundleDir = path.join(artifactDir, "bundles");
    await mkdir(bundleDir);
    await writeFile(
      path.join(bundleDir, "feature.js"),
      [
        'client.get("/admin/api/nodocDiscoveryPipelineTest");',
        'const operation = "query DiscoveryPipelineTenant { tenant { id } }";',
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, "bundle-downloads.json"),
      JSON.stringify([{ localPath: "bundles/feature.js" }]),
      "utf8",
    );

    await execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "mine-javascript-bundles.mjs"),
      "--artifacts",
      artifactDir,
      "--prefix",
      "/admin/",
    ], { cwd: repoRoot });

    const mined = JSON.parse(
      await readFile(path.join(artifactDir, "bundle-candidates.json"), "utf8"),
    );
    assert.deepEqual(
      mined.candidates.map(({ candidatePath, method }) => ({ candidatePath, method })),
      [{ candidatePath: "/admin/api/nodocDiscoveryPipelineTest", method: "GET" }],
    );

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
      "--spec",
      "m365-admin",
      "--artifacts",
      artifactDir,
      "--json",
    ], { cwd: repoRoot });
    const queue = JSON.parse(stdout);
    const candidate = queue.candidates.find(
      (entry) => entry.normalizedPath === "/admin/api/nodocDiscoveryPipelineTest",
    );
    assert.equal(candidate?.method, "GET");
    assert.equal(candidate?.evidence, "bundle-discovered");
    assert.deepEqual(
      queue.graphqlOperations.map(({ name, operationType }) => ({ name, operationType })),
      [{ name: "DiscoveryPipelineTenant", operationType: "query" }],
    );
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("portal driver emits a deterministic M365 Admin brief", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
    "--portal",
    "m365-admin",
    "--phase",
    "plan",
    "--json",
  ], { cwd: repoRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.status, "planned");
  assert.equal(result.brief.profile, "bounded");
  assert.equal(result.brief.portal, "M365 Admin");
  assert.equal(result.brief.recipe, "tools/capture-recipes/m365-admin-deep.json");
  assert.deepEqual(result.brief.safety.allowedProbeMethods, ["GET"]);
  assert.equal(result.brief.safety.crossOriginProbes, false);
  assert.equal(result.brief.safety.writeActions, false);
});

test("portal driver prefers the bounded Defender deep recipe", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
    "--portal",
    "defender-xdr",
    "--phase",
    "plan",
    "--json",
  ], { cwd: repoRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.status, "planned");
  assert.equal(result.brief.recipe, "tools/capture-recipes/defender-deep.json");
});

test("portal driver rejects unsupported profiles", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
      "--portal",
      "m365-admin",
      "--profile",
      "unbounded",
      "--phase",
      "plan",
    ], { cwd: repoRoot }),
    /Only the bounded profile is currently supported/u,
  );
});

test("portal driver prefers an exact portal recipe over generic recipes", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
    "--portal",
    "m365-apps-services",
    "--phase",
    "plan",
    "--json",
  ], { cwd: repoRoot });
  const result = JSON.parse(stdout);

  assert.equal(
    result.brief.recipe,
    "tools/capture-recipes/m365-apps-services-deep.json",
  );
});

test("portal driver rejects recipes outside the checked-in portal allowlist", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
      "--portal",
      "m365-admin",
      "--phase",
      "plan",
      "--recipe",
      path.join(os.tmpdir(), "untrusted-recipe.json"),
    ], { cwd: repoRoot }),
    /not checked in for M365 Admin/u,
  );
});

test("portal driver rejects non-empty capture directories", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-stale-capture-"));
  try {
    await writeFile(path.join(artifactDir, "session-snapshots.json"), "[]\n", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
        "--portal",
        "m365-admin",
        "--phase",
        "capture",
        "--artifacts",
        artifactDir,
      ], { cwd: repoRoot }),
    );

    const runState = JSON.parse(
      await readFile(path.join(artifactDir, "discovery-run.json"), "utf8"),
    );
    assert.equal(runState.status, "blocked");
    assert.equal(runState.blocker.code, "artifacts-not-empty");
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("bundle manifests cannot escape the artifact directory", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-containment-"));
  try {
    const artifactDir = path.join(rootDir, "artifacts");
    await mkdir(path.join(artifactDir, "bundles"), { recursive: true });
    await writeFile(
      path.join(rootDir, "outside.js"),
      'fetch("/admin/api/should-not-be-read");',
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, "bundle-downloads.json"),
      JSON.stringify([{ localPath: "../outside.js" }]),
      "utf8",
    );

    await execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "mine-javascript-bundles.mjs"),
      "--artifacts",
      artifactDir,
      "--prefix",
      "/admin/",
    ], { cwd: repoRoot });

    const mined = JSON.parse(
      await readFile(path.join(artifactDir, "bundle-candidates.json"), "utf8"),
    );
    assert.equal(mined.bundleCount, 0);
    assert.deepEqual(mined.candidates, []);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
