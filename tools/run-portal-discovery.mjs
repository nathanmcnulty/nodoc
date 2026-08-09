import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCandidateHandoff } from "./discovery-candidate-handoff.mjs";
import { aggregateInteractionHealth, sanitizeInteractionHealth } from "./discovery-capture-policy.mjs";
import { classifyGetProbeUrl } from "./discovery-safety.mjs";
import {
  captureRecipesByTitle,
  crawlMetadataByTitle,
} from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";
import {
  claimAssignment,
  defaultLedgerPath,
  enqueueAssignment,
  ensureLedgerFileReady,
  getLedgerViewFromFile,
  resumeAttempt,
  updateAttempt,
  updateAttemptFromDiscoveryRun,
} from "./portal-discovery-ledger.mjs";

const validPhases = new Set(["all", "analyze", "capture", "plan"]);

function parseArgs(argv) {
  const args = {
    artifacts: null,
    includeAdjacent: false,
    json: false,
    phase: "all",
    ledgerMode: null,
    ledgerPath: defaultLedgerPath,
    assignmentId: null,
    attemptNumber: null,
    endpoint: null,
    priority: "normal",
    model: null,
    reasoning: null,
    workerId: null,
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
    variables: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--include-adjacent") {
      args.includeAdjacent = true;
    } else if (argument === "--json") {
      args.json = true;
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
    } else if ((argument === "--attempt" || argument === "--attempt-number") && next) {
      args.attemptNumber = Number(next);
      index += 1;
    } else if (argument === "--endpoint" && next) {
      args.endpoint = next;
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
    } else if (argument === "--var" && next) {
      args.variables.push(next);
      index += 1;
    }
  }

  if (args.profile !== "bounded") {
    throw new Error(`Invalid --profile "${args.profile}". Only the bounded profile is currently supported.`);
  }
  if (!args.ledgerMode) {
    if (!args.portal) {
      throw new Error("Missing required --portal <title-or-spec-id>.");
    }
    if (!validPhases.has(args.phase)) {
      throw new Error(`Invalid --phase "${args.phase}". Use plan, capture, analyze, or all.`);
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

async function selectRecipe(specRecord, explicitRecipe) {
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
  for (const recipePath of allowedRecipes) {
    try {
      const recipe = JSON.parse(await readFile(recipePath, "utf8"));
      if (recipe.portal === specRecord.title) {
        matchingRecipes.push(recipePath);
      }
    } catch {
      // Recipe parsing is validated separately before capture.
    }
  }
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

async function inspectRecipeSafety(recipePath) {
  const recipe = JSON.parse(await readFile(recipePath, "utf8"));
  const unsafeActionPattern =
    /(?:^|[\s/_-])(?:delete|execute|export|generate|invoke|log-?out|publish|remove|run|save|sign-?out|start|submit|sync|trigger)(?:$|[\s/_.?&=-])/iu;
  const unsafeActions = [];

  for (const action of recipe.actions ?? []) {
    const rawType = typeof action === "string"
      ? action.split("=", 1)[0]
      : String(action?.type || "");
    const value = typeof action === "string"
      ? action.slice(action.indexOf("=") + 1)
      : String(action?.value || "");
    const type = rawType.replace(/-(?:root|iframe)$/u, "");
    if (type.startsWith("click") && unsafeActionPattern.test(value)) {
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
  if (!args.assignmentId) {
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
    if (error?.code === "ENOENT") {
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

async function runNode(scriptPath, argumentsList) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argumentsList], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `${path.basename(scriptPath)} exited after signal ${signal}.`
          : `${path.basename(scriptPath)} exited with code ${code}.`,
      ));
    });
  });
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
      endpoint: args.endpoint,
      phase: args.phase,
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
  const assignmentId = args.assignmentId
    || `${spec.specId}-${createHash("sha256")
      .update(`${spec.specId}|${args.endpoint}|${digest}|${args.phase}|${args.priority}`)
      .digest("hex")
      .slice(0, 16)}`;
  const result = await enqueueAssignment({
    ledgerPath: args.ledgerPath,
    assignmentId,
    specId: spec.specId,
    portal: spec.title,
    recipePath: selectedRecipe,
    recipeDigest: digest,
    endpoint: args.endpoint,
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
  const recipePath = await selectRecipe(specRecord, args.recipe);
  const brief = buildBrief(specRecord, recipePath);

  if (args.phase === "plan") {
    console.log(JSON.stringify({ brief, status: "planned" }, null, 2));
    return;
  }

  const runState = {
    artifacts: args.artifacts,
    brief,
    phase: args.phase,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  let interactionHealth = null;

  if (["all", "capture"].includes(args.phase)) {
    const existingArtifacts = await findExistingCaptureArtifacts(args.artifacts);
    if (existingArtifacts.length > 0) {
      runState.status = "blocked";
      runState.blocker = {
        code: "artifacts-not-empty",
        detail: "Capture requires a fresh artifact directory to prevent stale traffic and authentication state from contaminating the run.",
        existingArtifacts: existingArtifacts.slice(0, 20),
        remediation: "Choose a new empty artifact directory and rerun the command.",
      };
      await persistTerminalRun(args, runState);
      process.exitCode = 2;
      console.error(JSON.stringify(runState, null, 2));
      return;
    }
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

      const recipeSafety = await inspectRecipeSafety(recipePath);
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

      const cdp = await preflightCdp();
      if (!cdp.available) {
        runState.status = "blocked";
        runState.blocker = {
          code: "browser-cdp-unavailable",
          detail: cdp.detail,
          remediation:
            "Open an authenticated Edge/Chrome session with remote debugging on 127.0.0.1:9222, then rerun the same command.",
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
      if (args.seedArtifacts) {
        captureArgs.push("--seed-artifacts", args.seedArtifacts);
      }
      for (const variable of args.variables) {
        captureArgs.push("--var", variable);
      }
      await runNode(path.join(repoRoot, "tools", "cdp-deep-capture.mjs"), captureArgs);

      const captureSummary = JSON.parse(
        await readFile(path.join(args.artifacts, "summary.json"), "utf8"),
      );
      interactionHealth = await readInteractionHealth(args.artifacts);
      runState.interactionHealth = interactionHealth;
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
      await runNode(
        path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
        candidateArgs,
      );
      const candidateQueue = JSON.parse(await readFile(candidateQueuePath, "utf8"));
      const candidateHandoff = buildCandidateHandoff({
        candidateQueue,
        interactionHealth,
        metadataNextPass: brief.metadataNextPass,
        specId: specRecord.specId,
        specTitle: specRecord.title,
      });
      await writeFile(
        candidateHandoffPath,
        `${JSON.stringify(candidateHandoff, null, 2)}\n`,
        "utf8",
      );
      runState.candidateCounts = candidateHandoff.counts;
      runState.recommendedNextAction = candidateHandoff.recommendedNextAction;
    }

    runState.status = "completed";
    runState.interactionHealth = interactionHealth;
    runState.completedAt = new Date().toISOString();
    runState.outputs = {
      candidateQueue: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "candidate-queue.json")
        : null,
      candidateHandoff: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "candidate-handoff.json")
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
    await writeRunState(args.artifacts, runState);
    throw error;
  }
}

await main();
