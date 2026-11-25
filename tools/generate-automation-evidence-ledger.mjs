import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpecRouteInventory, repoRoot } from "./spec-quality-lib.mjs";
import { normalizeAutomationEvidence, evidenceDimensions } from "./operation-behavior.mjs";

export function buildAutomationEvidenceLedger(inventory) {
  return {
    schemaVersion: 1,
    dimensions: evidenceDimensions,
    caveat: "Evidence assertions, not presentation maturity or permission to execute. Unknown does not mean unsupported. Dates are evidence dates, not a claim of current verification.",
    specifications: inventory.map((spec) => ({
      specId: spec.specId,
      operations: spec.operations.map((operation) => {
        const evidence = normalizeAutomationEvidence(operation.operationContext?.automationEvidence ?? {});
        return {
          method: operation.method,
          path: operation.path,
          serverUrls: operation.serverUrls,
          // Omitted dimensions use this explicit default; keep the all-unknown catalog small.
          defaultState: "unknown",
          evidence: Object.fromEntries(Object.entries(evidence).filter(([, value]) => value.state !== "unknown" || Object.keys(value).length > 1)),
        };
      }).sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)),
    })).sort((a, b) => a.specId.localeCompare(b.specId)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--json", "--output"].includes(arg) && args[args.indexOf(arg) - 1] !== "--output")) throw new Error("Expected --json or --output <path>.");
  const outputIndex = args.indexOf("--output");
  if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith("--"))) throw new Error("--output requires a path.");
  const ledger = buildAutomationEvidenceLedger(await buildSpecRouteInventory());
  if (args.includes("--json")) console.log(JSON.stringify(ledger, null, 2));
  else {
    const output = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : path.join(repoRoot, "src/generated/automationEvidenceLedger.json");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(`Wrote ${path.relative(repoRoot, output)}`);
  }
}
