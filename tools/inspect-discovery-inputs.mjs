import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectDiscoveryInputs } from "./discovery-evidence-inputs.mjs";
import { repoRoot } from "./spec-quality-lib.mjs";

export function parseInspectionArgs(argv) {
  const parsed = { mode: "all", output: null, specId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inline] = arg.split("=", 2);
    if (!["--spec", "--mode", "--output"].includes(flag)) throw new Error(`Unknown argument "${arg}".`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    const key = flag === "--spec" ? "specId" : flag.slice(2);
    if (parsed[key] !== null && !(key === "mode" && parsed.mode === "all")) throw new Error(`${flag} may only be specified once.`);
    parsed[key] = value;
  }
  if (!parsed.specId) throw new Error("--spec is required.");
  return parsed;
}

function assertSafeOutput(output) {
  const resolved = path.resolve(output);
  const relative = path.relative(repoRoot, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("--output must be outside the repository.");
  }
  const tempRelative = path.relative(os.tmpdir(), resolved);
  if (tempRelative.startsWith("..") || path.isAbsolute(tempRelative)) {
    throw new Error("--output must be under the operating-system temporary directory.");
  }
  return resolved;
}

export async function runInspectionCli(argv) {
  const args = parseInspectionArgs(argv);
  const result = await inspectDiscoveryInputs(args.specId, args.mode);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (!args.output) {
    process.stdout.write(output);
    return;
  }
  const outputPath = assertSafeOutput(args.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInspectionCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
