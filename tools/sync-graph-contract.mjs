import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function validateCommit(commitSha) {
  if (!/^[a-f0-9]{40}$/u.test(String(commitSha ?? ""))) throw new Error("Graph metadata commit must be an exact lowercase SHA.");
  return commitSha;
}

async function loadContractPin(pinnedSpec) {
  const specification = YAML.parse(await readFile(pinnedSpec, "utf8"));
  const pin = specification?.["x-nodoc-graph-contract"];
  if (!pin || pin.repository !== repository) throw new Error("Pinned Graph contract repository is invalid.");
  validateCommit(pin.commitSha);
  if (!/^[a-f0-9]{64}$/u.test(String(pin.manifestDigest ?? ""))) throw new Error("Pinned Graph contract manifest digest is invalid.");
  if (!pin.sources || Object.keys(pin.sources).sort().join(",") !== "beta,v1.0") throw new Error("Pinned Graph contract requires exactly beta and v1.0 sources.");
  for (const version of ["v1.0", "beta"]) {
    const source = pin.sources[version];
    if (!/^[a-f0-9]{64}$/u.test(String(source?.sha256 ?? "")) || !Number.isSafeInteger(source?.operationCount) || source.operationCount < 0) {
      throw new Error(`Pinned Graph ${version} source hash or operation count is invalid.`);
    }
  }
  return pin;
}

export async function syncGraphContracts({ outputDir, fetchImpl = fetch, pinnedSpec = null, commitSha = null } = {}) {
  if (!outputDir) throw new Error("Graph contract synchronization requires outputDir.");
  const pin = pinnedSpec ? await loadContractPin(pinnedSpec) : null;
  if (commitSha !== null) validateCommit(commitSha);
  if (pin && commitSha !== null && pin.commitSha !== commitSha) throw new Error("Explicit Graph commit does not match the specification pin.");
  commitSha ??= pin?.commitSha ?? null;
  if (commitSha === null) {
    const commitResponse = await fetchImpl(`https://api.github.com/repos/${repository}/commits/master`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "nodoc-graph-contract-sync" },
    });
    if (!commitResponse.ok) throw new Error(`Graph metadata commit lookup returned HTTP ${commitResponse.status}.`);
    const commit = await commitResponse.json();
    commitSha = validateCommit(commit?.sha);
  }
  const resolvedOutput = path.resolve(outputDir);
  const contracts = [], outputs = [];
  for (const version of ["v1.0", "beta"]) {
    const sourceUrl = `https://raw.githubusercontent.com/${repository}/${commitSha}/openapi/${version}/openapi.yaml`;
    const bytes = await fetchBytes(fetchImpl, sourceUrl);
    const filename = `graph-${version}-openapi.yaml`;
    const sourceSha256 = sha256(bytes);
    if (pin && sourceSha256 !== pin.sources[version].sha256) throw new Error(`Pinned Graph ${version} source digest mismatch.`);
    const index = buildGraphContractIndex(YAML.parse(bytes.toString("utf8")), { version, sourceSha256 });
    if (pin && index.operations.length !== pin.sources[version].operationCount) throw new Error(`Pinned Graph ${version} operation count mismatch.`);
    const indexBytes = Buffer.from(`${JSON.stringify(index)}\n`, "utf8");
    const indexFilename = `graph-${version}-operations.json`;
    outputs.push([filename, bytes], [indexFilename, indexBytes]);
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
    commitSha,
    contracts,
  };
  const manifest = { ...manifestCore, manifestDigest: sha256(Buffer.from(`${JSON.stringify(manifestCore)}\n`, "utf8")) };
  if (pin && manifest.manifestDigest !== pin.manifestDigest) throw new Error("Pinned Graph generated manifest digest mismatch.");
  // Validate the complete pin before materializing any cache files.
  await mkdir(resolvedOutput, { recursive: true });
  for (const [filename, bytes] of outputs) await writeFile(path.join(resolvedOutput, filename), bytes);
  await writeFile(path.join(resolvedOutput, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function parseGraphContractArgs(argv) {
  const result = {};
  const options = { "--output-dir": "outputDir", "--pinned-spec": "pinnedSpec", "--commit": "commitSha" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = Object.hasOwn(options, argv[index]) ? options[argv[index]] : null, value = argv[index + 1];
    if (!key || !value || value.startsWith("--") || result[key] !== undefined) throw new Error("Use --output-dir <directory> with optional --pinned-spec <specification> or --commit <SHA>.");
    result[key] = value;
  }
  if (!result.outputDir) throw new Error("Use --output-dir <directory-outside-repository>.");
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await syncGraphContracts(parseGraphContractArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
