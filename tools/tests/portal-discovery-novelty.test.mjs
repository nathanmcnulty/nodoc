import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNoveltyPlan,
  deriveNoveltyBaseline,
  evaluateNoveltyEvidence,
} from "../portal-discovery-novelty.mjs";

const recipe = {
  url: "https://entra.microsoft.com",
  frontierControlReadiness: { actionIndexes: [0], timeoutMs: 15000 },
  actions: [
    "click-label-root=Enterprise applications",
    "wait-ms=6000",
    "capture=enterprise-applications",
  ],
  noveltyFrontier: {
    approvalDigest: "a".repeat(64),
    baseline: "checked-in-spec-and-coverage-ledgers",
    baselineSignals: {
      queryMetadata: [],
      requestShapes: [],
      responseShapes: [],
      routes: [],
    },
    reopenCondition: "The enterprise applications state has a specific undocumented response shape.",
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
  assert.equal(baseline.operations[0].parameterCount, 1);
  assert.deepEqual(baseline.operations[0].parameterExamplesDocumented, []);
  assert.equal(baseline.operations[0].responseExampleDocumented, false);
  assert.equal(baseline.operations[0].errorResponseStatuses.length, 0);
  assert.equal(baseline.operations[0].responseSchemaDocumented, true);
  assert.equal(baseline.operations[1].responseSchemaDocumented, false);
});

test("novelty evidence normalizes OpenAPI server base paths before route matching", () => {
  const basePathRecipe = {
    url: "https://portal.example.test",
    actions: ["reload=bootstrap", "wait-ms=1000", "capture=bootstrap"],
    noveltyFrontier: {
      approvalDigest: "d".repeat(64),
      baseline: "checked-in-openapi",
      baselineSignals: { queryMetadata: [], requestShapes: [], responseMetadata: [], responseShapes: [], routes: [] },
      reopenCondition: "The known bootstrap GET has an opaque response schema.",
      targets: [{
        acceptanceKey: "known-response-shape",
        actionIndexes: [0, 1, 2],
        evidenceLevel: "hypothesis",
        expectedHostFamilies: ["api.example.test"],
        expectedInformationClasses: ["response-shape"],
        expectedRoutes: ["/items/{itemId}"],
        id: "known-response-shape",
        rationale: "The server URL contributes a runtime base path that is absent from the OpenAPI path key.",
        safeAction: "Reload and passively capture the known GET.",
        state: "Bootstrap",
      }],
    },
  };
  const baseline = deriveNoveltyBaseline({
    servers: [{ url: "https://api.example.test/api" }],
    paths: {
      "/items/{itemId}": {
        get: {
          responses: { 200: { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } },
        },
      },
    },
  });
  const assessment = assess({
    recipe: basePathRecipe,
    actionResults: [
      { actionIndex: 0, page: "bootstrap", result: { didLoad: true, resolvedUrl: "https://portal.example.test", url: "https://portal.example.test" }, type: "reload", value: "bootstrap" },
      { actionIndex: 1, page: "wait", type: "wait-ms", value: "1000" },
      { actionIndex: 2, page: "capture", type: "capture", value: "bootstrap" },
    ],
    apiRecords: [{
      method: "GET",
      path: "/api/items/123",
      responseBodySample: "{\"value\":\"redacted\"}",
      responseShapeFingerprint: "shape-with-base-path",
      seenOnPages: ["capture"],
      status: 200,
      url: "https://api.example.test/api/items/123",
    }],
    candidateHandoff: {},
  }, baseline.operations);
  assert.equal(assessment.status, "productive");
  assert.deepEqual(assessment.targets[0].responseShapeSignals, [
    "api.example.test GET /items/{itemId} shape-with-base-path",
  ]);
});

test("confirmed probe actions enrich documented routes even when candidate filtering omits them", () => {
  const probeRecipe = {
    url: "https://api.example.test",
    actions: [{ type: "probe-get", value: "/items/current", required: true }, "capture=known-item"],
    noveltyFrontier: {
      approvalDigest: "e".repeat(64),
      baseline: "checked-in-openapi",
      baselineSignals: { queryMetadata: [], requestShapes: [], responseMetadata: [], responseShapes: [], routes: [] },
      reopenCondition: "The known route lacks a response schema and example.",
      targets: [{
        acceptanceKey: "known-probe-response",
        actionIndexes: [0, 1],
        evidenceLevel: "probed",
        expectedHostFamilies: ["api.example.test"],
        expectedInformationClasses: ["response-shape"],
        expectedDocumentationObjectives: ["response-example"],
        expectedRoutes: ["/items/current"],
        id: "known-probe-response",
        rationale: "Capture the live response contract.",
        safeAction: "Issue one exact same-origin GET.",
        state: "Known item",
      }],
    },
  };
  const operations = deriveNoveltyBaseline({
    servers: [{ url: "https://api.example.test" }],
    paths: { "/items/current": { get: { responses: { 200: { description: "Success" } } } } },
  }).operations;
  const assessment = assess({
    recipe: probeRecipe,
    actionResults: [{
      actionIndex: 0,
      page: "probe",
      required: true,
      result: {
        body: '{"id":"redacted","enabled":true}',
        contentType: "application/json; charset=utf-8",
        outcome: "confirmed",
        status: 200,
        url: "https://api.example.test/items/current",
      },
      type: "probe-get",
      value: "/items/current",
    }, { actionIndex: 1, page: "capture", result: { capturedOnly: true }, type: "capture", value: "known-item" }],
    apiRecords: [],
    candidateHandoff: {},
  }, operations);
  assert.equal(assessment.status, "productive");
  assert.equal(assessment.targets[0].matchedRecordCount, 1);
  assert.equal(assessment.targets[0].responseShapeSignals.length, 1);
  assert.deepEqual(assessment.targets[0].documentationSignals, [
    "api.example.test GET /items/current response-example",
  ]);
});

test("typed probe errors can satisfy an error-example frontier without becoming request failures", () => {
  const errorRecipe = {
    url: "https://api.example.test",
    actions: [{ type: "probe-get", value: "/items/retired", required: true }, "capture=retired-item"],
    noveltyFrontier: {
      approvalDigest: "f".repeat(64),
      baseline: "checked-in-openapi",
      baselineSignals: { queryMetadata: [], requestShapes: [], responseMetadata: [], responseShapes: [], routes: [] },
      reopenCondition: "The endpoint may now be retired and lacks an error example.",
      targets: [{
        acceptanceKey: "retired-error",
        actionIndexes: [0, 1],
        evidenceLevel: "probed",
        expectedHostFamilies: ["api.example.test"],
        expectedInformationClasses: ["response-metadata"],
        expectedDocumentationObjectives: ["error-example"],
        expectedRoutes: ["/items/retired"],
        id: "retired-error",
        rationale: "Capture a typed removal response.",
        safeAction: "Issue one exact same-origin GET.",
        state: "Retired item",
      }],
    },
  };
  const operations = deriveNoveltyBaseline({
    servers: [{ url: "https://api.example.test" }],
    paths: { "/items/retired": { get: { responses: { 200: { description: "Success" } } } } },
  }).operations;
  const assessment = assess({
    recipe: errorRecipe,
    actionResults: [{
      actionIndex: 0,
      page: "probe",
      required: true,
      result: {
        body: '{"error":{"code":"Gone","message":"This route was retired."}}',
        contentType: "application/json",
        outcome: "http-error",
        status: 410,
        url: "https://api.example.test/items/retired",
      },
      type: "probe-get",
      value: "/items/retired",
    }, { actionIndex: 1, page: "capture", result: { capturedOnly: true }, type: "capture", value: "retired-item" }],
    apiRecords: [],
    candidateHandoff: {},
  }, operations);
  assert.equal(assessment.status, "productive");
  assert.deepEqual(assessment.targets[0].documentationSignals, [
    "api.example.test GET /items/retired error-example:410",
  ]);
  assert.deepEqual(assessment.targets[0].responseMetadataSignals, [
    "api.example.test GET /items/retired mime:application/json",
    "api.example.test GET /items/retired status:410",
  ]);
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

test("frontier control readiness references only targeted click actions", () => {
  const withReadiness = {
    ...recipe,
    frontierControlReadiness: { actionIndexes: [0], timeoutMs: 15000 },
  };
  assert.deepEqual(planFor(withReadiness).frontierControlReadiness, {
    actionIndexes: [0],
    timeoutMs: 15000,
  });
  assert.throws(
    () => planFor({
      ...withReadiness,
      frontierControlReadiness: { actionIndexes: [1], timeoutMs: 15000 },
    }),
    /frontier-targeted click actions/,
  );
  assert.throws(
    () => planFor({ ...recipe, frontierControlReadiness: undefined }),
    /required for click-driven novelty targets/,
  );
  assert.throws(
    () => planFor({
      ...recipe,
      actions: ["click-label-root=Enterprise applications", "click-label-root=Details", "capture=enterprise-applications"],
      frontierControlReadiness: { actionIndexes: [0], timeoutMs: 15000 },
      noveltyFrontier: {
        ...recipe.noveltyFrontier,
        targets: [{ ...recipe.noveltyFrontier.targets[0], actionIndexes: [0, 1, 2] }],
      },
    }),
    /cover every frontier-targeted click action/,
  );
});

test("required novelty blocks a satisfied frontier until a new unmodeled state is defined", () => {
  const satisfied = {
    actions: [],
    noveltyStatus: {
      status: "satisfied",
      reason: "Every confirmed candidate was promoted.",
      nextRequirement: "Define a concrete unmodeled detail state.",
    },
  };
  assert.equal(buildNoveltyPlan(satisfied), null);
  assert.throws(
    () => buildNoveltyPlan(satisfied, { required: true, derivedBaseline: emptyDerivedBaseline }),
    (error) => error.code === "novelty-frontier-invalid"
      && /prior novelty frontier is satisfied/.test(error.message),
  );
});

test("satisfied frontiers reject unknown evidence dispositions", () => {
  assert.throws(
    () => buildNoveltyPlan({
      noveltyStatus: {
        status: "satisfied",
        evidenceDisposition: "old-spec",
        reason: "Prior work is complete.",
        nextRequirement: "Provide exact new evidence.",
      },
    }),
    /evidenceDisposition must be/,
  );
});

test("active frontier requires exact reopen provenance and produces an immutable digest", () => {
  const plan = planFor(recipe);
  assert.match(plan.frontierDigest, /^[a-f0-9]{64}$/u);
  assert.throws(() => planFor({
    ...recipe,
    noveltyFrontier: { ...recipe.noveltyFrontier, approvalDigest: undefined },
  }), /approvalDigest/);
  assert.throws(() => planFor({
    ...recipe,
    noveltyFrontier: { ...recipe.noveltyFrontier, reopenCondition: "" },
  }), /reopenCondition/);
});

test("post-run assessment distinguishes productive targeted shapes from no novelty", () => {
  const actionResults = [
    { page: "seed", type: "navigate", value: "https://entra.microsoft.com" },
    { page: "click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Enterprise applications" },
    { page: "wait", type: "wait-ms", value: "6000" },
    { page: "capture", type: "capture", value: "enterprise-applications" },
  ];
  const candidateHandoff = {
    counts: {},
    confirmedReadCandidates: [{
      baseUrls: ["https://main.iam.ad.ext.azure.com"],
      documentationStatus: "undocumented",
      method: "GET",
      normalizedPath: "/ApplicationInsights/EnterpriseAppSignIns",
    }],
  };
  const productive = assess({
    recipe,
    actionResults,
    candidateHandoff,
    apiRecords: [{
      path: "/ApplicationInsights/EnterpriseAppSignIns",
      queryParameterNames: ["top"],
      responseBodySample: "{\"value\":[{\"id\":\"redacted\"}]}",
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
  assert.equal(documentedOnly.status, "no-target-signal");

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
  assert.equal(empty.status, "no-target-signal");
  assert.equal(empty.measurements.attemptedTargetCount, 1);
  assert.equal(empty.measurements.observedTargetCount, 0);
});

test("a declared documentation objective makes a sanitized known-route example productive", () => {
  const documentationRecipe = {
    ...recipe,
    noveltyFrontier: {
      ...recipe.noveltyFrontier,
      targets: [{
        ...recipe.noveltyFrontier.targets[0],
        expectedDocumentationObjectives: ["response-example"],
        expectedInformationClasses: ["response-shape"],
      }],
    },
  };
  const assessment = assess({
    recipe: documentationRecipe,
    actionResults: [
      { page: "click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Enterprise applications" },
      { page: "wait", type: "wait-ms", value: "6000" },
      { page: "capture", type: "capture", value: "enterprise-applications" },
    ],
    apiRecords: [{
      method: "GET",
      path: "/ApplicationInsights/EnterpriseAppSignIns",
      responseBodySample: "{\"value\":[{\"id\":\"redacted\"}]}",
      responseShapeFingerprint: "known-shape",
      seenOnPages: ["capture"],
      status: 200,
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/EnterpriseAppSignIns",
    }],
  }, [{
    hosts: ["main.iam.ad.ext.azure.com"],
    method: "GET",
    path: "/ApplicationInsights/EnterpriseAppSignIns",
    queryParameterNames: [],
    requestSchemaDocumented: true,
    responseContentTypes: ["application/json"],
    responseExampleDocumented: false,
    responseSchemaDocumented: true,
    responseStatuses: ["200"],
  }]);
  assert.equal(assessment.status, "productive");
  assert.deepEqual(assessment.targets[0].responseShapeSignals, []);
  assert.deepEqual(assessment.targets[0].documentationSignals, [
    "main.iam.ad.ext.azure.com GET /ApplicationInsights/EnterpriseAppSignIns response-example",
  ]);

  assert.throws(() => planFor({
    ...documentationRecipe,
    noveltyFrontier: {
      ...documentationRecipe.noveltyFrontier,
      targets: [{
        ...documentationRecipe.noveltyFrontier.targets[0],
        expectedInformationClasses: ["query-metadata"],
      }],
    },
  }), /must be backed by a compatible/);
});

test("dynamic crawl result rows do not break exact recipe action accounting", () => {
  const crawlRecipe = {
    actions: ["navigate=https://example.test/start", "crawl-links=detail", "capture=detail"],
    noveltyFrontier: {
      approvalDigest: "b".repeat(64),
      baseline: "checked-in-spec-and-coverage-ledgers",
      baselineSignals: { queryMetadata: [], requestShapes: [], responseShapes: [], routes: [] },
      reopenCondition: "A read-only detail state has an undocumented response shape.",
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
      responseBodySample: "{\"id\":\"redacted\"}",
      responseShapeFingerprint: "shape-detail",
      seenOnPages: ["detail-1"],
      url: "https://api.example.test/detail/1",
    }],
    candidateHandoff: {
      confirmedReadCandidates: [{
        baseUrls: ["https://api.example.test"],
        documentationStatus: "undocumented",
        method: "GET",
        normalizedPath: "/detail/{id}",
      }],
    },
  });
  assert.equal(assessment.status, "productive");
  assert.equal(assessment.measurements.attemptedTargetCount, 1);
});

test("suppressed undocumented telemetry cannot produce shape or metadata novelty", () => {
  const telemetryRecipe = {
    url: "https://portal.example.test",
    actions: ["click-label-root=Reports", "capture=reports"],
    frontierControlReadiness: { actionIndexes: [0], timeoutMs: 15000 },
    noveltyFrontier: {
      approvalDigest: "c".repeat(64),
      baseline: "checked-in-spec-and-candidate-policy",
      baselineSignals: { queryMetadata: [], requestShapes: [], responseShapes: [], routes: [] },
      reopenCondition: "A read-only reports state has a reviewable API delta.",
      targets: [{
        acceptanceKey: "reviewable-api-delta",
        actionIndexes: [0, 1],
        evidenceLevel: "confirmed",
        expectedHostFamilies: ["portal.example.test"],
        expectedInformationClasses: ["new-route-family", "request-shape", "response-metadata"],
        expectedRoutePrefixes: ["/api"],
        id: "reviewable-api-delta",
        rationale: "Only reviewable candidates qualify.",
        safeAction: "Open a read-only reports state.",
        state: "Reports",
      }],
    },
  };
  const assessment = assess({
    recipe: telemetryRecipe,
    actionResults: [
      { actionIndex: 0, page: "reports-click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Reports" },
      { actionIndex: 1, page: "reports", type: "capture", value: "reports" },
    ],
    apiRecords: [{
      method: "POST",
      mimeType: "text/plain",
      path: "/api/Telemetry",
      requestShapeFingerprint: "telemetry-shape",
      seenOnPages: ["reports"],
      status: 204,
      url: "https://portal.example.test/api/Telemetry",
    }],
    candidateHandoff: {
      suppressedCandidates: [{
        baseUrls: ["https://portal.example.test"],
        documentationStatus: "undocumented",
        method: "POST",
        normalizedPath: "/api/Telemetry",
        suppressionNote: "Known telemetry sink.",
      }],
    },
  });
  assert.equal(assessment.status, "no-novelty");
  assert.equal(assessment.measurements.targetedShapeAndMetadataSignalCount, 0);
});

test("accepted runtime response metadata does not recur as novelty", () => {
  const metadataRecipe = {
    ...recipe,
    noveltyFrontier: {
      ...recipe.noveltyFrontier,
      baselineSignals: {
        ...recipe.noveltyFrontier.baselineSignals,
        responseMetadata: [
          "main.iam.ad.ext.azure.com GET /ApplicationInsights/EnterpriseAppSignIns mime:text/plain",
          "main.iam.ad.ext.azure.com GET /ApplicationInsights/EnterpriseAppSignIns status:200",
        ],
      },
      targets: [{
        ...recipe.noveltyFrontier.targets[0],
        expectedInformationClasses: ["response-metadata"],
      }],
    },
  };
  const assessment = assess({
    recipe: metadataRecipe,
    actionResults: [
      { actionIndex: 0, page: "click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Enterprise applications" },
      { actionIndex: 1, page: "wait", type: "wait-ms", value: "6000" },
      { actionIndex: 2, page: "capture", type: "capture", value: "enterprise-applications" },
    ],
    apiRecords: [{
      method: "GET",
      mimeType: "text/plain",
      path: "/ApplicationInsights/EnterpriseAppSignIns",
      seenOnPages: ["capture"],
      status: 200,
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/EnterpriseAppSignIns",
    }],
    candidateHandoff: {
      confirmedReadCandidates: [{
        baseUrls: ["https://main.iam.ad.ext.azure.com"],
        documentationStatus: "undocumented",
        method: "GET",
        normalizedPath: "/ApplicationInsights/EnterpriseAppSignIns",
      }],
    },
  });
  assert.equal(assessment.status, "no-novelty");
  assert.equal(assessment.measurements.targetedShapeAndMetadataSignalCount, 0);
});

test("persisted seed sorting and explicit action indexes cannot shift recipe accounting", () => {
  const actionResults = [
    { actionIndex: 0, page: "01-click", result: { clicked: true, transitionEvidence: { stateChanged: true } }, type: "click-label", value: "Enterprise applications" },
    { actionIndex: 1, page: "02-wait", type: "wait-ms", value: "6000" },
    { actionIndex: 2, page: "03-capture", type: "capture", value: "enterprise-applications" },
    { actionIndex: -1, page: "seed-00", required: true, type: "navigate", value: "https://entra.microsoft.com" },
  ];
  const assessment = assess({ recipe, actionResults, candidateHandoff: {}, apiRecords: [] });
  assert.equal(assessment.status, "no-target-signal");
  assert.equal(assessment.measurements.attemptedTargetCount, 1);

  const legacyAssessment = assess({
    recipe,
    actionResults: actionResults.map(({ actionIndex, ...result }) => result),
    candidateHandoff: {},
    apiRecords: [],
  });
  assert.equal(legacyAssessment.status, "no-target-signal");
  assert.equal(legacyAssessment.measurements.attemptedTargetCount, 1);
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
    candidateHandoff: {
      confirmedReadCandidates: [{
        baseUrls: ["https://main.iam.ad.ext.azure.com"],
        documentationStatus: "undocumented",
        method: "GET",
        normalizedPath: "/ApplicationInsights/CrossTarget",
      }],
    },
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
    }, {
      attribution: { actionIndex: 99 },
      method: "GET",
      path: "/ApplicationInsights/CrossTarget",
      responseBodySample: "{\"value\":[1]}",
      responseShapeFingerprint: "wrong-action",
      seenOnPages: ["capture"],
      url: "https://main.iam.ad.ext.azure.com/ApplicationInsights/CrossTarget",
    }],
  });
  assert.equal(assessment.status, "no-target-signal");
});

test("exact route selectors exclude unsafe sibling and descendant operations", () => {
  const exactRecipe = {
    url: "https://portal.example.test",
    actions: ["navigate=https://portal.example.test", "capture=profile"],
    noveltyFrontier: {
      approvalDigest: "f".repeat(64),
      baselineSignals: { queryMetadata: [], requestShapes: [], responseMetadata: [], responseShapes: [], routes: [] },
      reopenCondition: "The exact profile response shape is undocumented.",
      targets: [{
        acceptanceKey: "profile-shape",
        actionIndexes: [0, 1],
        evidenceLevel: "confirmed",
        expectedHostFamilies: ["api.example.test"],
        expectedInformationClasses: ["response-shape"],
        expectedRoutes: ["/beta/UserProfile"],
        id: "profile-shape",
        rationale: "Exclude token-shaped child routes.",
        safeAction: "Reload the read-only landing page.",
        state: "Portal bootstrap",
      }],
    },
  };
  const assessment = assess({
    recipe: exactRecipe,
    actionResults: [
      { actionIndex: 0, page: "landing", result: { resolvedUrl: "https://portal.example.test", url: "https://portal.example.test" }, type: "navigate", value: "https://portal.example.test" },
      { actionIndex: 1, page: "profile", type: "capture", value: "profile" },
    ],
    candidateHandoff: {},
    apiRecords: [{ method: "GET", path: "/beta/UserProfile/ExchangeAdminCenter.GetToken()", responseShapeFingerprint: "token-shape", seenOnPages: ["profile"], url: "https://api.example.test/beta/UserProfile/ExchangeAdminCenter.GetToken()" }],
  }, [{ hosts: ["api.example.test"], method: "GET", path: "/beta/UserProfile/ExchangeAdminCenter.GetToken()", queryParameterNames: [], requestSchemaDocumented: true, responseContentTypes: ["application/json"], responseSchemaDocumented: false, responseStatuses: ["200"] }]);
  assert.equal(assessment.status, "no-target-signal");
  assert.equal(assessment.targets[0].matchedRecordCount, 0);
});
