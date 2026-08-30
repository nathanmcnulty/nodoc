import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateActiveOperationPlan } from "./portal-discovery-operation-safety.mjs";

function parseArgs(argv) {
  const args = { operationId: null, recipePath: null, variables: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--recipe" && next) {
      args.recipePath = path.resolve(next);
      index += 1;
    } else if (argument === "--operation" && next) {
      args.operationId = next.trim();
      index += 1;
    } else if (argument === "--var" && next) {
      const separator = next.indexOf("=");
      if (separator <= 0) throw new Error(`Invalid --var value ${JSON.stringify(next)}.`);
      args.variables[next.slice(0, separator).trim()] = next.slice(separator + 1);
      index += 1;
    }
  }
  if (!args.recipePath) throw new Error("Missing --recipe <path>.");
  if (!args.operationId) throw new Error("Missing --operation <operation-id>.");
  return args;
}

function expand(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/gu, (_match, name) => {
      if (!Object.prototype.hasOwnProperty.call(variables, name)) {
        throw new Error(`Recipe variable ${JSON.stringify(name)} was not provided.`);
      }
      return String(variables[name]);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => expand(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expand(entry, variables)]),
    );
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recipe = JSON.parse(await readFile(args.recipePath, "utf8"));
  const expanded = expand(recipe, { ...(recipe.variables ?? {}), ...args.variables });
  const input = (expanded.activeOperations ?? [])
    .find((operation) => operation?.operationId === args.operationId);
  if (!input) throw new Error(`No active operation named ${JSON.stringify(args.operationId)} exists in the recipe.`);
  const plan = validateActiveOperationPlan(input, { actions: expanded.actions });
  console.log(JSON.stringify({
    operationId: plan.operationId,
    ceiling: plan.mode,
    approvalDigest: plan.approvalDigest,
    steps: plan.steps,
    scalar: plan.scalar ?? null,
    concurrency: plan.concurrency ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
