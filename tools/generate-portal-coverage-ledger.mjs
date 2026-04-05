import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildCoverageLedgerEntry,
  readRecorderPortalIds,
} from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";

const defaultOutput = path.join(repoRoot, "src", "generated", "portalCoverageLedger.json");

function parseArgs(argv) {
  const args = {
    json: false,
    output: defaultOutput,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--output" && next) {
      args.output = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      args.output = path.resolve(arg.slice("--output=".length));
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const specInventory = await buildSpecInventory();
  const recorderSource = await readFile(
    path.join(repoRoot, "tools", "nodoc-recorder", "background.js"),
    "utf8",
  );
  const recorderPortalIds = readRecorderPortalIds(recorderSource);
  const ledger = specInventory.map((specRecord) => buildCoverageLedgerEntry(specRecord, recorderPortalIds));

  if (args.json) {
    console.log(JSON.stringify(ledger, null, 2));
    return;
  }

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, args.output).replaceAll("\\", "/")}`);
}

await main();
