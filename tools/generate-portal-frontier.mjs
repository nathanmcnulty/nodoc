import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { compileOfflineFrontier, validateOfflineFrontier } from "./portal-discovery-frontier.mjs";
import { captureRecipesByTitle } from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, loadBundledSpecification, repoRoot } from "./spec-quality-lib.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--approved-only") {
      args.approved_only = true;
      continue;
    }
    if (["--spec", "--recipe", "--coverage", "--prior-artifact", "--candidate-handoff", "--output"].includes(value)) {
      args[value.slice(2).replaceAll("-", "_")] = argv[index + 1];
      index += 1;
    }
  }
  if (!args.spec) throw new Error("Use --spec <spec-id> [--recipe <path>] [--prior-artifact <json>] [--candidate-handoff <json>] [--output <json>].");
  return args;
}

async function readJsonIf(value, fallback) {
  return value ? JSON.parse(await readFile(path.resolve(value), "utf8")) : fallback;
}

const args = parseArgs(process.argv.slice(2));
const inventory = await buildSpecInventory();
const spec = inventory.find((entry) => entry.specId === args.spec);
if (!spec) throw new Error(`Unknown specification ${args.spec}.`);
const recipePath = args.recipe ?? captureRecipesByTitle[spec.title]?.[0];
const recipe = await readJsonIf(recipePath ? path.join(repoRoot, recipePath) : null, {});
const coverageLedger = await readJsonIf(args.coverage ?? path.join(repoRoot, "src", "generated", "portalCoverageLedger.json"), []);
const coverage = coverageLedger.find((entry) => entry.specId === spec.specId) ?? {};
const result = compileOfflineFrontier({
  specId: spec.specId,
  specification: await loadBundledSpecification(spec.specPath),
  coverage,
  recipe,
  priorArtifacts: await readJsonIf(args.prior_artifact, {}),
  candidateHandoff: await readJsonIf(args.candidate_handoff, {}),
});
validateOfflineFrontier(result);
const output = args.approved_only
  ? {
      schemaVersion: 1,
      specId: result.specId,
      projection: "approved-only",
      frontierSetId: result.frontierSetId,
      frontierSetDigest: result.frontierSetDigest,
      measurements: result.measurements,
      items: result.items.filter((item) => item.status === "approved"),
    }
  : result;
const text = `${JSON.stringify(output, null, 2)}\n`;
if (args.output) {
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, text, "utf8");
}
process.stdout.write(text);
