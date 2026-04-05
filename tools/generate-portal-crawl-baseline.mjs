import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  crawlMetadataByTitle,
  hasRecorderSupport,
  readRecorderPortalIds,
} from "./portal-discovery-metadata.mjs";
import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";

const crawlPriorityOrder = new Map([
  ["high", 0],
  ["medium", 1],
  ["diff-first", 2],
]);

function formatList(values, limit = 4) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }

  if (values.length <= limit) {
    return values.join(", ");
  }

  return `${values.slice(0, limit).join(", ")} (+${values.length - limit} more)`;
}

function buildRows(specInventory, recorderPortalIds) {
  return specInventory
    .map((spec) => {
      const metadata = crawlMetadataByTitle[spec.title];
      if (!metadata) {
        throw new Error(`Missing crawl metadata for "${spec.title}"`);
      }

      return {
        title: spec.title,
        specId: spec.specId,
        operations: spec.operationCount,
        recorderSupported: hasRecorderSupport(spec.specId, recorderPortalIds),
        crawlPriority: metadata.crawlPriority,
        nextPass: metadata.nextPass,
        portalUrl: metadata.portalUrl,
        apiHosts: spec.serverUrls,
        pathPrefixes: spec.pathPrefixes,
        authModel: metadata.authModel,
        reason: metadata.reason,
        specPath: spec.specPath,
      };
    })
    .sort((left, right) => {
      const leftPriority = crawlPriorityOrder.get(left.crawlPriority) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = crawlPriorityOrder.get(right.crawlPriority) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      if (left.recorderSupported !== right.recorderSupported) {
        return Number(left.recorderSupported) - Number(right.recorderSupported);
      }

      return left.title.localeCompare(right.title);
    });
}

async function main() {
  const specInventory = await buildSpecInventory();
  const recorderSource = await readFile(
    path.join(repoRoot, "tools", "nodoc-recorder", "background.js"),
    "utf8",
  );
  const recorderPortalIds = readRecorderPortalIds(recorderSource);
  const rows = buildRows(specInventory, recorderPortalIds);
  const jsonMode = process.argv.includes("--json");

  if (jsonMode) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.table(rows.map((row) => ({
    title: row.title,
    ops: row.operations,
    recorder: row.recorderSupported ? "yes" : "no",
    priority: row.crawlPriority,
    next: row.nextPass,
    apiHosts: formatList(row.apiHosts, 2),
    pathPrefixes: formatList(row.pathPrefixes),
  })));

  const recorderGaps = rows
    .filter((row) => !row.recorderSupported)
    .map((row) => row.title);
  console.log(
    `Recorder gaps (${recorderGaps.length}): ${recorderGaps.join(", ") || "none"}`,
  );
}

await main();
