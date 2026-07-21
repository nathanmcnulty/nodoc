import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyGetProbeUrl } from "./discovery-safety.mjs";
import {
  captureRecipesByTitle,
  crawlMetadataByTitle,
} from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";

const validPhases = new Set(["all", "analyze", "capture", "plan"]);

function parseArgs(argv) {
  const args = {
    artifacts: null,
    includeAdjacent: false,
    json: false,
    phase: "all",
    portal: null,
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
    } else if (argument === "--artifacts" && next) {
      args.artifacts = path.resolve(next);
      index += 1;
    } else if (argument === "--recipe" && next) {
      args.recipe = path.resolve(next);
      index += 1;
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
    nextPass: metadata?.nextPass ?? "unknown",
    pathPrefixes: specRecord.pathPrefixes,
    portal: specRecord.title,
    portalUrl: metadata?.portalUrl ?? null,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
      await writeRunState(args.artifacts, runState);
      process.exitCode = 2;
      console.error(JSON.stringify(runState, null, 2));
      return;
    }
  }

  await writeRunState(args.artifacts, runState);

  try {
    if (["all", "capture"].includes(args.phase)) {
      if (!recipePath) {
        runState.status = "blocked";
        runState.blocker = {
          code: "recipe-missing",
          detail: `No checked-in capture recipe exists for ${specRecord.title}.`,
        };
        await writeRunState(args.artifacts, runState);
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
        await writeRunState(args.artifacts, runState);
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
        await writeRunState(args.artifacts, runState);
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
        await writeRunState(args.artifacts, runState);
        process.exitCode = 2;
        console.error(JSON.stringify(runState, null, 2));
        return;
      }
    }

    if (["all", "analyze"].includes(args.phase)) {
      const candidateArgs = [
        "--spec",
        specRecord.specId,
        "--artifacts",
        args.artifacts,
        "--output",
        path.join(args.artifacts, "candidate-queue.json"),
      ];
      if (args.includeAdjacent) {
        candidateArgs.push("--include-adjacent");
      }
      await runNode(
        path.join(repoRoot, "tools", "generate-crawl-candidates.mjs"),
        candidateArgs,
      );
    }

    runState.status = "completed";
    runState.completedAt = new Date().toISOString();
    runState.outputs = {
      candidateQueue: ["all", "analyze"].includes(args.phase)
        ? path.join(args.artifacts, "candidate-queue.json")
        : null,
      runState: path.join(args.artifacts, "discovery-run.json"),
    };
    await writeRunState(args.artifacts, runState);
    console.log(JSON.stringify(runState, null, 2));
  } catch (error) {
    runState.status = "failed";
    runState.completedAt = new Date().toISOString();
    runState.blocker = {
      code: "pipeline-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
    await writeRunState(args.artifacts, runState);
    throw error;
  }
}

await main();
