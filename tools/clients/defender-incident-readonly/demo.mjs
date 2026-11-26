import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAcceptanceEvidence,
  createOfflineReadOnlyClient,
  inspectIncident,
} from "./client.mjs";
import { startSyntheticMockServer } from "./mock-server.mjs";
import { buildSpecInventory, loadBundledSpecification, repoRoot } from "../../spec-quality-lib.mjs";

const clientDirectory = path.dirname(fileURLToPath(import.meta.url));
const examplesPath = path.join(clientDirectory, "synthetic-examples.json");
const examples = JSON.parse(await readFile(examplesPath, "utf8"));
const inventory = await buildSpecInventory();
const specEntry = inventory.find((entry) => entry.specId === "defender-xdr");
if (!specEntry) throw new Error("The published Defender XDR specification is missing from the inventory.");
const specification = await loadBundledSpecification(path.resolve(repoRoot, specEntry.specPath));
const server = await startSyntheticMockServer({ specification, examples });

try {
  const client = createOfflineReadOnlyClient({ specification, baseUrl: server.baseUrl });
  const result = await inspectIncident(client, "SYNTHETIC-INCIDENT-001");
  const evidence = await buildAcceptanceEvidence(specification, [
    "Incidents.Get",
    "Incidents.GetAssociatedAlerts",
  ]);
  console.log(JSON.stringify({
    replay: "synthetic-only; not live observation evidence",
    result,
    evidence,
  }, null, 2));
} finally {
  await server.close();
}
