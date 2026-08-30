import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { loadGraphContractCache } from "./graph-contract-cache.mjs";
import { buildGraphTelemetry } from "./graph-telemetry.mjs";

const methods = new Set(["delete", "get", "head", "options", "patch", "post", "put"]);
const allowedTransports = new Set(["direct", "batch-member", "proxy-correlated"]);
const sensitivePattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\.onmicrosoft\.com|\bbearer\s+[A-Za-z0-9._~+/=-]{20,}|(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/iu;

function fail(errors, message) {
  errors.push(message);
}

function versionForOperation(operation) {
  const servers = operation?.servers ?? [];
  if (servers.length !== 1) return null;
  const url = String(servers[0]?.url ?? "").replace(/\/$/u, "");
  if (url === "https://graph.microsoft.com/beta") return "beta";
  if (url === "https://graph.microsoft.com/v1.0") return "v1.0";
  return null;
}

function sameValues(left, right) {
  return JSON.stringify([...new Set(left ?? [])].sort()) === JSON.stringify([...new Set(right ?? [])].sort());
}

export function validateGraphResearchSpecification({ specification, v1Contract, betaContract, manifest, evidenceRecords = {} }) {
  const errors = [];
  if (specification?.info?.title !== "Microsoft Graph Research") fail(errors, "The Graph research title must be Microsoft Graph Research.");
  const contract = specification?.["x-nodoc-graph-contract"];
  if (!contract || contract.repository !== "microsoftgraph/msgraph-metadata") fail(errors, "The pinned official Graph repository is missing.");
  if (contract?.commitSha !== manifest?.commitSha || contract?.manifestDigest !== manifest?.manifestDigest) fail(errors, "The specification Graph contract pin does not match the verified cache manifest.");
  for (const entry of manifest?.contracts ?? []) {
    const source = contract?.sources?.[entry.version];
    if (source?.sha256 !== entry.sha256 || source?.operationCount !== entry.operationCount) {
      fail(errors, `The ${entry.version} Graph source hash or operation count does not match the verified cache manifest.`);
    }
  }
  const rootServers = (specification?.servers ?? []).map((entry) => String(entry?.url ?? "").replace(/\/$/u, "")).sort();
  if (JSON.stringify(rootServers) !== JSON.stringify(["https://graph.microsoft.com/beta", "https://graph.microsoft.com/v1.0"].sort())) fail(errors, "Only the fixed direct beta and v1.0 Graph servers are allowed.");
  if (sensitivePattern.test(JSON.stringify(specification))) fail(errors, "The Graph research specification contains sensitive identity or credential material.");

  const operationIds = new Set();
  let operationCount = 0;
  for (const [pathname, pathItem] of Object.entries(specification?.paths ?? {})) {
    if (pathname.toLowerCase().includes("/$batch")) fail(errors, `${pathname}: the Graph batch wrapper cannot be promoted.`);
    if (/\/(?:apiproxy|fd)\/msgraph(?:\/|$)/iu.test(pathname)) fail(errors, `${pathname}: portal Graph proxy paths cannot be promoted into the canonical Graph research specification.`);
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!methods.has(method)) continue;
      operationCount += 1;
      const label = `${method.toUpperCase()} ${pathname}`;
      if (!operation?.operationId || operationIds.has(operation.operationId)) fail(errors, `${label}: operationId is missing or duplicated.`);
      operationIds.add(operation?.operationId);
      const version = versionForOperation(operation);
      if (!version) {
        fail(errors, `${label}: exactly one fixed direct Graph version server is required.`);
        continue;
      }
      const telemetry = buildGraphTelemetry({
        apiRecords: [{ method, url: `https://graph.microsoft.com/${version}${pathname}` }],
        v1Contract,
        betaContract,
      });
      if (telemetry.operations[0]?.contractDisposition !== "undocumented-candidate") fail(errors, `${label}: operation is present in an official pinned Graph contract.`);

      const evidence = operation["x-nodoc-graph-evidence"];
      if (!evidence || evidence.contractCommit !== manifest.commitSha || evidence.contractManifestDigest !== manifest.manifestDigest) fail(errors, `${label}: evidence is not bound to the verified Graph contract snapshot.`);
      if (evidence?.captureComplete !== true || evidence?.interactionHealth !== "healthy" || evidence?.unresolvedMutation !== false) fail(errors, `${label}: complete healthy mutation-safe capture evidence is required.`);
      if (!Number.isInteger(evidence?.evidenceCount) || evidence.evidenceCount < 2 || !Number.isInteger(evidence?.corroboratingCaptureCount) || evidence.corroboratingCaptureCount < 2) fail(errors, `${label}: at least two corroborating observations and captures are required.`);
      if (!Array.isArray(evidence?.artifactIds) || new Set(evidence.artifactIds).size < 2) fail(errors, `${label}: at least two immutable artifact identifiers are required.`);
      if (!Array.isArray(evidence?.telemetryDigests) || evidence.telemetryDigests.length < 2 || evidence.telemetryDigests.some((value) => !/^[a-f0-9]{64}$/u.test(value))) fail(errors, `${label}: valid telemetry digests are required.`);
      if (!Array.isArray(evidence?.responseShapeDigests) || evidence.responseShapeDigests.length === 0) fail(errors, `${label}: response shape evidence is required.`);
      if (method === "post" && (!Array.isArray(evidence?.requestShapeDigests) || evidence.requestShapeDigests.length === 0)) fail(errors, `${label}: POST request shape evidence is required.`);
      if (!Array.isArray(evidence?.successfulStatuses) || !evidence.successfulStatuses.some((status) => Number(status) >= 200 && Number(status) < 300)) fail(errors, `${label}: a successful live status is required.`);
      if (!Array.isArray(evidence?.transports) || evidence.transports.some((entry) => !allowedTransports.has(entry))) fail(errors, `${label}: evidence transport is missing or unsupported.`);
      const record = evidenceRecords[evidence?.evidenceRecord];
      if (!record) {
        fail(errors, `${label}: the sanitized immutable evidence record is missing.`);
      } else {
        const artifacts = record.artifacts ?? [];
        const operationKey = `${version} ${method.toUpperCase()} ${pathname}`;
        if (record.operationKey !== operationKey || record.contractCommit !== manifest.commitSha || record.contractManifestDigest !== manifest.manifestDigest) fail(errors, `${label}: the evidence record is bound to a different operation or contract.`);
        if (artifacts.length < 2 || artifacts.some((entry) => entry.captureComplete !== true || entry.interactionAccountingConsistent !== true || entry.unresolvedMutation !== false)) fail(errors, `${label}: every evidence artifact must be complete, consistently accounted, and mutation-safe.`);
        if (artifacts.some((entry) => !/^[a-f0-9]{64}$/u.test(entry.graphTelemetryFileSha256 ?? "") || !/^[a-f0-9]{64}$/u.test(entry.telemetryDigest ?? ""))) fail(errors, `${label}: evidence artifact hashes are missing or invalid.`);
        if (artifacts.some((entry) => !(entry.successfulTransports ?? []).includes("direct") || !(entry.statuses ?? []).some((status) => status >= 200 && status < 300))) fail(errors, `${label}: each corroborating artifact requires a successful direct observation.`);
        const values = (field) => artifacts.flatMap((entry) => entry[field] ?? []);
        if (!sameValues(evidence?.artifactIds, artifacts.map((entry) => entry.artifactId))) fail(errors, `${label}: artifact identifiers do not match the evidence record.`);
        if (evidence?.evidenceCount !== artifacts.length || evidence?.corroboratingCaptureCount !== artifacts.length) fail(errors, `${label}: evidence and corroborating capture counts do not match the evidence record.`);
        if (!sameValues(evidence?.telemetryDigests, artifacts.map((entry) => entry.telemetryDigest))) fail(errors, `${label}: telemetry digests do not match the evidence record.`);
        if (!sameValues(evidence?.operationIds, artifacts.map((entry) => entry.operationId))) fail(errors, `${label}: operation identifiers do not match the evidence record.`);
        if (!sameValues(evidence?.requestShapeDigests, values("requestShapeDigests"))) fail(errors, `${label}: request shapes do not match the evidence record.`);
        if (!sameValues(evidence?.responseShapeDigests, values("responseShapeDigests"))) fail(errors, `${label}: response shapes do not match the evidence record.`);
        if (!sameValues(evidence?.successfulStatuses, values("statuses"))) fail(errors, `${label}: successful statuses do not match the evidence record.`);
        if (!sameValues(evidence?.corroboratingRequestTransports, values("corroboratingRequestTransports"))) fail(errors, `${label}: corroborating request transports do not match the evidence record.`);
      }
      const successfulResponses = Object.entries(operation.responses ?? {}).filter(([status]) => /^2\d\d$/u.test(status));
      const documentedSuccess = successfulResponses.length > 0;
      if (!documentedSuccess) fail(errors, `${label}: a successful response contract is required.`);
      if (successfulResponses.some(([, response]) => !response?.content?.["application/json"]?.schema)) fail(errors, `${label}: every successful response requires an application/json schema.`);
      if (method === "post" && !operation?.requestBody?.content?.["application/json"]?.schema) fail(errors, `${label}: POST requires an application/json request schema.`);

      const safety = operation["x-nodoc-operation-safety"];
      if (!["read-only", "read-like-post", "mutation-verified"].includes(safety?.class)) fail(errors, `${label}: operation safety class is missing or invalid.`);
      if (method === "post" && !["read-like-post", "mutation-verified"].includes(safety?.class)) fail(errors, `${label}: POST must be classified as read-like or mutation-verified.`);
      if (safety?.class === "mutation-verified" && (safety?.verifiedRestoration !== true || evidence?.unresolvedMutation !== false)) fail(errors, `${label}: mutation promotion requires verified restoration.`);
    }
  }
  if (operationCount === 0) fail(errors, "The Graph research specification must contain at least one admitted operation.");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return { operationCount, contractCommit: manifest.commitSha };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const contractDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "nodoc-cdp", "graph-contract")
    : null;
  if (!contractDir) throw new Error("LOCALAPPDATA is required to locate the verified Graph contract cache.");
  const loaded = await loadGraphContractCache(contractDir);
  if (!loaded) throw new Error("Verified Graph contract cache is missing; run npm run sync:graph-contract.");
  const manifest = JSON.parse(await readFile(path.join(contractDir, "manifest.json"), "utf8"));
  const specificationRoot = path.join(repoRoot, "specifications", "nodoc-graph-research");
  const specification = YAML.parse(await readFile(path.join(specificationRoot, "specification", "openapi.yml"), "utf8"));
  const evidenceRecords = {};
  for (const pathItem of Object.values(specification.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!methods.has(method)) continue;
      const relative = operation?.["x-nodoc-graph-evidence"]?.evidenceRecord;
      if (!relative || evidenceRecords[relative]) continue;
      const resolved = path.resolve(specificationRoot, relative);
      if (!resolved.startsWith(`${specificationRoot}${path.sep}`)) throw new Error(`Evidence record escapes the Graph research specification root: ${relative}`);
      evidenceRecords[relative] = JSON.parse(await readFile(resolved, "utf8"));
    }
  }
  const result = validateGraphResearchSpecification({
    specification,
    v1Contract: loaded.v1Contract,
    betaContract: loaded.betaContract,
    manifest,
    evidenceRecords,
  });
  console.log(`Validated ${result.operationCount} undocumented Graph research operation(s) against ${result.contractCommit}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
