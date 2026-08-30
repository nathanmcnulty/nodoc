import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { buildGraphContractIndex } from "./graph-telemetry.mjs";

const repository = "microsoftgraph/msgraph-metadata";
const maxContractBytes = 80 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "nodoc-graph-contract-sync" } });
  if (!response.ok) throw new Error(`Graph contract source returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxContractBytes) throw new Error("Graph contract source has an invalid byte length.");
  return bytes;
}

export async function syncGraphContracts({ outputDir, fetchImpl = fetch } = {}) {
  if (!outputDir) throw new Error("Graph contract synchronization requires outputDir.");
  const commitResponse = await fetchImpl(`https://api.github.com/repos/${repository}/commits/master`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "nodoc-graph-contract-sync" },
  });
  if (!commitResponse.ok) throw new Error(`Graph metadata commit lookup returned HTTP ${commitResponse.status}.`);
  const commit = await commitResponse.json();
  if (!/^[a-f0-9]{40}$/u.test(String(commit?.sha || ""))) throw new Error("Graph metadata commit lookup returned an invalid SHA.");
  const resolvedOutput = path.resolve(outputDir);
  await mkdir(resolvedOutput, { recursive: true });
  const contracts = [];
  for (const version of ["v1.0", "beta"]) {
    const sourceUrl = `https://raw.githubusercontent.com/${repository}/${commit.sha}/openapi/${version}/openapi.yaml`;
    const bytes = await fetchBytes(fetchImpl, sourceUrl);
    const filename = `graph-${version}-openapi.yaml`;
    await writeFile(path.join(resolvedOutput, filename), bytes);
    const sourceSha256 = sha256(bytes);
    const index = buildGraphContractIndex(YAML.parse(bytes.toString("utf8")), { version, sourceSha256 });
    const indexBytes = Buffer.from(`${JSON.stringify(index)}\n`, "utf8");
    const indexFilename = `graph-${version}-operations.json`;
    await writeFile(path.join(resolvedOutput, indexFilename), indexBytes);
    contracts.push({
      byteLength: bytes.length,
      filename,
      indexFilename,
      indexSha256: sha256(indexBytes),
      operationCount: index.operations.length,
      sha256: sourceSha256,
      sourceUrl,
      version,
    });
  }
  const manifestCore = {
    schemaVersion: 2,
    repository,
    commitSha: commit.sha,
    contracts,
  };
  const manifest = { ...manifestCore, manifestDigest: sha256(Buffer.from(`${JSON.stringify(manifestCore)}\n`, "utf8")) };
  await writeFile(path.join(resolvedOutput, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseArgs(argv) {
  const index = argv.indexOf("--output-dir");
  if (index < 0 || !argv[index + 1]) throw new Error("Use --output-dir <directory-outside-repository>.");
  return { outputDir: argv[index + 1] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await syncGraphContracts(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
