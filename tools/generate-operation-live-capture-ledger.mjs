import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildOperationLiveCaptureLedger,
  repoRoot,
} from "./spec-quality-lib.mjs";

const defaultOutput = path.join(
  repoRoot,
  "src",
  "generated",
  "operationLiveCaptureLedger.json",
);

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
  const ledger = await buildOperationLiveCaptureLedger();

  if (args.json) {
    console.log(JSON.stringify(ledger, null, 2));
    return;
  }

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, args.output).replaceAll("\\", "/")}`);
}

await main();
