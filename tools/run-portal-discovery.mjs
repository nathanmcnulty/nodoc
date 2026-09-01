import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCandidateHandoff,
  writePartitionedCandidateHandoff,
} from "./discovery-candidate-handoff.mjs";
import {
  aggregateInteractionHealth,
  buildInteractionHealthStatus,
  sanitizeInteractionHealth,
} from "./discovery-capture-policy.mjs";
import { evaluateDiscoverySaturation } from "./discovery-saturation.mjs";
import { classifyGetProbeUrl } from "./discovery-safety.mjs";
import {
  captureRecipesByTitle,
  crawlMetadataByTitle,
} from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, loadBundledSpecification, repoRoot } from "./spec-quality-lib.mjs";
import {
  claimAssignment,
  defaultLedgerPath,
  enqueueAssignment,
  ensureLedgerFileReady,
  getLedgerViewFromFile,
  normalizeEndpoint,
  resumeAttempt,
  updateAttempt,
  updateAttemptFromDiscoveryRun,
} from "./portal-discovery-ledger.mjs";
import { prepareLedgerAttempt } from "./portal-discovery-dispatch.mjs";
import {
  ProcessSupervisionTimeoutError,
  runNode,
  runNodeJson,
  writeParentSupervisionFailure,
} from "./portal-discovery-process.mjs";
import {
  alignBrowserCdpTarget,
  runBrowserCdpPreflight,
} from "./browser-cdp-preflight.mjs";
import {
  resolvePageTargetBootstrapCriteria,
  resolvePageTargetCriteria,
  validateRecipeTargetMetadata,
} from "./portal-discovery-recipe.mjs";
import { planActionBudget } from "./portal-discovery-action-budget.mjs";
import {
  summarizeOperationReceipts,
  validateMutationEventsArtifact,
  validateOperationSummary,
} from "./portal-discovery-operation-safety.mjs";
import { validatePassiveOperationReceiptArtifact } from "./portal-discovery-passive-operations.mjs";
import {
  buildNoveltyPlan,
  deriveNoveltyBaseline,
  evaluateNoveltyEvidence,
} from "./portal-discovery-novelty.mjs";
import {
  operationStepAtActionIndex,
  validateOperationAuthorization,
} from "./portal-discovery-operation-safety.mjs";
import {
  buildGraphResearchQueue,
  buildGraphTelemetry,
  validateGraphResearchQueue,
  validateGraphTelemetry,
} from "./graph-telemetry.mjs";
import { loadGraphContractCache } from "./graph-contract-cache.mjs";
import { evaluateGraphTelemetryObjectives } from "./graph-telemetry-objectives.mjs";

const validPhases = new Set(["all", "analyze", "capture", "plan"]);
const capturePolicyFiles = [
  "PORTAL_DISCOVERY_AGENT_PROMPT.md",
  "AGENT_DISCOVERY_RUNBOOK.md",
  "AGENT_DISCOVERY_PLAYBOOK.md",
];

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildPreflightCriteria(recipe) {
  const pageTarget = resolvePageTargetCriteria(recipe);
  return {
    matchHosts: pageTarget.matchHosts,
    matchPathPrefixes: pageTarget.matchPathPrefixes,
    ...(Array.isArray(recipe?.pageTarget?.allowedEntryQueryParameters)
      ? { allowedEntryQueryParameters: [...recipe.pageTarget.allowedEntryQueryParameters] }
      : {}),
    urlPattern: recipe.matchUrlPattern,
    titlePattern: recipe.matchTitlePattern,
    expectedTitlePattern: recipe.expectedTitlePattern,
    rejectBodyPattern: recipe.rejectBodyPattern,
  };
}

export function buildBootstrapPreflightCriteria(recipe) {
  const bootstrap = resolvePageTargetBootstrapCriteria(recipe);
  if (!bootstrap) return null;
  return {
    ...bootstrap,
    urlPattern: recipe.matchUrlPattern,
    titlePattern: recipe.matchTitlePattern,
    expectedTitlePattern: recipe.expectedTitlePattern,
    rejectBodyPattern: recipe.rejectBodyPattern,
  };
}

export async function preflightRecipeTarget({
  recipe,
  endpoint,
  expectedProduct,
  stabilityMs,
  pollMs,
  timeoutMs,
} = {}) {
  const metadata = validateRecipeTargetMetadata(recipe);
  const featureCriteria = buildPreflightCriteria(recipe);
  const bootstrapCriteria = buildBootstrapPreflightCriteria(recipe);
  if (!bootstrapCriteria) {
    const preflight = await runBrowserCdpPreflight({
      endpoint,
      expectedProduct,
      ...featureCriteria,
      stabilityMs,
      pollMs,
      timeoutMs,
    });
    return {
      ...preflight,
      alignment: {
        status: "already-aligned",
        targetState: "feature-target-aligned",
        targetId: preflight.target.id,
      },
    };
  }
  return alignBrowserCdpTarget({
    endpoint,
    expectedProduct,
    featureCriteria,
    bootstrapCriteria,
    entryUrl: metadata.entryUrl,
    stabilityMs,
    pollMs,
    timeoutMs,
  });
}

export function validateSelectedRecipeTarget(recipe) {
  try {
    return validateRecipeTargetMetadata(recipe);
  } catch (error) {
    error.code = "recipe-target-invalid";
    error.blocker = {
      ...(error.blocker ?? {}),
      remediation: "Repair and validate the checked-in pageTarget metadata before allocating browser or ledger work.",
    };
    throw error;
  }
}

export function frontierReadinessSupervisionTimeout(readinessTimeoutMs, supervisionTimeoutMs) {
  return Math.max(supervisionTimeoutMs, readinessTimeoutMs + 30000);
}

function parseArgs(argv) {
  const args = {
    artifacts: null,
    groupedHandoffDir: null,
    includeAdjacent: false,
    saturation: false,
    applySaturationStop: false,
    requireNovelty: false,
    noLedger: false,
    json: false,
    phase: "all",
    ledgerMode: null,
    ledgerPath: defaultLedgerPath,
    assignmentId: null,
    assignmentDigest: null,
    attemptNumber: null,
    endpoint: null,
    cdpEndpoint: "http://127.0.0.1:9222",
    expectedProduct: null,
    priority: "normal",
    model: null,
    operationApprovalDigest: null,
    operationCeiling: "observe-only",
    reasoning: null,
    workerId: null,
    workerPacketOnly: false,
    view: "all",
    status: null,
    promotionRef: null,
    reviewRef: null,
    mergeRef: null,
    nextAction: null,
    blocker: null,
    specId: null,
    includeAttempts: false,
    discoveryRun: null,
    portal: null,
    profile: "bounded",
    recipe: null,
    seedArtifacts: null,
    targetId: null,
    bundleCacheDir: null,
    graphContractDir: process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "nodoc-cdp", "graph-contract") : null,
    graphContractDisabled: false,
    supervisionTimeoutMs: 120000,
    captureSupervisionTimeoutMs: 900000,
    variables: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--include-adjacent") {
      args.includeAdjacent = true;
    } else if (argument === "--saturation") {
      args.saturation = true;
    } else if (argument === "--apply-saturation-stop") {
      args.saturation = true;
      args.applySaturationStop = true;
    } else if (argument === "--require-novelty") {
      args.requireNovelty = true;
    } else if (argument === "--no-ledger") {
      args.noLedger = true;
    } else if (argument === "--json") {
      args.json = true;
    } else if (argument === "--worker-packet") {
      args.workerPacketOnly = true;
    } else if (argument === "--portal" && next) {
      args.portal = next;
      index += 1;
    } else if (argument === "--phase" && next) {
      args.phase = next;
      index += 1;
    } else if (argument === "--profile" && next) {
      args.profile = next;
      index += 1;
    } else if (argument === "--artifacts" && next) {
      args.artifacts = path.resolve(next);
      index += 1;
    } else if ((argument === "--grouped-handoff" || argument === "--grouped-handoff-dir") && next) {
      args.groupedHandoffDir = path.resolve(next);
      index += 1;
    } else if (argument === "--recipe" && next) {
      args.recipe = path.resolve(next);
      index += 1;
    } else if (argument === "--ledger" && next) {
      args.ledgerMode = next;
      index += 1;
    } else if (argument === "--ledger-path" && next) {
      args.ledgerPath = path.resolve(next);
      index += 1;
    } else if (argument === "--assignment-id" && next) {
      args.assignmentId = next;
      index += 1;
    } else if (argument === "--assignment-digest" && next) {
      args.assignmentDigest = next.trim().toLowerCase();
      index += 1;
    } else if ((argument === "--attempt" || argument === "--attempt-number") && next) {
      args.attemptNumber = Number(next);
      index += 1;
    } else if (argument === "--endpoint" && next) {
      args.endpoint = next;
      index += 1;
    } else if (argument === "--cdp-endpoint" && next) {
      args.cdpEndpoint = next;
      index += 1;
    } else if (argument === "--expected-product" && next) {
      args.expectedProduct = next;
      index += 1;
    } else if (argument === "--priority" && next) {
      args.priority = next;
      index += 1;
    } else if (argument === "--model" && next) {
      args.model = next;
      index += 1;
    } else if (argument === "--reasoning" && next) {
      args.reasoning = next;
      index += 1;
    } else if (argument === "--operation-ceiling" && next) {
      args.operationCeiling = next.trim();
      index += 1;
    } else if (argument === "--operation-approval-digest" && next) {
      args.operationApprovalDigest = next.trim().toLowerCase();
      index += 1;
    } else if (argument === "--worker-id" && next) {
      args.workerId = next;
      index += 1;
    } else if (argument === "--view" && next) {
      args.view = next;
      index += 1;
    } else if (argument === "--status" && next) {
      args.status = next;
      index += 1;
    } else if (argument === "--promotion-ref" && next) {
      args.promotionRef = next;
      index += 1;
    } else if (argument === "--review-ref" && next) {
      args.reviewRef = next;
      index += 1;
    } else if (argument === "--merge-ref" && next) {
      args.mergeRef = next;
      index += 1;
    } else if (argument === "--blocker" && next) {
      args.blocker = parseJsonArgument(next);
      index += 1;
    } else if (argument === "--spec-id" && next) {
      args.specId = next;
      index += 1;
    } else if (argument === "--discovery-run" && next) {
      args.discoveryRun = path.resolve(next);
      index += 1;
    } else if (argument === "--next-action" && next) {
      args.nextAction = parseJsonArgument(next);
      index += 1;
    } else if (argument === "--include-attempts") {
      args.includeAttempts = true;
    } else if (argument === "--seed-artifacts" && next) {
      args.seedArtifacts = path.resolve(next);
      index += 1;
    } else if (argument === "--target-id" && next) {
      args.targetId = next;
      index += 1;
    } else if (argument === "--bundle-cache-dir" && next) {
      args.bundleCacheDir = path.resolve(next);
      index += 1;
    } else if (argument === "--graph-contract-dir" && next) {
      args.graphContractDir = path.resolve(next);
      index += 1;
    } else if (argument === "--no-graph-contract") {
      args.graphContractDisabled = true;
    } else if (argument === "--supervision-timeout-ms" && next) {
      args.supervisionTimeoutMs = Number(next);
      index += 1;
    } else if (argument.startsWith("--supervision-timeout-ms=")) {
      args.supervisionTimeoutMs = Number(argument.slice("--supervision-timeout-ms=".length));
    } else if (argument === "--capture-supervision-timeout-ms" && next) {
      args.captureSupervisionTimeoutMs = Number(next);
      index += 1;
    } else if (argument.startsWith("--capture-supervision-timeout-ms=")) {
      args.captureSupervisionTimeoutMs = Number(argument.slice("--capture-supervision-timeout-ms=".length));
    } else if (argument === "--var" && next) {
      args.variables.push(next);
      index += 1;
    }
  }

  if (args.profile !== "bounded") {
    throw new Error(`Invalid --profile "${args.profile}". Only the bounded profile is currently supported.`);
  }
  if (!Number.isFinite(args.supervisionTimeoutMs) || args.supervisionTimeoutMs <= 0) {
    throw new Error(`Invalid --supervision-timeout-ms "${args.supervisionTimeoutMs}".`);
  }
  if (!Number.isFinite(args.captureSupervisionTimeoutMs) || args.captureSupervisionTimeoutMs <= 0) {
    throw new Error(`Invalid --capture-supervision-timeout-ms "${args.captureSupervisionTimeoutMs}".`);
  }
  if (!args.ledgerMode) {
    if (!args.portal) {
      throw new Error("Missing required --portal <title-or-spec-id>.");
    }
    if (!validPhases.has(args.phase)) {
      throw new Error(`Invalid --phase "${args.phase}". Use plan, capture, analyze, or all.`);
    }
    if (args.workerPacketOnly && args.phase !== "plan") {
      throw new Error("--worker-packet is only valid with --phase plan.");
    }
    if (args.assignmentDigest && !args.assignmentId) {
      throw new Error("--assignment-digest requires --assignment-id.");
    }
    if (args.assignmentDigest && !/^[a-f0-9]{64}$/u.test(args.assignmentDigest)) {
      throw new Error("--assignment-digest must be a lowercase SHA-256 digest.");
    }
    if (args.phase !== "plan" && !args.artifacts) {
      throw new Error(`--artifacts <directory> is required for phase "${args.phase}".`);
    }
    return args;
  }

  if (!new Set(["enqueue", "status", "claim", "update", "resume"]).has(args.ledgerMode)) {
    throw new Error("Invalid --ledger value. Use enqueue, status, claim, update, or resume.");
  }
  if (args.ledgerMode === "enqueue" && (!args.endpoint || (!args.portal && !args.specId))) {
    throw new Error("Ledger enqueue requires --endpoint and either --portal or --spec-id.");
  }
  if (["update", "resume"].includes(args.ledgerMode) && !args.assignmentId) {
    throw new Error(`Ledger ${args.ledgerMode} requires --assignment-id.`);
  }
  if (args.attemptNumber !== null && !Number.isInteger(args.attemptNumber)) {
    throw new Error("--attempt-number must be an integer.");
  }
  return args;
}

function parseJsonArgument(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const [code, ...detail] = raw.split(":");
    return { code: code.trim(), detail: detail.join(":").trim() || null };
  }
}

async function recipeDigest(recipePath) {
  return createHash("sha256").update(await readFile(recipePath, "utf8")).digest("hex");
}

function resolveLedgerSpec(specInventory, args) {
  if (args.specId) {
    const normalized = args.specId.trim().toLowerCase();
    return specInventory.find((record) => record.specId.toLowerCase() === normalized) ?? null;
  }
  return args.portal ? resolvePortal(specInventory, args.portal) : null;
}

function resolvePortal(specInventory, portalInput) {
  const normalizedInput = portalInput.trim().toLowerCase();
  const matches = specInventory.filter((record) =>
    record.specId.toLowerCase() === normalizedInput
    || record.title.toLowerCase() === normalizedInput);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Unknown portal "${portalInput}".`
        : `Portal "${portalInput}" is ambiguous.`,
    );
  }
  return matches[0];
}

async function selectRecipe(specRecord, explicitRecipe, { requireNovelty = false } = {}) {
  const allowedRecipes = (captureRecipesByTitle[specRecord.title] ?? [])
    .map((recipePath) => path.resolve(repoRoot, recipePath));
  if (explicitRecipe) {
    const resolvedRecipe = path.resolve(explicitRecipe);
    if (!allowedRecipes.includes(resolvedRecipe)) {
      throw new Error(
        `Recipe "${explicitRecipe}" is not checked in for ${specRecord.title}.`,
      );
    }
    return resolvedRecipe;
  }
  const matchingRecipes = [];
  const noveltyRecipes = [];
  for (const recipePath of allowedRecipes) {
    try {
      const recipe = JSON.parse(await readFile(recipePath, "utf8"));
      if (recipe.portal === specRecord.title) {
        matchingRecipes.push(recipePath);
        if (recipe.noveltyFrontier || recipe.noveltyStatus) noveltyRecipes.push(recipePath);
      }
    } catch {
      // Recipe parsing is validated separately before capture.
    }
  }
  if (requireNovelty && noveltyRecipes.length > 0) return noveltyRecipes[0];
  const matchingPreferred = matchingRecipes.find((recipePath) =>
    recipePath.includes("-deep") && !recipePath.includes("seeded-replay"));
  if (matchingPreferred) {
    return matchingPreferred;
  }
  if (matchingRecipes.length > 0) {
    return matchingRecipes[0];
  }
  const preferred = allowedRecipes.find((recipePath) =>
    recipePath.includes("-deep") && !recipePath.includes("seeded-replay"));
  return preferred
    ?? allowedRecipes.find((recipePath) => !recipePath.includes("seeded-replay"))
    ?? allowedRecipes[0]
    ?? null;
}

export function expandRecipeVariables(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/gu, (_match, name) => {
      if (!Object.prototype.hasOwnProperty.call(variables, name)) {
        throw new Error(`Recipe variable ${JSON.stringify(name)} was not provided.`);
      }
      return String(variables[name]);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => expandRecipeVariables(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandRecipeVariables(entry, variables)]),
    );
  }
  return value;
}

export function recipeVariables(recipe, cliVariables) {
  const variables = { ...(recipe.variables ?? {}) };
  for (const specification of cliVariables ?? []) {
    const separator = specification.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid --var value ${JSON.stringify(specification)}.`);
    variables[specification.slice(0, separator).trim()] = specification.slice(separator + 1);
  }
  return variables;
}

export function prepareRecipeForRun(sourceRecipe, cliVariables) {
  return expandRecipeVariables(
    sourceRecipe,
    recipeVariables(sourceRecipe, cliVariables),
  );
}

async function inspectRecipeSafety(recipePath, args = {}) {
  const sourceRecipe = JSON.parse(await readFile(recipePath, "utf8"));
  const recipe = prepareRecipeForRun(sourceRecipe, args.variables);
  const activeOperationPlan = validateOperationAuthorization({
    activeOperations: recipe.activeOperations ?? [],
    actions: recipe.actions ?? [],
    approvalDigest: args.operationApprovalDigest,
    ceiling: args.operationCeiling ?? "observe-only",
  });
  const unsafeActionPattern =
    /(?:^|[\s/_-])(?:apply|confirm|create|delete|disable|enable|execute|export|generate|invoke|log-?out|publish|remove|reset|run|save|sign-?out|start|submit|sync|trigger|update)(?:$|[\s/_.?&=-])/iu;
  const unsafeActions = [];

  for (const [actionIndex, action] of (recipe.actions ?? []).entries()) {
    const rawType = typeof action === "string"
      ? action.split("=", 1)[0]
      : String(action?.type || "");
    const value = typeof action === "string"
      ? action.slice(action.indexOf("=") + 1)
      : String(action?.value || "");
    const type = rawType.replace(/-(?:root|iframe)$/u, "");
    const authorizedStep = operationStepAtActionIndex(activeOperationPlan, actionIndex);
    if (type.startsWith("click") && unsafeActionPattern.test(value) && !authorizedStep) {
      unsafeActions.push(`${rawType}=${value}`);
    }
    if (type === "navigate") {
      const classification = classifyGetProbeUrl(value, recipe.url);
      if (!classification.allowed) {
        unsafeActions.push(`${rawType}=${value} (${classification.code})`);
      }
    }
  }

  for (const [groupName, group] of Object.entries(recipe.seedRouteGroups ?? {})) {
    for (const routeTemplate of group?.routeTemplates ?? []) {
      const classification = classifyGetProbeUrl(routeTemplate, recipe.url);
      if (!classification.allowed) {
        unsafeActions.push(
          `seedRouteGroups.${groupName}=${routeTemplate} (${classification.code})`,
        );
      }
    }
  }

  return {
    activeOperationPlan,
    safe: unsafeActions.length === 0,
    unsafeActions,
  };
}

function isAuthenticationUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return [
      "login.live.com",
      "login.microsoft.com",
      "login.microsoftonline.com",
      "login.windows.net",
    ].some((authHost) => hostname === authHost || hostname.endsWith(`.${authHost}`));
  } catch {
    return false;
  }
}

async function detectAuthenticationBarrier(artifactDir, captureSummary) {
  if (isAuthenticationUrl(captureSummary.finalUrl)) {
    return {
      detail: `Capture ended on authentication host ${new URL(captureSummary.finalUrl).hostname}.`,
      source: "final-url",
    };
  }

  try {
    const snapshots = JSON.parse(
      await readFile(path.join(artifactDir, "session-snapshots.json"), "utf8"),
    );
    for (const checkpoint of snapshots.toReversed()) {
      for (const snapshot of (checkpoint?.sessionSnapshots ?? []).toReversed()) {
        if (isAuthenticationUrl(snapshot?.url) || isAuthenticationUrl(snapshot?.targetUrl)) {
          return {
            detail: "A captured page or child target ended on a Microsoft authentication host.",
            source: "session-url",
          };
        }
        const title = String(snapshot?.title || "").trim();
        const bodyText = String(snapshot?.bodyText || "").slice(0, 2000);
        if (
          /^(?:enter password|microsoft sign in|pick an account|sign in(?: to your account)?)$/iu.test(title)
          || /\b(?:authentication required|enter your password|pick an account|sign in to your account)\b/iu.test(bodyText)
        ) {
          return {
            detail: `A captured page exposed an authentication barrier${title ? ` (${title})` : ""}.`,
            source: "session-content",
          };
        }
      }
    }
  } catch {
    // A missing optional snapshot artifact is not by itself an auth blocker.
  }

  return null;
}

function buildBrief(specRecord, recipePath) {
  const metadata = crawlMetadataByTitle[specRecord.title];
  return {
    allowedEvidence: ["confirmed", "probed", "bundle-discovered"],
    authModel: metadata?.authModel ?? null,
    crawlPriority: metadata?.crawlPriority ?? "unknown",
    metadataNextPass: metadata?.nextPass ?? "unknown",
    pathPrefixes: specRecord.pathPrefixes,
    portal: specRecord.title,
    portalUrl: metadata?.portalUrl ?? null,
    profile: "bounded",
    recipe: recipePath ? path.relative(repoRoot, recipePath).replaceAll("\\", "/") : null,
    safety: {
      allowedProbeMethods: ["GET"],
      crossOriginProbes: false,
      redirects: false,
      specificationEdits: false,
      writeActions: false,
    },
    serverUrls: specRecord.serverUrls,
    specId: specRecord.specId,
    specPath: specRecord.specPath,
    stopConditions: [
      "checked-in recipe completed",
      "candidate queue generated",
      "structured blocker emitted",
    ],
  };
}

export async function buildCaptureWorkerPacket({
  actionBudget,
  args,
  brief,
  noveltyPlan,
  recipePath,
}) {
  const policyBindings = await Promise.all(capturePolicyFiles.map(async (relativePath) => {
    const contents = await readFile(path.join(repoRoot, relativePath));
    return {
      bytes: contents.byteLength,
      path: relativePath,
      sha256: sha256(contents),
    };
  }));
  const recipeContents = await readFile(recipePath);
  const driverArgs = [
    "--portal", brief.specId,
    "--recipe", brief.recipe,
    "--profile", "bounded",
    "--phase", "all",
    ...(args.requireNovelty ? ["--require-novelty"] : []),
    "--model", "gpt-5.6-luna",
    "--reasoning", "low",
    "--operation-ceiling", args.operationCeiling,
    ...(args.assignmentId ? ["--assignment-id", args.assignmentId] : []),
    ...(args.assignmentDigest ? ["--assignment-digest", args.assignmentDigest] : []),
    ...(args.endpoint || brief.portalUrl ? ["--endpoint", args.endpoint || brief.portalUrl] : []),
    "--cdp-endpoint", args.cdpEndpoint,
    ...(args.workerId ? ["--worker-id", args.workerId] : []),
    ...(args.operationApprovalDigest
      ? ["--operation-approval-digest", args.operationApprovalDigest]
      : []),
    ...args.variables.flatMap((variable) => ["--var", variable]),
  ];
  const verificationArgs = [...driverArgs];
  verificationArgs[verificationArgs.indexOf("--phase") + 1] = "plan";
  verificationArgs.push("--worker-packet", "--json");
  const packetCore = {
    assignmentType: "capture",
    authorization: {
      activeOperationCeiling: args.operationCeiling,
      operationApprovalDigest: args.operationApprovalDigest,
      passiveCaptureMethods: "all-observed-methods",
      specificationEdits: false,
    },
    bindings: {
      assignmentDigest: args.assignmentDigest,
      assignmentId: args.assignmentId,
      noveltyPlanSha256: noveltyPlan ? sha256(stableJson(noveltyPlan)) : null,
      policyFiles: policyBindings,
      recipe: brief.recipe,
      recipeSha256: sha256(recipeContents),
    },
    evidenceContract: {
      authoritativeArtifacts: [
        "discovery-run.json",
        "summary.json",
        "candidate-handoff.json",
      ],
      preserveFailedArtifacts: true,
      promotionAuthorized: false,
      reportMode: "compact-structured-output",
    },
    execution: {
      actionBudget,
      driverArgs,
      freshArtifactDirectoryRequired: true,
      liveLifecycleConcurrency: 1,
      requiredRuntimeInputs: [
        "fresh-artifact-directory",
        ...(args.requireNovelty ? ["stable-derivative-cache-directory"] : []),
      ],
      stableDerivativeCacheRequired: args.requireNovelty,
      verificationArgs,
    },
    role: {
      model: "gpt-5.6-luna",
      reasoning: "low",
    },
    schemaVersion: "1.0",
    scope: {
      allowedEvidence: brief.allowedEvidence,
      pathPrefixes: brief.pathPrefixes,
      portal: brief.portal,
      portalUrl: brief.portalUrl,
      serverUrls: brief.serverUrls,
      specId: brief.specId,
      specPath: brief.specPath,
    },
    stopConditions: brief.stopConditions,
    escalation: {
      readAuthoritativePolicyFiles: true,
      triggers: [
        "binding-digest-mismatch",
        "structured-blocker",
        "active-operation-requested",
        "authentication-or-target-repair",
        "seeded-retry-or-recovery",
        "scope-or-safety-ambiguity",
      ],
    },
  };
  const packetBytes = Buffer.byteLength(stableJson(packetCore), "utf8");
  const sourcePolicyBytes = policyBindings.reduce((sum, binding) => sum + binding.bytes, 0);
  return {
    ...packetCore,
    measurements: {
      byteReduction: sourcePolicyBytes > 0
        ? Number((1 - (packetBytes / sourcePolicyBytes)).toFixed(4))
        : null,
      packetCoreBytes: packetBytes,
      sourcePolicyBytes,
      tokenEstimate: "not-reported-use-bytes-for-comparison",
    },
    packetSha256: sha256(stableJson(packetCore)),
  };
}

export function buildActionBudget(recipe) {
  return planActionBudget(recipe);
}

async function writeRunState(artifactDir, payload) {
  if (!artifactDir) {
    return;
  }
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "discovery-run.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function persistTerminalRun(args, runState) {
  await writeRunState(args.artifacts, runState);
  if (!args.assignmentId || args.noLedger) {
    return;
  }
  const attemptNumber = args.attemptNumber
    ?? await latestAttemptNumber(args.ledgerPath, args.assignmentId);
  if (!attemptNumber) {
    throw new Error(`Unable to locate an attempt for ${args.assignmentId}.`);
  }
  await updateAttemptFromDiscoveryRun({
    ledgerPath: args.ledgerPath,
    assignmentId: args.assignmentId,
    attemptNumber,
    artifactDir: args.artifacts,
    model: args.model,
    reasoning: args.reasoning,
    workerId: args.workerId,
    discoveryRun: runState,
  });
}

async function readInteractionHealth(artifactDir) {
  let summary;
  try {
    summary = JSON.parse(await readFile(path.join(artifactDir, "summary.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }

  let actionResults;
  try {
    actionResults = JSON.parse(await readFile(path.join(artifactDir, "action-results.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return sanitizeInteractionHealth(
        summary.interactionHealth ?? summary.actionValidation?.interactionHealth,
      );
    }
    throw error;
  }

  const reportedInteractionHealth =
    summary.interactionHealth ?? summary.actionValidation?.interactionHealth;
  return sanitizeInteractionHealth(aggregateInteractionHealth(actionResults, {
    reported: reportedInteractionHealth?.counts,
  }));
}

function unresolvedOperationSummary(plan, reason) {
  return summarizeOperationReceipts([{
    schemaVersion: 1,
    operationId: plan.operationId,
    mode: plan.mode,
    approvalDigest: plan.approvalDigest,
    executionState: "unresolved-change",
    unresolvedReason: reason,
    accounting: { artifactValidationFailed: true },
    evidence: {},
  }]);
}

async function readVerifiedMutationSummary(
  artifactDir,
  { activeOperationPlan = null, captureSummary = null } = {},
) {
  let events = null;
  try {
    events = JSON.parse(await readFile(path.join(artifactDir, "mutation-events.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (activeOperationPlan) {
        return unresolvedOperationSummary(activeOperationPlan, "mutation-artifact-invalid");
      }
      throw error;
    }
  }
  try {
    if (!events) {
      if (activeOperationPlan) {
        return unresolvedOperationSummary(activeOperationPlan, "mutation-artifact-missing");
      }
      return captureSummary?.mutationSummary
        ? validateOperationSummary(captureSummary.mutationSummary)
        : null;
    }
    return validateMutationEventsArtifact(events, {
      activeOperationPlan,
      captureSummary: captureSummary?.mutationSummary ?? null,
    });
  } catch (error) {
    if (activeOperationPlan) {
      return unresolvedOperationSummary(activeOperationPlan, "mutation-artifact-inconsistent");
    }
    throw error;
  }
}

function operationBlocker(mutationSummary, { captureFailure = null } = {}) {
  if (!mutationSummary || mutationSummary.safeToContinue !== false) return null;
  const unresolvedReceipt = mutationSummary.receipts?.find(
    (receipt) => receipt.executionState === "unresolved-change",
  );
  return {
    code: unresolvedReceipt?.mode === "abort-only"
      ? "mutation-abort-unproven"
      : "mutation-rollback-unresolved",
    detail: captureFailure
      ? "Capture failed while an active operation lacks terminal abort or restoration proof."
      : "An active operation lacks terminal abort or restoration proof.",
    operationIds: mutationSummary.unresolvedOperationIds,
    ...(captureFailure ? { captureFailure } : {}),
    remediation:
      "Stop live work, inspect mutation-events.json locally, and resolve the named operation before another live lifecycle.",
  };
}

async function inspectCaptureCompleteness(artifactDir) {
  const summaryPath = path.join(artifactDir, "summary.json");
  try {
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    if (!summary || typeof summary !== "object" || !summary.portal) {
      return {
        captureStatus: "corrupted-minimum-artifacts",
        captureComplete: false,
        reason: "summary-invalid",
        source: "summary.json",
      };
    }
    if (summary.passiveOperationSummary) {
      try {
        const passiveOperations = JSON.parse(await readFile(
          path.join(artifactDir, "passive-operation-receipts.json"),
          "utf8",
        ));
        validatePassiveOperationReceiptArtifact(passiveOperations, summary.passiveOperationSummary);
      } catch (error) {
        return {
          captureStatus: "corrupted-minimum-artifacts",
          captureComplete: false,
          reason: error?.code === "ENOENT" ? "passive-operation-receipts-missing" : "passive-operation-receipts-invalid",
          source: "passive-operation-receipts.json",
        };
      }
    }
    const authenticationBarrier = await detectAuthenticationBarrier(artifactDir, summary);
    if (authenticationBarrier) {
      return {
        captureStatus: "authentication-blocked",
        captureComplete: false,
        reason: "authentication-required",
        source: authenticationBarrier.source,
      };
    }
    return {
      captureStatus: "complete",
      captureComplete: true,
      reason: "summary-present",
      source: "summary.json",
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      const artifacts = await findExistingCaptureArtifacts(artifactDir);
      return {
        captureStatus: artifacts.length > 0 ? "interrupted" : "missing-minimum-artifacts",
        captureComplete: false,
        reason: artifacts.length > 0 ? "summary-missing" : "summary-missing-and-no-capture-artifacts",
        source: "artifact-directory",
      };
    }
    if (error instanceof SyntaxError) {
      return {
        captureStatus: "corrupted-minimum-artifacts",
        captureComplete: false,
        reason: "summary-invalid-json",
        source: "summary.json",
      };
    }
    throw error;
  }
}

async function findExistingCaptureArtifacts(artifactDir) {
  try {
    return (await readdir(artifactDir))
      .filter((entry) => entry !== "discovery-run.json");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function preflightCdp() {
  try {
    const response = await fetch("http://127.0.0.1:9222/json/version", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { available: false, detail: `CDP returned HTTP ${response.status}.` };
    }
    const metadata = await response.json();
    return {
      available: Boolean(metadata.webSocketDebuggerUrl),
      browser: metadata.Browser ?? null,
      detail: metadata.webSocketDebuggerUrl
        ? null
        : "CDP metadata did not include a browser WebSocket URL.",
    };
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function latestAttemptNumber(ledgerPath, assignmentId) {
  const view = await getLedgerViewFromFile({
    ledgerPath,
    filters: { assignmentId },
    includeAttempts: true,
  });
  return view.assignments[0]?.latestAttempt?.attemptNumber ?? null;
}

async function runLedgerMode(args) {
  await ensureLedgerFileReady(args.ledgerPath);

  if (args.ledgerMode === "status") {
    console.log(JSON.stringify(await getLedgerViewFromFile({
      ledgerPath: args.ledgerPath,
      view: args.view,
      filters: {
        assignmentId: args.assignmentId,
        specId: args.specId,
        portal: args.portal,
        state: args.status,
      },
      includeAttempts: args.includeAttempts,
    }), null, 2));
    return;
  }

  if (args.ledgerMode === "claim") {
    console.log(JSON.stringify(await claimAssignment({
      ledgerPath: args.ledgerPath,
      assignmentId: args.assignmentId,
      endpoint: args.endpoint,
      phase: args.phase,
      profile: args.profile,
      workerId: args.workerId,
      model: args.model,
      reasoning: args.reasoning,
    }), null, 2));
    return;
  }

  if (args.ledgerMode === "resume") {
    console.log(JSON.stringify(await resumeAttempt({
      ledgerPath: args.ledgerPath,
      assignmentId: args.assignmentId,
      artifactDir: args.artifacts,
      phase: args.phase,
      workerId: args.workerId,
      model: args.model,
      reasoning: args.reasoning,
    }), null, 2));
    return;
  }

  if (args.ledgerMode === "update") {
    const attemptNumber = args.attemptNumber
      ?? await latestAttemptNumber(args.ledgerPath, args.assignmentId);
    if (!attemptNumber) {
      throw new Error(`Unable to locate an attempt for ${args.assignmentId}.`);
    }
    const common = {
      ledgerPath: args.ledgerPath,
      assignmentId: args.assignmentId,
      attemptNumber,
      artifactDir: args.artifacts || undefined,
      model: args.model,
      reasoning: args.reasoning,
    };
    const result = args.discoveryRun
      ? await updateAttemptFromDiscoveryRun({
        ...common,
        discoveryRun: JSON.parse(await readFile(args.discoveryRun, "utf8")),
      })
      : await updateAttempt({
        ...common,
        status: args.status || undefined,
        nextAction: args.nextAction,
        blocker: args.blocker,
        promotionRef: args.promotionRef,
        reviewRef: args.reviewRef,
        mergeRef: args.mergeRef,
        actor: args.workerId,
      });
    console.log(JSON.stringify(result.assignment, null, 2));
    return;
  }

  const spec = resolveLedgerSpec(await buildSpecInventory(), args);
  if (!spec) {
    throw new Error("Could not resolve ledger assignment from --portal or --spec-id.");
  }
  const selectedRecipe = args.recipe || await selectRecipe(spec, null);
  if (!selectedRecipe) {
    throw new Error(`No checked-in recipe exists for ${spec.title}.`);
  }
  const digest = await recipeDigest(selectedRecipe);
  const endpoint = normalizeEndpoint(args.endpoint);
  const assignmentId = args.assignmentId
    || `${spec.specId}-${createHash("sha256")
      .update(`${spec.specId}|${endpoint}|${digest}|${args.phase}|${args.priority}`)
      .digest("hex")
      .slice(0, 16)}`;
  const result = await enqueueAssignment({
    ledgerPath: args.ledgerPath,
    assignmentId,
    specId: spec.specId,
    portal: spec.title,
    recipePath: selectedRecipe,
    recipeDigest: digest,
    endpoint,
    profile: args.profile,
    phase: args.phase,
    priority: args.priority,
    artifactDir: args.artifacts,
    model: args.model,
    reasoning: args.reasoning,
    workerId: args.workerId,
  });
  console.log(JSON.stringify(result.assignment, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.ledgerMode) {
    await runLedgerMode(args);
    return;
  }
  const specInventory = await buildSpecInventory();
  const specRecord = resolvePortal(specInventory, args.portal);
  const recipePath = await selectRecipe(specRecord, args.recipe, { requireNovelty: args.requireNovelty });
  const brief = buildBrief(specRecord, recipePath);
  if (!recipePath) {
    const runState = {
      artifacts: args.artifacts,
      brief,
      phase: args.phase,
      startedAt: new Date().toISOString(),
      status: "blocked",
      blocker: {
        code: "recipe-missing",
        detail: `No checked-in deterministic recipe exists for ${specRecord.title}.`,
        remediation: "Add and validate a bounded checked-in recipe before allocating a browser or ledger attempt.",
      },
    };
    await writeRunState(args.artifacts, runState);
    process.exitCode = 2;
    console.error(JSON.stringify(runState, null, 2));
    return;
  }

  let selectedRecipe;
  let actionBudget;
  let noveltyPlan;
  let recipeSafety;
  try {
    const sourceRecipe = JSON.parse(await readFile(recipePath, "utf8"));
    if (sourceRecipe?.capturePrerequisite?.status === "blocked") {
      const error = new Error(`capture prerequisite is not satisfied; ${sourceRecipe.capturePrerequisite.nextRequirement}`);
      error.code = "capture-prerequisite-missing";
      error.blocker = {
        reason: sourceRecipe.capturePrerequisite.reason,
        remediation: sourceRecipe.capturePrerequisite.nextRequirement,
      };
      throw error;
    }
    if (args.requireNovelty && sourceRecipe?.noveltyStatus?.status === "satisfied" && !sourceRecipe?.noveltyFrontier) {
      buildNoveltyPlan(sourceRecipe, { required: true });
    }
    selectedRecipe = prepareRecipeForRun(sourceRecipe, args.variables);
    validateSelectedRecipeTarget(selectedRecipe);
    recipeSafety = await inspectRecipeSafety(recipePath, args);
    if (!recipeSafety.safe) {
      const error = new Error("The selected recipe contains active-looking actions outside the authorized operation plan.");
      error.code = "unsafe-recipe-action";
      error.blocker = { unsafeActions: recipeSafety.unsafeActions };
      throw error;
    }
    const derivedBaseline = deriveNoveltyBaseline(await loadBundledSpecification(path.resolve(repoRoot, specRecord.specPath)));
    noveltyPlan = buildNoveltyPlan(selectedRecipe, { required: args.requireNovelty, derivedBaseline });
    actionBudget = buildActionBudget(selectedRecipe);
  } catch (error) {
    const runState = {
      artifacts: args.artifacts,
      brief,
      phase: args.phase,
      startedAt: new Date().toISOString(),
      status: "blocked",
      blocker: {
        code: ["action-budget-exceeded", "capture-prerequisite-missing", "novelty-frontier-invalid", "recipe-target-invalid", "unsafe-recipe-action"].includes(error?.code)
          ? error.code
          : /operation|approval|ceiling/iu.test(error?.message ?? "")
            ? "mutation-authorization-required"
            : "recipe-invalid",
        detail: error instanceof Error ? error.message : String(error),
        ...(error?.blocker ?? {}),
      },
    };
    await writeRunState(args.artifacts, runState);
    process.exitCode = 2;
    console.error(JSON.stringify(runState, null, 2));
    return;
  }

  if (args.phase === "plan") {
    const workerPacket = await buildCaptureWorkerPacket({
      actionBudget,
      args,
      brief,
      noveltyPlan,
      recipePath,
    });
    console.log(JSON.stringify(
      args.workerPacketOnly
        ? workerPacket
        : { actionBudget, brief, noveltyPlan, status: "planned", workerPacket },
      null,
      2,
    ));
    return;
  }

  let ledgerAssignment = null;
  try {
    if (["all", "capture"].includes(args.phase)) {
      const existingArtifacts = await findExistingCaptureArtifacts(args.artifacts);
      if (existingArtifacts.length > 0) {
        const runState = {
          artifacts: args.artifacts,
          brief,
          phase: args.phase,
          startedAt: new Date().toISOString(),
          status: "blocked",
          blocker: {
            code: "artifacts-not-empty",
            detail: "Capture requires a fresh artifact directory to prevent stale traffic and authentication state from contaminating the run.",
            existingArtifacts: existingArtifacts.slice(0, 20),
            remediation: "Choose a new empty artifact directory and rerun the command.",
          },
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }
    }
    if (["all", "capture"].includes(args.phase)) {
      args.actionBudget = actionBudget;
      const cdp = await preflightRecipeTarget({
        recipe: selectedRecipe,
        endpoint: args.cdpEndpoint,
        expectedProduct: args.expectedProduct,
      });
      args.targetId = cdp.target.id;
      args.preflightAlignment = cdp.alignment;
      if (args.requireNovelty && selectedRecipe.frontierControlReadiness) {
        const readinessArgs = [
          "--recipe",
          recipePath,
          "--target-id",
          args.targetId,
          "--cdp-endpoint",
          args.cdpEndpoint,
          "--frontier-readiness-only",
        ];
        if (recipeSafety.activeOperationPlan) {
          readinessArgs.push(
            "--operation-ceiling",
            args.operationCeiling,
            "--operation-approval-digest",
            args.operationApprovalDigest,
          );
        }
        for (const variable of args.variables) {
          readinessArgs.push("--var", variable);
        }
        const readinessTimeoutMs = Number(selectedRecipe.frontierControlReadiness.timeoutMs) || 15000;
        try {
          args.frontierReadiness = await runNodeJson(
            path.join(repoRoot, "tools", "cdp-deep-capture.mjs"),
            readinessArgs,
            frontierReadinessSupervisionTimeout(readinessTimeoutMs, args.supervisionTimeoutMs),
            { cwd: repoRoot },
          );
        } catch (error) {
          if (error instanceof ProcessSupervisionTimeoutError) {
            error.code = "frontier-control-timeout";
            error.blocker = {
              timeoutMs: error.timeoutMs,
              remediation: "Preserve the browser owner, verify the target remains responsive, and retry readiness without consuming a ledger attempt.",
            };
          }
          throw error;
        }
        if (args.frontierReadiness.status !== "ready") {
          const readinessError = new Error("Required frontier controls are not uniquely available on the authenticated target.");
          readinessError.code = "frontier-control-unavailable";
          readinessError.blocker = {
            frontierReadiness: args.frontierReadiness,
            remediation: "Wait for an authenticated target inventory with each exact required control uniquely present; do not spend a capture attempt on generic child-frame traffic.",
          };
          throw readinessError;
        }
      }
    }
    ledgerAssignment = await prepareLedgerAttempt(args, specRecord, recipePath);
  } catch (error) {
    const runState = {
      artifacts: args.artifacts,
      brief,
      phase: args.phase,
      actionBudget,
      startedAt: new Date().toISOString(),
      status: "blocked",
      blocker: {
        code: ["action-budget-exceeded", "frontier-control-timeout", "frontier-control-unavailable"].includes(error?.code)
          ? error.code
          : error?.message?.startsWith("browser-cdp-preflight:") ? "browser-cdp-preflight-failed" : "ledger-dispatch-conflict",
        detail: error instanceof Error ? error.message : String(error),
        ...(error?.blocker ?? {}),
        ...(error?.message?.startsWith("browser-cdp-preflight:")
          ? { remediation: "Keep the owner alive for manual sign-in or page repair, rerun the read-only preflight, and mutate the ledger only after it succeeds." }
          : {}),
      },
    };
    await writeRunState(args.artifacts, runState);
    process.exitCode = 2;
    console.error(JSON.stringify(runState, null, 2));
    return;
  }

  const runState = {
    artifacts: args.artifacts,
    brief,
    phase: args.phase,
    noveltyPlan,
    activeOperationAuthorization: {
      ceiling: args.operationCeiling,
      approvalDigest: args.operationApprovalDigest,
      operationId: recipeSafety.activeOperationPlan?.operationId ?? null,
    },
    startedAt: new Date().toISOString(),
    status: "running",
    preflight: args.preflightAlignment
      ? {
          authenticationStatus: "verified",
          portalTargetStatus: "authenticated-portal-ready",
          featureTargetStatus: args.preflightAlignment.targetState,
          status: args.preflightAlignment.status,
          targetId: args.preflightAlignment.targetId,
          entryUrl: args.preflightAlignment.entryUrl ?? null,
          ...(args.frontierReadiness ? { frontierReadiness: args.frontierReadiness } : {}),
        }
      : null,
    ledger: ledgerAssignment
      ? {
          assignmentId: args.assignmentId,
          assignmentDigest: args.assignmentDigest,
          attemptNumber: args.attemptNumber,
          ledgerPath: args.ledgerPath,
        }
      : { mode: "legacy-no-ledger" },
  };
  let captureCompleteness = await inspectCaptureCompleteness(args.artifacts);
  runState.capture = captureCompleteness;
  runState.recovery = args.phase === "analyze"
    ? { status: "recovered-analysis", source: "immutable-artifacts" }
    : null;
  let interactionHealth = null;
  let interactionHealthStatus = null;
  let captureSummary = null;
  let noveltyAssessment = null;
  let graphTelemetry = null;
  let graphResearchQueue = null;
  let graphTelemetryAssessment = null;
  let mutationBlocker = null;
  let mutationSummary = null;
  let actionResults = [];
  let recipe = null;
  try {
    actionResults = JSON.parse(await readFile(path.join(args.artifacts, "action-results.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  try {
    const sourceRecipe = JSON.parse(await readFile(recipePath, "utf8"));
    recipe = prepareRecipeForRun(sourceRecipe, args.variables);
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  await persistTerminalRun(args, runState);

  try {
    if (["all", "capture"].includes(args.phase)) {
      if (!recipePath) {
        runState.status = "blocked";
        runState.blocker = {
          code: "recipe-missing",
          detail: `No checked-in capture recipe exists for ${specRecord.title}.`,
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }

      if (!recipeSafety.safe) {
        runState.status = "blocked";
        runState.blocker = {
          code: "unsafe-recipe-action",
          detail: "The selected recipe contains active-looking actions.",
          unsafeActions: recipeSafety.unsafeActions,
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }

      const captureArgs = [
        "--recipe",
        recipePath,
        "--out",
        args.artifacts,
      ];
      if (args.targetId) {
        captureArgs.push("--target-id", args.targetId);
      }
      captureArgs.push("--cdp-endpoint", args.cdpEndpoint);
      if (args.seedArtifacts) {
        captureArgs.push("--seed-artifacts", args.seedArtifacts);
      }
      if (args.bundleCacheDir) {
        captureArgs.push("--bundle-cache-dir", args.bundleCacheDir);
      }
      if (recipeSafety.activeOperationPlan) {
        captureArgs.push(
          "--operation-ceiling",
          args.operationCeiling,
          "--operation-approval-digest",
          args.operationApprovalDigest,
        );
      }
      for (const variable of args.variables) {
        captureArgs.push("--var", variable);
      }
      captureArgs.push("--finalization-timeout-ms", String(args.supervisionTimeoutMs));
      try {
        await runNode(
          path.join(repoRoot, "tools", "cdp-deep-capture.mjs"),
          captureArgs,
          args.captureSupervisionTimeoutMs,
          { cwd: repoRoot },
        );
      } catch (error) {
        const failurePath = path.join(args.artifacts, "capture-failure.json");
        let failure = null;
        try {
          failure = JSON.parse(await readFile(failurePath, "utf8"));
        } catch (readError) {
          if (readError?.code !== "ENOENT" && !(readError instanceof SyntaxError)) {
            throw readError;
          }
        }
        const parentSupervision = error instanceof ProcessSupervisionTimeoutError;
        if (!failure && parentSupervision) {
          failure = await writeParentSupervisionFailure(failurePath, error.timeoutMs, error.message);
        }
        runState.status = "blocked";
        runState.blocker = {
          code: parentSupervision
            ? "capture-process-timeout"
            : failure?.phase ? "capture-phase-timeout" : "capture-process-failed",
          detail: failure?.detail ?? error.message,
          phase: failure?.phase ?? "parent-supervision",
          timeoutMs: failure?.timeoutMs ?? args.captureSupervisionTimeoutMs,
          remediation: "Preserve the immutable artifacts and retry into a new empty directory, optionally seeded from this capture.",
        };
        mutationSummary = await readVerifiedMutationSummary(args.artifacts, {
          activeOperationPlan: recipeSafety.activeOperationPlan,
        });
        runState.activeOperations = mutationSummary;
        const mutationFailureBlocker = operationBlocker(mutationSummary, {
          captureFailure: runState.blocker,
        });
        if (mutationFailureBlocker) runState.blocker = mutationFailureBlocker;
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }

      captureSummary = JSON.parse(
        await readFile(path.join(args.artifacts, "summary.json"), "utf8"),
      );
      mutationSummary = await readVerifiedMutationSummary(args.artifacts, {
        activeOperationPlan: recipeSafety.activeOperationPlan,
        captureSummary,
      });
      runState.activeOperations = mutationSummary;
      mutationBlocker = operationBlocker(mutationSummary);
      captureCompleteness = await inspectCaptureCompleteness(args.artifacts);
      runState.capture = captureCompleteness;
      interactionHealth = await readInteractionHealth(args.artifacts);
      runState.interactionHealth = interactionHealth;
      interactionHealthStatus = buildInteractionHealthStatus(captureCompleteness, interactionHealth);
      runState.interactionHealthStatus = interactionHealthStatus;
      const authenticationBarrier = await detectAuthenticationBarrier(
        args.artifacts,
        captureSummary,
      );
      if (authenticationBarrier) {
        runState.status = "blocked";
        runState.blocker = {
          code: "authentication-required",
          ...authenticationBarrier,
          remediation:
            "Authenticate in the existing remote-debugging browser profile, choose a new empty artifact directory, and rerun the command.",
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }
      if (captureSummary.actionValidation?.requiredActionFailureCount > 0) {
        runState.status = "blocked";
        runState.blocker = {
          code: "recipe-actions-incomplete",
          detail: "One or more required recipe actions did not complete.",
          failures: captureSummary.actionValidation.requiredActionFailures,
          remediation:
            "Repair the checked-in recipe or confirm the portal route is available, then rerun with a new empty artifact directory.",
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }
      if (interactionHealth?.accounting?.consistent === false) {
        runState.status = "blocked";
        runState.interactionHealth = interactionHealth;
        runState.blocker = {
          code: "interaction-health-accounting-inconsistent",
          detail: "The canonical interaction-health accounting contains an inconsistency.",
          inconsistency: interactionHealth?.accounting?.inconsistency ?? null,
          remediation:
            "Regenerate the summary from the immutable action-results artifact and resolve the accounting mismatch before continuing.",
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }
      if (interactionHealth?.recommendation?.recommended === true) {
        runState.status = "blocked";
        runState.interactionHealth = interactionHealth;
        runState.blocker = {
          code: "interaction-health-escalation",
          detail: "The canonical interaction-health signal escalated unhealthy navigation; capture cannot be treated as success.",
          remediation:
            "Repair the navigation recipe or confirm the portal route is available, then rerun with a new empty artifact directory.",
        };
        await persistTerminalRun(args, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }
    }

    if (args.phase === "analyze" && !interactionHealth) {
      interactionHealth = await readInteractionHealth(args.artifacts);
      runState.interactionHealth = interactionHealth;
    }
    if (args.phase === "analyze") {
      interactionHealthStatus = buildInteractionHealthStatus(captureCompleteness, interactionHealth);
      runState.interactionHealthStatus = interactionHealthStatus;
    }
    if (args.phase === "analyze" && interactionHealth?.accounting?.consistent === false) {
      runState.status = "blocked";
      runState.blocker = {
        code: "interaction-health-accounting-inconsistent",
        detail: "The canonical interaction-health accounting contains an inconsistency.",
        inconsistency: interactionHealth.accounting.inconsistency,
        remediation:
          "Regenerate the summary from the immutable action-results artifact and resolve the accounting mismatch before continuing.",
      };
      await persistTerminalRun(args, runState);
      process.exitCode = 2;
      console.error(JSON.stringify(runState, null, 2));
      return;
    }
    if (args.phase === "analyze" && interactionHealth?.recommendation?.recommended === true) {
      runState.status = "blocked";
      runState.blocker = {
        code: "interaction-health-escalation",
        detail: "The canonical interaction-health signal escalated unhealthy navigation; analysis cannot be treated as success.",
        remediation:
          "Repair the navigation recipe or confirm the portal route is available, then rerun with a new empty artifact directory.",
      };
      await persistTerminalRun(args, runState);
      process.exitCode = 2;
      console.error(JSON.stringify(runState, null, 2));
      return;
    }

    if (["all", "analyze"].includes(args.phase)) {
      if (actionResults.length === 0) {
        try {
          actionResults = JSON.parse(await readFile(path.join(args.artifacts, "action-results.json"), "utf8"));
        } catch (error) {
          if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
      }
      if (!captureSummary) {
        try {
          captureSummary = JSON.parse(await readFile(path.join(args.artifacts, "summary.json"), "utf8"));
        } catch (error) {
          if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
      }
      mutationSummary = mutationSummary ?? await readVerifiedMutationSummary(args.artifacts, {
        activeOperationPlan: recipeSafety.activeOperationPlan,
        captureSummary,
      });
      runState.activeOperations = mutationSummary;
      if (mutationSummary?.safeToContinue === false && !mutationBlocker) {
        mutationBlocker = operationBlocker(mutationSummary);
      }
      let analysisApiRecords = [];
      try {
        analysisApiRecords = JSON.parse(await readFile(path.join(args.artifacts, "api-records.json"), "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      const graphContracts = args.graphContractDisabled ? null : await loadGraphContractCache(args.graphContractDir);
      graphTelemetry = buildGraphTelemetry({ apiRecords: analysisApiRecords, ...(graphContracts ?? {}) });
      validateGraphTelemetry(graphTelemetry);
      await writeFile(
        path.join(args.artifacts, "graph-telemetry.json"),
        `${JSON.stringify(graphTelemetry, null, 2)}\n`,
        "utf8",
      );
      graphResearchQueue = buildGraphResearchQueue(graphTelemetry);
      validateGraphResearchQueue(graphResearchQueue);
      await writeFile(
        path.join(args.artifacts, "graph-research-queue.json"),
        `${JSON.stringify(graphResearchQueue, null, 2)}\n`,
        "utf8",
      );
      graphTelemetryAssessment = evaluateGraphTelemetryObjectives({
        objectives: recipe.graphTelemetryObjectives,
        telemetry: graphTelemetry,
      });
      if (graphTelemetryAssessment) {
        await writeFile(
          path.join(args.artifacts, "graph-telemetry-assessment.json"),
          `${JSON.stringify(graphTelemetryAssessment, null, 2)}\n`,
          "utf8",
        );
      }
      const candidateQueuePath = path.join(args.artifacts, "candidate-queue.json");
      const candidateHandoffPath = path.join(args.artifacts, "candidate-handoff.json");
      const candidateArgs = [
        "--spec",
        specRecord.specId,
        "--artifacts",
        args.artifacts,
        "--output",
        candidateQueuePath,
      ];
      if (args.includeAdjacent) {
        candidateArgs.push("--include-adjacent");
      }
      try {
        await runNode(
          path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
          candidateArgs,
          args.supervisionTimeoutMs,
        );
      } catch (error) {
        if (captureCompleteness.captureComplete === false && captureCompleteness.captureStatus === "missing-minimum-artifacts") {
          const emptyQueue = {
            schemaVersion: 1,
            candidates: [],
            suppressedCandidates: [],
            scopeReviewCandidates: [],
            summary: { missingMinimumArtifacts: true },
          };
          await writeFile(candidateQueuePath, `${JSON.stringify(emptyQueue, null, 2)}\n`, "utf8");
        } else {
          throw error;
        }
      }
      const candidateQueue = JSON.parse(await readFile(candidateQueuePath, "utf8"));
      const saturation = evaluateDiscoverySaturation({
        activeOperations: mutationSummary,
        actionResults,
        candidateQueue,
        capture: captureCompleteness,
        interactionHealth,
        interactionHealthStatus,
        recipe,
        requiredActionFailures: captureSummary?.actionValidation?.requiredActionFailures ?? [],
        enabled: args.saturation,
        applyStop: args.applySaturationStop,
      });
      const candidateHandoff = buildCandidateHandoff({
        candidateQueue,
        interactionHealth,
        interactionHealthStatus,
        metadataNextPass: brief.metadataNextPass,
        graphTelemetry,
        graphTelemetryAssessment,
        graphResearchQueue,
        mutationSummary,
        recovery: captureCompleteness,
        specId: specRecord.specId,
        specTitle: specRecord.title,
        saturation,
      });
      if (noveltyPlan) {
        noveltyAssessment = evaluateNoveltyEvidence({
          actionResults,
          apiRecords: analysisApiRecords,
          candidateHandoff,
          noveltyPlan,
          recipe,
        });
        await writeFile(
          path.join(args.artifacts, "novelty-assessment.json"),
          `${JSON.stringify(noveltyAssessment, null, 2)}\n`,
          "utf8",
        );
        if (noveltyAssessment.status === "no-novelty") {
          candidateHandoff.recommendedNextAction = {
            code: "revise-frontier-after-no-novelty",
            summary: "The capture completed but materialized no qualifying frontier novelty; do not report discovery success or repeat the same recipe unchanged.",
          };
        } else if (noveltyAssessment.status === "no-target-signal") {
          candidateHandoff.recommendedNextAction = {
            code: "repair-frontier-after-no-target-signal",
            summary: "The capture artifacts are complete but no expected target route materialized; treat the run as a no-op, keep the frontier open, and repair its deterministic action before any retry.",
          };
        } else if (noveltyAssessment.status === "frontier-incomplete") {
          candidateHandoff.recommendedNextAction = {
            code: "repair-incomplete-frontier",
            summary: "At least one planned frontier target was not attempted; preserve partial evidence and repair the deterministic recipe before any retry.",
          };
        }
      }
      await writeFile(
        candidateHandoffPath,
        `${JSON.stringify(candidateHandoff, null, 2)}\n`,
        "utf8",
      );
      if (args.groupedHandoffDir) {
        await writePartitionedCandidateHandoff(candidateHandoff, args.groupedHandoffDir);
      }
      runState.candidateCounts = candidateHandoff.counts;
      runState.recommendedNextAction = candidateHandoff.recommendedNextAction;
      runState.novelty = noveltyAssessment;
      runState.graphTelemetryAssessment = graphTelemetryAssessment;
      runState.saturation = saturation;
    }

    if (mutationBlocker) {
      runState.status = "blocked";
      runState.blocker = mutationBlocker;
    } else if (noveltyAssessment && noveltyAssessment.status !== "productive") {
      runState.status = "blocked";
      runState.blocker = {
        code: noveltyAssessment.status,
        detail: noveltyAssessment.status === "no-novelty"
          ? "The capture completed but produced no qualifying delta from the checked-in novelty baseline."
          : noveltyAssessment.status === "no-target-signal"
            ? "The capture artifacts completed, but no expected frontier route materialized; this run cannot satisfy or retire the frontier."
            : "The capture did not attempt every checked-in frontier target successfully.",
        remediation: runState.recommendedNextAction?.summary ?? "Revise the frontier before another live allocation.",
      };
    } else if (graphTelemetryAssessment && graphTelemetryAssessment.status !== "productive") {
      runState.status = "blocked";
      runState.blocker = {
        code: graphTelemetryAssessment.status,
        detail: `The Graph telemetry crawl did not satisfy: ${graphTelemetryAssessment.failedChecks.join(", ")}.`,
        remediation: "Preserve the evidence and revise the exact read-only Graph telemetry states before retrying.",
      };
    } else {
      runState.status = "completed";
    }
    runState.interactionHealth = interactionHealth;
    runState.interactionHealthStatus = interactionHealthStatus ?? (
      interactionHealth
        ? { available: true, reason: null, source: "summary-and-action-results" }
        : { available: false, reason: "canonical-health-unavailable", source: "capture-artifacts" }
    );
    if (args.saturation && !runState.saturation) {
      runState.saturation = evaluateDiscoverySaturation({
        activeOperations: mutationSummary,
        actionResults,
        capture: captureCompleteness,
        interactionHealth,
        interactionHealthStatus: runState.interactionHealthStatus,
        recipe,
        requiredActionFailures: captureSummary?.actionValidation?.requiredActionFailures ?? [],
        enabled: args.saturation,
        applyStop: args.applySaturationStop,
      });
    }
    runState.completedAt = new Date().toISOString();
    runState.outputs = {
      candidateQueue: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "candidate-queue.json")
        : null,
      candidateHandoff: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "candidate-handoff.json")
        : null,
      groupedCandidateHandoff: args.groupedHandoffDir
        ? path.join(args.groupedHandoffDir, "manifest.json")
        : null,
      graphTelemetry: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "graph-telemetry.json")
        : null,
      graphResearchQueue: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "graph-research-queue.json")
        : null,
      graphTelemetryAssessment: graphTelemetryAssessment
        ? path.join(args.artifacts, "graph-telemetry-assessment.json")
        : null,
      noveltyAssessment: noveltyPlan && ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "novelty-assessment.json")
        : null,
      runState: path.join(args.artifacts, "discovery-run.json"),
    };
    await persistTerminalRun(args, runState);
    console.log(JSON.stringify(runState, null, 2));
  } catch (error) {
    runState.status = "failed";
    runState.completedAt = new Date().toISOString();
    runState.blocker = {
      code: error?.message?.includes("after signal") ? "pipeline-interrupted" : "pipeline-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
    await persistTerminalRun(args, runState);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
