import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runAnalyze(portal, artifactDir) {
  await execFileAsync(process.execPath, [
    path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
    "--portal",
    portal,
    "--phase",
    "analyze",
    "--artifacts",
    artifactDir,
  ], { cwd: repoRoot });

  const [candidateHandoff, runState] = await Promise.all([
    readFile(path.join(artifactDir, "candidate-handoff.json"), "utf8"),
    readFile(path.join(artifactDir, "discovery-run.json"), "utf8"),
  ]);
  return {
    candidateHandoff: JSON.parse(candidateHandoff),
    candidateHandoffText: candidateHandoff,
    runState: JSON.parse(runState),
  };
}

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

test("analyze emits a sanitized actionable handoff for Purview-like evidence", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-purview-handoff-"));
  const tenantId = "2f1c7bb8-2d31-4c2a-9f86-6778c9382bbc";
  const basePath = `/apiproxy/insiderrisk/insiderrisk/api/v1.0/${tenantId}`;

  try {
    await Promise.all([
      writeJson(path.join(artifactDir, "api-records.json"), [
        {
          method: "GET",
          path: `${basePath}/NodocReviewCandidate`,
          seenOnPages: ["tenant-specific-review-page"],
        },
        {
          method: "POST",
          path: `${basePath}/NodocSafetyCandidate`,
          seenOnPages: ["tenant-specific-safety-page"],
        },
        {
          method: "POST",
          path: `${basePath}/IRMEasyPolicy`,
          seenOnPages: ["tenant-specific-suppressed-page"],
        },
      ]),
      writeJson(path.join(artifactDir, "probe-results.json"), [
        {
          method: "GET",
          outcome: "confirmed",
          path: `${basePath}/NodocProbeCandidate`,
          status: 200,
        },
      ]),
      writeJson(path.join(artifactDir, "bundle-candidates.json"), {
        candidates: [
          {
            candidatePath: `${basePath}/NodocBundleCandidate`,
            method: "GET",
            sourceFile: "C:\\tenant-specific\\private-bundle.js",
          },
        ],
      }),
    ]);

    const { candidateHandoff, candidateHandoffText, runState } = await runAnalyze(
      "purview",
      artifactDir,
    );

    assert.deepEqual(candidateHandoff.counts, {
      confirmedRead: 1,
      confirmedSafetyReview: 1,
      successfullyProbed: 1,
      bundleOnly: 1,
      suppressed: 1,
    });
    assert.equal(
      candidateHandoff.confirmedReadCandidates[0].normalizedPath,
      "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{id}/NodocReviewCandidate",
    );
    assert.equal(candidateHandoff.confirmedSafetyReviewCandidates[0].method, "POST");
    assert.equal(candidateHandoff.successfullyProbedCandidates[0].evidence, "probed");
    assert.equal(
      candidateHandoff.bundleOnlyCandidates[0].evidence,
      "bundle-discovered",
    );
    assert.equal(
      candidateHandoff.suppressedCandidates[0].normalizedPath,
      "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{id}/IRMEasyPolicy",
    );
    assert.equal(
      candidateHandoff.recommendedNextAction.code,
      "review-and-promote-confirmed-candidates",
    );
    assert.deepEqual(runState.candidateCounts, candidateHandoff.counts);
    assert.deepEqual(
      runState.recommendedNextAction,
      candidateHandoff.recommendedNextAction,
    );
    assert.equal(path.basename(runState.outputs.candidateHandoff), "candidate-handoff.json");
    assert.doesNotMatch(candidateHandoffText, new RegExp(tenantId, "u"));
    assert.doesNotMatch(candidateHandoffText, /tenant-specific/u);
    assert.doesNotMatch(candidateHandoffText, /private-bundle/u);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("bundle-only analysis recommends targeted UI validation", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-bundle-handoff-"));

  try {
    await writeJson(path.join(artifactDir, "bundle-candidates.json"), {
      candidates: [
        {
          candidatePath: "/admin/api/nodocBundleOnlyCandidate",
          method: "GET",
          sourceFile: "feature.js",
        },
      ],
    });

    const { candidateHandoff } = await runAnalyze("m365-admin", artifactDir);

    assert.equal(candidateHandoff.counts.bundleOnly, 1);
    assert.equal(candidateHandoff.counts.confirmedRead, 0);
    assert.equal(
      candidateHandoff.recommendedNextAction.code,
      "validate-bundle-only-candidates",
    );
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("suppressed-only analysis expands coverage instead of repeating the completed diff", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-suppressed-handoff-"));

  try {
    await writeJson(path.join(artifactDir, "api-records.json"), [
      {
        method: "POST",
        path: "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{placeholder}/IRMEasyPolicy",
      },
    ]);

    const { candidateHandoff, candidateHandoffText } = await runAnalyze(
      "purview",
      artifactDir,
    );

    assert.deepEqual(candidateHandoff.counts, {
      confirmedRead: 0,
      confirmedSafetyReview: 0,
      successfullyProbed: 0,
      bundleOnly: 0,
      suppressed: 1,
    });
    assert.equal(
      candidateHandoff.recommendedNextAction.code,
      "expand-recipe-coverage",
    );
    assert.doesNotMatch(candidateHandoffText, /normalized-family-diff/u);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("no-candidate analysis uses an appropriate portal metadata fallback", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-metadata-fallback-"));

  try {
    await writeJson(path.join(artifactDir, "api-records.json"), []);

    const { candidateHandoff } = await runAnalyze("entra-b2c", artifactDir);

    assert.equal(candidateHandoff.counts.confirmedRead, 0);
    assert.deepEqual(candidateHandoff.recommendedNextAction, {
      code: "follow-portal-metadata",
      metadataNextPass: "full-layered-crawl",
      summary:
        "No actionable candidates were generated; follow the portal metadata next pass: full-layered-crawl.",
    });
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
  assert.equal(result.brief.metadataNextPass, "normalized-family-diff");
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
