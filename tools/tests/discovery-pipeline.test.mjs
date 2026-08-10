import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  getEffectiveServerUrls,
  getScopeServerUrls,
} from "../spec-quality-lib.mjs";
import { claimAssignment, enqueueAssignment } from "../portal-discovery-ledger.mjs";
import { prepareLedgerAttempt } from "../portal-discovery-dispatch.mjs";
import {
  buildPartitionedCandidateHandoff,
  validatePartitionedCandidateHandoff,
} from "../discovery-candidate-handoff.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("partitioned handoff preserves identities, isolates adjacent evidence, and is deterministic", () => {
  const handoff = {
    schemaVersion: 2,
    spec: { id: "alpha", title: "Alpha" },
    interactionHealth: null,
    interactionHealthStatus: { available: false, reason: "canonical-health-unavailable" },
    saturation: null,
    recovery: { captureStatus: "interrupted" },
    recommendedNextAction: { code: "complete-or-retry-capture" },
    confirmedReadCandidates: [{ method: "GET", normalizedPath: "/v1/items", evidence: "confirmed", documentationStatus: "undocumented", baseUrls: ["https://alpha.example"], provenance: ["network"], reasons: ["confirmed"] }],
    confirmedSafetyReviewCandidates: [{ method: "POST", normalizedPath: "/v1/items", evidence: "confirmed", documentationStatus: "undocumented", baseUrls: ["https://alpha.example"], provenance: ["network"], reasons: ["write"] }],
    successfullyProbedCandidates: [],
    bundleOnlyCandidates: [{ method: "GET", normalizedPath: "/graphql", evidence: "bundle-discovered", documentationStatus: "undocumented", baseUrls: ["https://alpha.example"], provenance: ["bundle"], reasons: ["operation"], operation: { name: "Items", operationType: "query" } }],
    suppressedCandidates: [],
    adjacentConfirmedReadCandidates: [{ method: "GET", normalizedPath: "/v1/other", evidence: "confirmed", documentationStatus: "undocumented", hostFamily: "other.example", matchingSpecIds: ["beta"], requiresSpecAssignment: true, scopeReasons: ["host-out-of-scope"], baseUrls: ["https://other.example"], provenance: ["network"], reasons: ["adjacent"] }],
    adjacentConfirmedSafetyReviewCandidates: [],
    adjacentSuccessfullyProbedCandidates: [],
    adjacentBundleOnlyCandidates: [],
  };
  const first = buildPartitionedCandidateHandoff(handoff);
  const second = buildPartitionedCandidateHandoff(handoff);
  assert.deepEqual(first, second);
  assert.equal(first.manifest.totals.candidateCount, 4);
  assert.equal(first.manifest.totals.evidenceFamilyCount, 4);
  assert.ok(first.partitions.some(({ reviewClass, destination }) => reviewClass === "adjacent-confirmed-read" && destination.specId === "unassigned"));
  assert.throws(() => validatePartitionedCandidateHandoff(handoff, { partitions: first.partitions.slice(1) }), /duplicated or dropped/);
  assert.match(JSON.stringify(first), /Items/);
});

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runAnalyze(portal, artifactDir, {
  summary = true,
  ledgerPath,
  assignmentId,
  endpoint,
  noLedger = false,
  seedPageStates = false,
} = {}) {
  if (summary) {
    await writeJson(path.join(artifactDir, "summary.json"), { portal });
  }
  if (seedPageStates) {
    await writeJson(path.join(artifactDir, "page-states.json"), []);
  }
  const argumentsList = [
    path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
    "--portal",
    portal,
    "--phase",
    "analyze",
    "--artifacts",
    artifactDir,
  ];
  if (ledgerPath) argumentsList.push("--ledger-path", ledgerPath);
  if (assignmentId) argumentsList.push("--assignment-id", assignmentId);
  if (endpoint) argumentsList.push("--endpoint", endpoint);
  if (noLedger) argumentsList.push("--no-ledger");
  await execFileAsync(process.execPath, argumentsList, { cwd: repoRoot });

  const [candidateHandoff, candidateQueue, runState] = await Promise.all([
    readFile(path.join(artifactDir, "candidate-handoff.json"), "utf8"),
    readFile(path.join(artifactDir, "candidate-queue.json"), "utf8"),
    readFile(path.join(artifactDir, "discovery-run.json"), "utf8"),
  ]);
  return {
    candidateHandoff: JSON.parse(candidateHandoff),
    candidateHandoffText: candidateHandoff,
    candidateQueue: JSON.parse(candidateQueue),
    runState: JSON.parse(runState),
  };
}

async function runM365AllLeaseCase({
  assignmentEndpoint = "config.office.com:443",
  invocationEndpoint = "https://config.office.com",
  assignmentProfile = "bounded",
  invocationProfile = "bounded",
  assignmentWorker = "m365-apps-services-live-gpt56-luna",
  invocationWorker = assignmentWorker,
  claimNow = new Date(Date.now() - 1_000).toISOString(),
  leaseMs,
} = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-m365-lease-"));
  const ledgerPath = path.join(rootDir, "ledger.jsonl");
  const artifactDir = path.join(rootDir, "artifacts");
  const assignmentId = "m365-apps-services-92bc1d847c8537ac";
  try {
    await enqueueAssignment({
      ledgerPath,
      assignmentId,
      specId: "m365-apps-services",
      portal: "M365 Apps Services",
      recipePath: path.join(repoRoot, "tools", "capture-recipes", "m365-apps-services-deep.json"),
      recipeDigest: "a".repeat(64),
      endpoint: assignmentEndpoint,
      profile: assignmentProfile,
      phase: "all",
      workerId: assignmentWorker,
    });
    await claimAssignment({
      ledgerPath,
      assignmentId,
      endpoint: assignmentEndpoint,
      profile: assignmentProfile,
      workerId: assignmentWorker,
      now: claimNow,
      leaseMs,
    });

    let error;
    let assignment;
    try {
      assignment = await prepareLedgerAttempt(
        {
          noLedger: false,
          phase: "all",
          endpoint: invocationEndpoint,
          ledgerPath,
          assignmentId,
          profile: invocationProfile,
          workerId: invocationWorker,
          model: null,
          reasoning: null,
          priority: "normal",
          artifacts: artifactDir,
          captureSupervisionTimeoutMs: 1000,
          supervisionTimeoutMs: 1000,
        },
        { specId: "m365-apps-services", title: "M365 Apps Services" },
        path.join(repoRoot, "tools", "capture-recipes", "m365-apps-services-deep.json"),
      );
    } catch (caught) {
      error = caught;
    }
    return { assignment, error };
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

test("capture pipeline auto-enqueues and claims a deterministic ledger attempt", async (t) => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-ledger-auto-"));
  const ledgerPath = path.join(artifactDir, "ledger.jsonl");
  const analysisDir = path.join(artifactDir, "analysis");
  await mkdir(analysisDir);
  try {
    const { runState } = await runAnalyze("m365-admin", analysisDir, {
      ledgerPath,
      endpoint: "https://admin.cloud.microsoft",
      seedPageStates: true,
    });
    const ledger = JSON.parse((await readFile(ledgerPath, "utf8")).trim().split("\n").at(-1));
    assert.equal(runState.ledger.attemptNumber, 1);
    assert.equal(ledger.eventType, "attempt-updated");
    assert.equal(ledger.payload.status, "completed");
    assert.equal(ledger.payload.lease, null);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("M365 Apps Services reuses an owned canonical lease before browser preflight", async () => {
  const cases = [
    {
      name: "URL",
      invocationEndpoint: "https://config.office.com",
      expectedError: false,
    },
    {
      name: "host",
      invocationEndpoint: "config.office.com",
      expectedError: false,
    },
    {
      name: "default port",
      invocationEndpoint: "config.office.com:443",
      expectedError: false,
    },
    {
      name: "different host",
      invocationEndpoint: "https://other.office.com",
      expectedError: true,
    },
    {
      name: "non-default port",
      invocationEndpoint: "config.office.com:8443",
      expectedError: true,
    },
    {
      name: "different profile",
      assignmentProfile: "other",
      expectedError: true,
    },
    {
      name: "different worker",
      invocationWorker: "different-worker",
      expectedError: true,
    },
    {
      name: "expired lease",
      claimNow: new Date(Date.now() - 10 * 60_000).toISOString(),
      leaseMs: 100,
      expectedError: true,
    },
    {
      name: "ambiguous URL",
      invocationEndpoint: "https://config.office.com/intents",
      expectedError: true,
    },
  ];

  for (const leaseCase of cases) {
    const result = await runM365AllLeaseCase(leaseCase);
    assert.equal(Boolean(result.error), leaseCase.expectedError, leaseCase.name);
    if (!leaseCase.expectedError) {
      assert.equal(result.assignment.endpoint, "config.office.com:443", leaseCase.name);
      assert.equal(result.assignment.latestAttempt.attemptNumber, 1, leaseCase.name);
    }
  }
});

test("legacy analysis remains explicitly opt-out from ledger dispatch", async (t) => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-ledger-legacy-"));
  try {
    const { runState } = await runAnalyze("m365-admin", artifactDir, {
      noLedger: true,
      seedPageStates: true,
    });

    test("precreated assignment is claimed without duplicate enqueue", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-ledger-precreated-"));
      const ledgerPath = path.join(artifactDir, "ledger.jsonl");
      const analysisDir = path.join(artifactDir, "analysis");
      await mkdir(analysisDir);
      const assignmentId = "precreated-m365-admin";
      try {
        await enqueueAssignment({
          ledgerPath,
          assignmentId,
          specId: "m365-admin",
          portal: "M365 Admin",
          recipePath: path.join(repoRoot, "tools", "capture-recipes", "m365-admin-deep.json"),
          recipeDigest: "a".repeat(64),
          endpoint: "https://admin.cloud.microsoft",
          profile: "bounded",
          phase: "analyze",
          artifactDir: analysisDir,
        });
        const { runState } = await runAnalyze("m365-admin", analysisDir, {
          ledgerPath,
          assignmentId,
          endpoint: "https://admin.cloud.microsoft",
          seedPageStates: true,
        });
        const records = (await readFile(ledgerPath, "utf8")).trim().split("\n");
        assert.equal(records.filter((line) => line.includes('"eventType":"assignment-created"')).length, 1);
        assert.equal(runState.ledger.assignmentId, assignmentId);
        assert.equal(runState.ledger.attemptNumber, 1);
      } finally {
        await rm(artifactDir, { force: true, recursive: true });
      }
    });
    assert.deepEqual(runState.ledger, { mode: "legacy-no-ledger" });
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("effective server scope honors operation, path, and root precedence", () => {
  const rootServers = [{ url: "https://root.example.test" }];
  const pathServers = [{ url: "https://path.example.test" }];
  const operationServers = [{
    url: "https://{organizationHost}.crm.dynamics.com",
  }];
  const specification = {
    servers: rootServers,
    paths: {
      "/operation": {
        get: {
          servers: operationServers,
        },
      },
      "/path": {
        servers: pathServers,
        get: {},
      },
      "/root": {
        get: {},
      },
    },
  };

  assert.deepEqual(
    getEffectiveServerUrls(
      specification,
      specification.paths["/operation"],
      specification.paths["/operation"].get,
    ),
    ["https://{organizationHost}.crm.dynamics.com"],
  );
  assert.deepEqual(
    getEffectiveServerUrls(
      specification,
      specification.paths["/path"],
      specification.paths["/path"].get,
    ),
    ["https://path.example.test"],
  );
  assert.deepEqual(
    getEffectiveServerUrls(
      specification,
      specification.paths["/root"],
      specification.paths["/root"].get,
    ),
    ["https://root.example.test"],
  );
  assert.deepEqual(getScopeServerUrls(specification), [
    "https://root.example.test",
    "https://{organizationHost}.crm.dynamics.com",
    "https://path.example.test",
  ]);
});

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
      adjacentBundleOnly: 0,
      adjacentConfirmedRead: 0,
      adjacentConfirmedSafetyReview: 0,
      adjacentSuccessfullyProbed: 0,
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

test("adjacent known static assets are suppressed without hiding nearby Entra routes", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-static-asset-noise-"));

  try {
    await writeJson(path.join(artifactDir, "api-records.json"), [
      { method: "GET", path: "/entracopilot/Content/app.js", seenOnPages: ["home"] },
      { method: "GET", path: "/entracopilot/api/meaningful", seenOnPages: ["home"] },
    ]);
    const result = await runAnalyze("entra-idgov", artifactDir);
    assert.ok(result.candidateQueue.suppressedCandidates.some((candidate) => (
      candidate.normalizedPath === "/entracopilot/Content/app.js"
      && candidate.suppressionNote.includes("Known static portal asset")
    )));
    assert.ok(result.candidateQueue.scopeReviewCandidates.some((candidate) => (
      candidate.normalizedPath === "/entracopilot/api/meaningful"
    )));
    assert.equal(result.candidateQueue.summary.adjacentStaticAssetObservationCount, 1);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("adjacent Power Platform-like evidence is tenant-safe and never promotion-active", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-power-platform-scope-"));
  const tenantId = "5e2f94d1-730e-46f3-b567-e79c3946ab11";
  const tenantHostLabel = "private-tenant-7f91";
  const organizationHostLabel = "private-org-8c2f99d4";
  const opaqueTenantId = "NmYi_9r27n27";
  const tenantPage = "private-tenant-scope-page";
  const privateBody = "private-tenant-response-body";

  try {
    await Promise.all([
      writeJson(path.join(artifactDir, "api-records.json"), [
        {
          method: "GET",
          path: `/admin/api/nodocScopeReviewRead/${opaqueTenantId}`,
          seenOnPages: [tenantPage],
          url:
            `https://admin.cloud.microsoft/admin/api/nodocScopeReviewRead/${opaqueTenantId}`,
        },
        {
          headers: {
            authorization: "Bearer private-tenant-token",
            cookie: "private-tenant-cookie=value",
          },
          method: "POST",
          path: `/api/data/v9.2/organizations/${tenantId}/nodocScopeReviewPost`,
          responseBodySample: privateBody,
          seenOnPages: [tenantPage],
          url:
            `https://${tenantHostLabel}.api.crm.dynamics.com/api/data/v9.2/organizations/${tenantId}/nodocScopeReviewPost`,
        },
        {
          method: "GET",
          path: "/api/data/v9.0/applicationusers",
          seenOnPages: [tenantPage],
          url:
            `https://${organizationHostLabel}.crm.dynamics.com/api/data/v9.0/applicationusers`,
        },
        {
          method: "GET",
          path: "/outside/nodocDynamicsScopeReview",
          seenOnPages: [tenantPage],
          url:
            `https://${organizationHostLabel}.crm.dynamics.com/outside/nodocDynamicsScopeReview`,
        },
        {
          method: "GET",
          path: "/api/v1/oauth2/aad_access_token",
          seenOnPages: [tenantPage],
          url: "https://api.engage.cloud.microsoft/api/v1/oauth2/aad_access_token",
        },
      ]),
      writeJson(path.join(artifactDir, "probe-results.json"), [
        {
          method: "GET",
          outcome: "confirmed",
          path: "/_api/web/lists",
          status: 200,
          url: `https://${tenantHostLabel}-admin.sharepoint.com/_api/web/lists`,
        },
      ]),
      writeJson(path.join(artifactDir, "bundle-candidates.json"), {
        candidates: [
          {
            candidatePath: "/api/nodocTargetBundleCandidate",
            method: "GET",
            sourceFile: "tenant-neutral-target.js",
          },
          {
            candidatePath:
              "https://admin.cloud.microsoft/api/nodocAdjacentBundleCandidate",
            method: "GET",
            sourceFile: "tenant-neutral-adjacent.js",
          },
        ],
      }),
    ]);

    const {
      candidateHandoff,
      candidateHandoffText,
      candidateQueue,
      runState,
    } = await runAnalyze("power-platform", artifactDir);

    assert.deepEqual(candidateHandoff.counts, {
      adjacentBundleOnly: 1,
      adjacentConfirmedRead: 3,
      adjacentConfirmedSafetyReview: 1,
      adjacentSuccessfullyProbed: 1,
      confirmedRead: 0,
      confirmedSafetyReview: 0,
      successfullyProbed: 0,
      bundleOnly: 1,
      suppressed: 0,
    });
    assert.deepEqual(candidateQueue.summary.scopeReviewCounts, {
      bundleOnly: 1,
      confirmedRead: 3,
      confirmedSafetyReview: 1,
      successfullyProbed: 1,
    });
    assert.equal(candidateQueue.summary.adjacentCandidatesPromoted, false);
    assert.equal(
      candidateHandoff.recommendedNextAction.code,
      "review-adjacent-candidate-scope",
    );
    const adminScopeReview =
      candidateHandoff.adjacentConfirmedReadCandidates.find(
        ({ normalizedPath }) => (
          normalizedPath === "/admin/api/nodocScopeReviewRead/{id}"
        ),
      );
    assert.equal(adminScopeReview?.hostFamily, "admin.cloud.microsoft");
    assert.deepEqual(
      adminScopeReview?.matchingSpecIds,
      ["m365-admin"],
    );
    const dynamicsScopeReview =
      candidateHandoff.adjacentConfirmedReadCandidates.find(
        ({ normalizedPath }) => normalizedPath === "/outside/nodocDynamicsScopeReview",
      );
    assert.equal(
      dynamicsScopeReview?.hostFamily,
      "{organizationhost}.crm.dynamics.com",
    );
    const vivaScopeReview =
      candidateHandoff.adjacentConfirmedReadCandidates.find(
        ({ normalizedPath }) => normalizedPath === "/api/v1/oauth2/aad_access_token",
      );
    assert.equal(vivaScopeReview?.hostFamily, "api.engage.cloud.microsoft");
    assert.deepEqual(vivaScopeReview?.matchingSpecIds, ["viva-engage"]);
    assert.equal(
      candidateHandoff.adjacentConfirmedSafetyReviewCandidates[0].hostFamily,
      "{tenant}.api.crm.dynamics.com",
    );
    assert.equal(
      candidateHandoff.adjacentSuccessfullyProbedCandidates[0].hostFamily,
      "{tenant}-admin.sharepoint.com",
    );
    assert.ok([
      ...candidateHandoff.adjacentConfirmedReadCandidates,
      ...candidateHandoff.adjacentConfirmedSafetyReviewCandidates,
      ...candidateHandoff.adjacentSuccessfullyProbedCandidates,
      ...candidateHandoff.adjacentBundleOnlyCandidates,
    ].every(({ requiresSpecAssignment }) => requiresSpecAssignment));
    assert.deepEqual(
      candidateQueue.candidates.map(({ normalizedPath }) => normalizedPath),
      ["/api/nodocTargetBundleCandidate"],
    );
    assert.deepEqual(runState.candidateCounts, candidateHandoff.counts);
    const scopeReviewText = JSON.stringify(candidateQueue.scopeReviewCandidates);

    for (const forbidden of [
      tenantId,
      tenantHostLabel,
      organizationHostLabel,
      opaqueTenantId,
      tenantPage,
      privateBody,
      "private-tenant-token",
      "private-tenant-cookie",
      artifactDir,
      "https://",
      "seenOnPages",
      "responseBodySample",
    ]) {
      assert.equal(candidateHandoffText.includes(forbidden), false);
      assert.equal(scopeReviewText.includes(forbidden), false);
    }

    const { stdout: documentedStdout } = await execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
      "--spec",
      "power-platform",
      "--artifacts",
      artifactDir,
      "--include-documented",
      "--json",
    ], { cwd: repoRoot });
    const documentedQueue = JSON.parse(documentedStdout);
    const dynamicsDocumented = documentedQueue.candidates.find(
      ({ method, normalizedPath }) => (
        method === "GET"
        && normalizedPath === "/api/data/v9.0/applicationusers"
      ),
    );
    assert.equal(dynamicsDocumented?.documentationStatus, "documented");
    assert.equal(
      documentedQueue.scopeReviewCandidates.some(
        ({ normalizedPath }) => normalizedPath === "/api/data/v9.0/applicationusers",
      ),
      false,
    );

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
      "--spec",
      "power-platform",
      "--artifacts",
      artifactDir,
      "--include-adjacent",
      "--json",
    ], { cwd: repoRoot });
    const compatibilityQueue = JSON.parse(stdout);
    assert.equal(compatibilityQueue.summary.includeAdjacentRequested, true);
    assert.equal(compatibilityQueue.summary.adjacentCandidatesPromoted, false);
    assert.deepEqual(compatibilityQueue.candidates, candidateQueue.candidates);
    assert.deepEqual(
      compatibilityQueue.scopeReviewCandidates,
      candidateQueue.scopeReviewCandidates,
    );
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

    assert.ok(candidateHandoff.counts.bundleOnly >= 0);
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
      adjacentBundleOnly: 0,
      adjacentConfirmedRead: 0,
      adjacentConfirmedSafetyReview: 0,
      adjacentSuccessfullyProbed: 0,
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

test("interrupted Teams-shaped recovery stays incomplete while preserving candidates", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-teams-interrupted-recovery-"));

      try {
        await Promise.all([
          writeJson(path.join(artifactDir, "api-records.json"), [{
            method: "GET",
            path: "/teams/api/candidate",
          }]),
          writeJson(path.join(artifactDir, "bundle-candidates.json"), {
            candidates: [{ candidatePath: "/teams/api/bundle-candidate", method: "GET" }],
          }),
        ]);

        const { candidateHandoff, runState } = await runAnalyze("m365-admin", artifactDir, { summary: false });
        assert.equal(runState.status, "completed");
        assert.equal(runState.capture.captureStatus, "interrupted");
        assert.equal(runState.capture.captureComplete, false);
        assert.equal(runState.interactionHealth, null);
        assert.deepEqual(runState.interactionHealthStatus, {
          available: false,
          reason: "summary-missing",
          source: "artifact-directory",
        });
        assert.equal(runState.recovery.status, "recovered-analysis");
        assert.ok(candidateHandoff.counts.bundleOnly >= 0);
        assert.equal(candidateHandoff.recommendedNextAction.code, "complete-or-retry-capture");
      } finally {
        await rm(artifactDir, { force: true, recursive: true });
      }
    });

test("complete capture analysis is marked as recovered without changing promotion guidance", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-complete-recovery-"));

      try {
        await Promise.all([
          writeJson(path.join(artifactDir, "summary.json"), { portal: "M365 Admin" }),
          writeJson(path.join(artifactDir, "api-records.json"), [{
            method: "GET",
            path: "/admin/api/confirmed",
          }]),
        ]);

        const { candidateHandoff, runState } = await runAnalyze("m365-admin", artifactDir);
        assert.equal(runState.capture.captureStatus, "complete");
        assert.equal(runState.capture.captureComplete, true);
        assert.equal(runState.recovery.status, "recovered-analysis");
        assert.equal(runState.interactionHealthStatus.available, false);
        assert.equal(candidateHandoff.recommendedNextAction.code, "review-and-promote-confirmed-candidates");
      } finally {
        await rm(artifactDir, { force: true, recursive: true });
      }
    });

test("missing and corrupt minimum artifacts are explicit recovery blockers", async () => {
      for (const [name, setup, expectedStatus, expectedReason] of [
        ["missing", async () => {}, "missing-minimum-artifacts", "summary-missing-and-no-capture-artifacts"],
        ["corrupt", async (dir) => Promise.all([
          writeFile(path.join(dir, "summary.json"), "{", "utf8"),
          writeJson(path.join(dir, "api-records.json"), []),
        ]), "corrupted-minimum-artifacts", "summary-invalid-json"],
      ]) {
        const artifactDir = await mkdtemp(path.join(os.tmpdir(), `nodoc-${name}-minimum-`));
        try {
          await setup(artifactDir);
          const { runState, candidateHandoff } = await runAnalyze("teams", artifactDir, { summary: false });
          assert.equal(runState.capture.captureStatus, expectedStatus);
          assert.equal(runState.capture.reason, expectedReason);
          assert.equal(candidateHandoff.recommendedNextAction.code, "repair-minimum-artifacts-and-retry-capture");
        } finally {
          await rm(artifactDir, { force: true, recursive: true });
        }
      }
});

test("Entra PIM UI and telemetry bundle false positives are suppressed", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-entra-pim-suppressions-"));
  const falsePositivePaths = [
    "/api/SearchData/LogSearchTerm",
    "/api/make-reset-styles",
    "/api/shorthands",
  ];

  try {
    await writeJson(path.join(artifactDir, "bundle-candidates.json"), {
      candidates: falsePositivePaths.map((candidatePath) => ({
        candidatePath,
        method: null,
        sourceFile: "tenant-neutral-ui-bundle.js",
      })),
    });

    const { candidateHandoff, candidateQueue } = await runAnalyze("entra-pim", artifactDir);
    assert.equal(candidateHandoff.counts.bundleOnly, 0);
    assert.equal(candidateHandoff.counts.suppressed, falsePositivePaths.length);
    assert.deepEqual(
      candidateHandoff.suppressedCandidates
        .map(({ normalizedPath }) => normalizedPath)
        .sort(),
      [...falsePositivePaths].sort(),
    );
    assert.deepEqual(candidateQueue.candidates, []);
    assert.equal(candidateQueue.suppressedCandidates.length, falsePositivePaths.length);
  } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("analyze carries canonical interaction health into handoff and run state", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-interaction-health-handoff-"));

  try {
    await Promise.all([
      writeJson(path.join(artifactDir, "api-records.json"), []),
      writeJson(path.join(artifactDir, "summary.json"), {}),
      writeJson(path.join(artifactDir, "action-results.json"), [{
        result: {
          clicked: false,
          eligibility: {
            candidateCount: 0,
            status: "absent-not-applicable",
          },
        },
        type: "click-label",
        value: "Feature gated",
      }]),
    ]);

    const { candidateHandoff, runState } = await runAnalyze("entra-b2c", artifactDir);
    assert.equal(candidateHandoff.interactionHealth.counts.attempted, 1);
    assert.equal(candidateHandoff.interactionHealth.counts.absentNotApplicable, 1);
   assert.equal(candidateHandoff.interactionHealth.recommendation.recommended, false);
   assert.deepEqual(runState.interactionHealth, candidateHandoff.interactionHealth);
 } finally {
    await rm(artifactDir, { force: true, recursive: true });
  }
});

test("analyze blocks escalated interaction health instead of reporting success", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "nodoc-interaction-health-escalation-"));

  try {
    await Promise.all([
      writeJson(path.join(artifactDir, "api-records.json"), []),
      writeJson(path.join(artifactDir, "summary.json"), {
        interactionHealth: {
          accounting: {
            consistent: true,
            inconsistency: null,
          },
          counts: {},
          recommendation: {
            recommended: true,
            code: "escalate-interaction-health",
          },
          schemaVersion: 1,
        },
      }),
    ]);

    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(repoRoot, "tools", "run-portal-discovery.mjs"),
        "--portal",
        "entra-b2c",
        "--phase",
        "analyze",
        "--artifacts",
        artifactDir,
      ], { cwd: repoRoot }),
      /interaction-health-escalation/u,
    );
    const runState = JSON.parse(
      await readFile(path.join(artifactDir, "discovery-run.json"), "utf8"),
    );
    assert.equal(runState.status, "blocked");
    assert.equal(runState.blocker.code, "interaction-health-escalation");
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
