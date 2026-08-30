import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import {
  buildGraphResearchQueue,
  buildGraphTelemetry,
  validateGraphResearchQueue,
  validateGraphTelemetry,
} from "./graph-telemetry.mjs";
import { loadGraphContractCache } from "./graph-contract-cache.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (["--artifacts", "--api-records", "--contract-dir", "--contract-v1", "--contract-beta", "--output"].includes(value)) {
      args[value.slice(2).replaceAll("-", "_")] = argv[index + 1];
      index += 1;
    }
  }
  if (!args.artifacts && !args.api_records) throw new Error("Use --artifacts <directory> or --api-records <file> [--contract-dir <verified-cache> | --contract-v1 <yaml-or-index> --contract-beta <yaml-or-index>] [--output <json>].");
  return args;
}

async function readContract(value) {
  if (!value) return null;
  const text = await readFile(path.resolve(value), "utf8");
  return path.extname(value).toLowerCase() === ".json" ? JSON.parse(text) : YAML.parse(text);
}

const args = parseArgs(process.argv.slice(2));
const apiRecordsPath = path.resolve(args.api_records ?? path.join(args.artifacts, "api-records.json"));
const cachedContracts = args.contract_dir ? await loadGraphContractCache(path.resolve(args.contract_dir)) : null;
if (args.contract_dir && !cachedContracts) throw new Error("Graph contract cache is missing; run npm run sync:graph-contract first.");
const result = buildGraphTelemetry({
  apiRecords: JSON.parse(await readFile(apiRecordsPath, "utf8")),
  v1Contract: cachedContracts?.v1Contract ?? await readContract(args.contract_v1),
  betaContract: cachedContracts?.betaContract ?? await readContract(args.contract_beta),
  contractSnapshot: cachedContracts?.contractSnapshot ?? null,
});
validateGraphTelemetry(result);
const outputText = `${JSON.stringify(result, null, 2)}\n`;
if (args.output) {
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, outputText, "utf8");
  const queue = buildGraphResearchQueue(result);
  validateGraphResearchQueue(queue);
  await writeFile(path.join(path.dirname(output), "graph-research-queue.json"), `${JSON.stringify(queue, null, 2)}\n`, "utf8");
}
process.stdout.write(outputText);
