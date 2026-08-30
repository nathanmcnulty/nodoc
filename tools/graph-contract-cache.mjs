import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadGraphContractCache(contractDir) {
  if (!contractDir) return null;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(contractDir, "manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Graph contract manifest is unreadable: ${error.message}`);
  }
  if (manifest?.schemaVersion !== 2 || !/^[a-f0-9]{40}$/u.test(String(manifest.commitSha || ""))) {
    throw new Error("Graph contract manifest is invalid; rerun npm run sync:graph-contract.");
  }
  const manifestCore = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifestDigest"));
  const expectedManifestDigest = createHash("sha256").update(`${JSON.stringify(manifestCore)}\n`, "utf8").digest("hex");
  if (manifest.manifestDigest !== expectedManifestDigest) throw new Error("Graph contract manifest digest mismatch.");
  const loaded = {};
  for (const entry of manifest.contracts ?? []) {
    if (!["beta", "v1.0"].includes(entry.version) || !entry.indexFilename || !/^[a-f0-9]{64}$/u.test(String(entry.indexSha256 || ""))) {
      throw new Error("Graph contract manifest has an invalid index entry.");
    }
    const bytes = await readFile(path.join(contractDir, entry.indexFilename));
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (actualDigest !== entry.indexSha256) throw new Error(`Graph ${entry.version} operation index digest mismatch.`);
    const index = JSON.parse(bytes.toString("utf8"));
    if (index.version !== entry.version || index.sourceSha256 !== entry.sha256 || index.operations?.length !== entry.operationCount) {
      throw new Error(`Graph ${entry.version} operation index does not match its manifest.`);
    }
    loaded[entry.version] = index;
  }
  if (!loaded.beta || !loaded["v1.0"]) throw new Error("Graph contract cache is incomplete.");
  return {
    betaContract: loaded.beta,
    v1Contract: loaded["v1.0"],
    contractSnapshot: {
      repository: manifest.repository,
      commitSha: manifest.commitSha,
      manifestDigest: manifest.manifestDigest,
    },
  };
}
