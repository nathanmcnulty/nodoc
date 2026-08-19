import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNoveltyPlan,
  deriveNoveltyBaseline,
  evaluateNoveltyEvidence,
} from "../portal-discovery-novelty.mjs";

const recipe = {
  url: "https://entra.microsoft.com",
  actions: [
    "click-label-root=Enterprise applications",
    "wait-ms=6000",
    "capture=enterprise-applications",
  ],
  noveltyFrontier: {
    baseline: "checked-in-spec-and-coverage-ledgers",
    baselineSignals: {
      queryMetadata: [],
      requestShapes: [],
      responseShapes: [],
      routes: [],
    },
    targets: [{
      acceptanceKey: "response-shape:/ApplicationInsights/EnterpriseAppSignIns",
      actionIndexes: [0, 1, 2],
      evidenceLevel: "confirmed",
      expectedHostFamilies: ["main.iam.ad.ext.azure.com"],
      expectedInformationClasses: ["response-shape", "query-metadata"],
      expectedRoutePrefixes: ["/ApplicationInsights"],
      id: "enterprise-app-sign-in-shape",
      rationale: "The checked-in successful response schema is opaque.",
      safeAction: "Open the read-only enterprise applications list and capture its normal GET traffic.",
      state: "Enterprise applications list and sign-in summary",
    }],
  },
};

test("OpenAPI baseline derives host-aware routes, query keys, and weak schema gaps", () => {
  const baseline = deriveNoveltyBaseline({
    servers: [{ url: "https://api.example.test" }],
    paths: {
      "/items": {
        get: {
          parameters: [{ in: "query", name: "top" }],
          responses: {
            200: { content: { "application/json": { schema: { type: "object", properties: { value: { type: "array", items: { type: "string" } } } } } } },
          },
        },
      },
      "/items/{itemId}": {
        get: {
          responses: { 200: { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } },
        },
      },
    },
  });
  assert.equal(baseline.operations.length, 2);
  assert.deepEqual(baseline.operations[0].hosts, ["api.example.test"]);
  assert.deepEqual(baseline.operations[0].queryParameterNames, ["top"]);
  assert.equal(baseline.operations[0].responseSchemaDocumented, true);
  assert.equal(baseline.operations[1].responseSchemaDocumented, false);
});

const emptyDerivedBaseline = { source: "checked-in-openapi", operations: [] };

function planFor(value, operations = []) {
  return buildNoveltyPlan(value, {
    required: true,
    derivedBaseline: { source: "checked-in-openapi", operations },
  });
}

function assess(input, operations = []) {
  return evaluateNoveltyEvidence({
    ...input,
    noveltyPlan: planFor(input.recipe, operations),
  });
}

test("novelty plans classify exact frontier actions and mandatory orchestration", () => {
  const plan = planFor(recipe);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.measurements.frontierTargetedActionCount, 3);
  assert.equal(plan.measurements.mandatoryOrchestrationActionCount, 1);
  assert.deepEqual(
    plan.actions.map(({ classification }) => classification),
    ["mandatory-orchestration", "frontier-targeted", "frontier-targeted", "frontier-targeted"],
  );
});

test("required novelty fails closed without targets or safe action linkage", () => {
  assert.throws(
    () => buildNoveltyPlan(recipe, { required: true }),
    /derive its baseline/,
  );
  assert.throws(
    () => buildNoveltyPlan({ actions: [] }, { required: true, derivedBaseline: emptyDerivedBaseline }),
    (error) => error.code === "novelty-frontier-invalid" && /does not declare/.test(error.message),
  );
  assert.throws(
    () => buildNoveltyPlan({
      ...recipe,
      noveltyFrontier: {
        ...recipe.noveltyFrontier,
        targets: [{ ...recipe.noveltyFrontier.targets[0], actionIndexes: [1, 2] }],
      },
    }, { required: true, derivedBaseline: emptyDerivedBaseline }),
    /safe interactive action/,
  );
});

test("post-run assessment distinguishes productive targeted shapes from no novelty", () => {
  const actionResults = [
    { page: "seed", type: "navigate", value: "https://entra.microsoft.com" },
    { page: "click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Enterprise applications" },
    { page: "wait", type: "wait-ms", value: "6000" },
    { page: "capture", type: "capture", value: "enterprise-applications" },
  ];
  const candidateHandoff = { counts: {}, confirmedReadCandidates: [] };
  const productive = assess({
    recipe,
    actionResults,
    candidateHandoff,
    apiRecords: [{
      path: "/ApplicationInsights/EnterpriseAppSignIns",
      queryParameterNames: ["top"],
      responseShapeFingerprint: "shape-a",
      seenOnPages: ["capture"],
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/EnterpriseAppSignIns?top=20",
    }],
  });
  assert.equal(productive.status, "productive");
  assert.equal(productive.measurements.targetedShapeAndMetadataSignalCount, 2);

  const documentedOnly = assess({
    recipe: {
      ...recipe,
      noveltyFrontier: {
        ...recipe.noveltyFrontier,
        targets: [{
          ...recipe.noveltyFrontier.targets[0],
          expectedInformationClasses: ["new-route-family"],
        }],
      },
    },
    actionResults,
    candidateHandoff: {
      confirmedReadCandidates: [{
        baseUrls: ["https://main.iam.ad.ext.azure.com"],
        documentationStatus: "documented",
        method: "GET",
        normalizedPath: "/ApplicationInsights/Known",
      }],
    },
  });
  assert.equal(documentedOnly.status, "no-novelty");

  const alreadyKnownShape = assess({
    recipe: {
      ...recipe,
      noveltyFrontier: {
        ...recipe.noveltyFrontier,
        baselineSignals: {
          ...recipe.noveltyFrontier.baselineSignals,
          queryMetadata: ["main.iam.ad.ext.azure.com GET /ApplicationInsights/EnterpriseAppSignIns top"],
          responseShapes: ["main.iam.ad.ext.azure.com GET /ApplicationInsights/EnterpriseAppSignIns shape-a"],
        },
      },
    },
    actionResults,
    candidateHandoff,
    apiRecords: [{
      path: "/ApplicationInsights/EnterpriseAppSignIns",
      queryParameterNames: ["top"],
      responseShapeFingerprint: "shape-a",
      seenOnPages: ["capture"],
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/EnterpriseAppSignIns?top=20",
    }],
  });
  assert.equal(alreadyKnownShape.status, "no-novelty");

  const empty = assess({ recipe, actionResults, candidateHandoff, apiRecords: [] });
  assert.equal(empty.status, "no-novelty");
  assert.equal(empty.measurements.attemptedTargetCount, 1);
});

test("dynamic crawl result rows do not break exact recipe action accounting", () => {
  const crawlRecipe = {
    actions: ["navigate=https://example.test/start", "crawl-links=detail", "capture=detail"],
    noveltyFrontier: {
      baseline: "checked-in-spec-and-coverage-ledgers",
      baselineSignals: { queryMetadata: [], requestShapes: [], responseShapes: [], routes: [] },
      targets: [{
        acceptanceKey: "detail-shape",
        actionIndexes: [0, 1, 2],
        evidenceLevel: "hypothesis",
        expectedHostFamilies: ["api.example.test"],
        expectedInformationClasses: ["response-shape"],
        expectedRoutePrefixes: ["/detail"],
        id: "detail-shape",
        rationale: "Exercise dynamic accounting.",
        safeAction: "Navigate through read-only detail links.",
        state: "Detail state",
      }],
    },
  };
  const assessment = assess({
    recipe: crawlRecipe,
    actionResults: [
      { page: "seed", type: "navigate", value: "https://example.test" },
      { page: "start", result: { resolvedUrl: "https://example.test/start", url: "https://example.test/start" }, type: "navigate", value: "https://example.test/start" },
      { page: "detail-1", type: "crawl-links", value: "https://example.test/detail/1" },
      { page: "crawl", result: { replayedCount: 1 }, type: "crawl-links", value: "detail" },
      { page: "capture", type: "capture", value: "detail" },
    ],
    apiRecords: [{
      method: "GET",
      path: "/detail/1",
      responseShapeFingerprint: "shape-detail",
      seenOnPages: ["detail-1"],
      url: "https://api.example.test/detail/1",
    }],
    candidateHandoff: {},
  });
  assert.equal(assessment.status, "productive");
  assert.equal(assessment.measurements.attemptedTargetCount, 1);
});

test("checked-in documented schemas and failed actions cannot become novelty", () => {
  const actionResults = [
    { page: "seed", type: "navigate", value: "https://entra.microsoft.com" },
    { page: "click", result: { clicked: false }, type: "click-label", value: "Enterprise applications" },
    { page: "wait", type: "wait-ms", value: "6000" },
    { page: "capture", type: "capture", value: "enterprise-applications" },
  ];
  const operations = [{
    hosts: ["main.iam.ad.ext.azure.com"],
    method: "GET",
    path: "/ApplicationInsights/EnterpriseAppSignIns",
    queryParameterNames: ["top"],
    requestSchemaDocumented: true,
    responseContentTypes: ["application/json"],
    responseSchemaDocumented: true,
    responseStatuses: ["200"],
  }];
  const assessment = assess({
    recipe,
    actionResults,
    candidateHandoff: {},
    apiRecords: [{
      method: "GET",
      mimeType: "application/json",
      path: "/ApplicationInsights/EnterpriseAppSignIns",
      queryParameterNames: ["top"],
      responseShapeFingerprint: "known-shape",
      seenOnPages: ["capture"],
      status: 200,
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/EnterpriseAppSignIns?top=20",
    }],
  }, operations);
  assert.equal(assessment.status, "frontier-incomplete");
  assert.equal(assessment.measurements.attemptedTargetCount, 0);
  assert.equal(assessment.measurements.targetedShapeAndMetadataSignalCount, 0);

  const clickedWithoutTransition = assess({
    recipe,
    actionResults: actionResults.map((result) => result.type === "click-label"
      ? { ...result, result: { clicked: true, transitionEvidence: { stateChanged: false, targetChanged: false, urlChanged: false } } }
      : result),
    candidateHandoff: {},
    apiRecords: [],
  }, operations);
  assert.equal(clickedWithoutTransition.status, "frontier-incomplete");
  assert.equal(clickedWithoutTransition.measurements.attemptedTargetCount, 0);
});

test("route prefixes are segment bounded and evidence is action-page attributed", () => {
  const assessment = assess({
    recipe,
    actionResults: [
      { page: "seed", type: "navigate", value: "https://entra.microsoft.com" },
      { page: "click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Enterprise applications" },
      { page: "wait", type: "wait-ms", value: "6000" },
      { page: "capture", type: "capture", value: "enterprise-applications" },
    ],
    candidateHandoff: {},
    apiRecords: [{
      method: "GET",
      path: "/ApplicationInsightsExtra",
      responseShapeFingerprint: "wrong-prefix",
      seenOnPages: ["capture"],
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsightsExtra",
    }, {
      method: "GET",
      path: "/ApplicationInsights/OtherState",
      responseShapeFingerprint: "wrong-page",
      seenOnPages: ["unrelated-page"],
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/OtherState",
    }],
  });
  assert.equal(assessment.status, "no-novelty");
});
