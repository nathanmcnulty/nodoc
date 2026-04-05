import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildSpecInventory, repoRoot } from "./spec-quality-lib.mjs";

const crawlMetadataByTitle = {
  Defender: {
    portalUrl: "https://security.microsoft.com",
    authModel: "Portal session cookie (`sccauth`)",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Largest surface in the repo; use capture-vs-spec diffs before another broad crawl.",
  },
  "Entra B2C": {
    portalUrl: "https://entra.microsoft.com",
    authModel: "Azure AD bearer token + `tenantId` context",
    crawlPriority: "medium",
    nextPass: "full-layered-crawl",
    reason: "Feature-gated small surface with recorder support but thin observed coverage.",
  },
  "Entra IAM": {
    portalUrl: "https://entra.microsoft.com",
    authModel: "Delegated OAuth2 + `X-Ms-Client-Request-Id`",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Large supported surface; only targeted unresolved families should drive follow-up.",
  },
  "Entra IDGov": {
    portalUrl: "https://entra.microsoft.com",
    authModel: "Azure AD bearer token",
    crawlPriority: "medium",
    nextPass: "full-layered-crawl",
    reason: "Small access-review surface that likely needs deeper workflow-state coverage.",
  },
  "Entra IGA": {
    portalUrl: "https://entra.microsoft.com",
    authModel: "Azure AD bearer token",
    crawlPriority: "medium",
    nextPass: "full-layered-crawl",
    reason: "Small governance surface; deeper entitlement and lifecycle navigation is still likely useful.",
  },
  "Entra PIM": {
    portalUrl: "https://entra.microsoft.com",
    authModel: "Azure AD bearer token",
    crawlPriority: "medium",
    nextPass: "full-layered-crawl",
    reason: "Supported in the recorder, but the modeled role-management surface is still narrow.",
  },
  Exchange: {
    portalUrl: "https://admin.exchange.microsoft.com",
    authModel: "Portal session cookie + same-origin `x-requested-with`",
    crawlPriority: "high",
    nextPass: "normalized-family-diff",
    reason: "Recorder support now covers the Exchange beta host; use capture-vs-spec diffs to target remaining unresolved families.",
  },
  "Intune Autopatch": {
    portalUrl: "https://intune.microsoft.com",
    authModel: "Portal bearer token + x-ms portal headers",
    crawlPriority: "high",
    nextPass: "full-layered-crawl",
    reason: "High-signal report blades already proved valuable, and recorder support now enables broader workflow-state coverage.",
  },
  "Intune Portal": {
    portalUrl: "https://intune.microsoft.com",
    authModel: "Portal bearer token + same-origin portal context",
    crawlPriority: "high",
    nextPass: "full-layered-crawl",
    reason: "Very small same-origin surface with recorder support now available; deeper navigation should improve observed coverage.",
  },
  "M365 Admin": {
    portalUrl: "https://admin.cloud.microsoft",
    authModel: "Portal session cookie + custom admin headers",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Large admin surface with meaningful debt; follow diffs rather than recrawling blindly.",
  },
  "M365 Apps Config": {
    portalUrl: "https://config.office.com",
    authModel: "Portal bearer token + diagnostic headers",
    crawlPriority: "high",
    nextPass: "full-layered-crawl",
    reason: "Recorder support now exists for the configuration surface, so the next step is deeper workflow coverage rather than recorder expansion.",
  },
  "M365 Apps Inventory": {
    portalUrl: "https://config.office.com",
    authModel: "Portal bearer token + diagnostic headers",
    crawlPriority: "high",
    nextPass: "full-layered-crawl",
    reason: "Recorder support now exists for the inventory host, and the current surface is still relatively small enough to justify a deeper crawl.",
  },
  "M365 Apps Services": {
    portalUrl: "https://config.office.com",
    authModel: "Portal bearer token + diagnostic headers",
    crawlPriority: "high",
    nextPass: "full-layered-crawl",
    reason: "Recorder support now exists for the shared services host, so use a broader crawl to expand M365 Apps discovery.",
  },
  "Power Platform": {
    portalUrl: "https://admin.powerplatform.microsoft.com",
    authModel: "Portal bearer tokens + service-specific audiences",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Recent exhaustive crawl already covered many host families, so follow-up should be gap-driven.",
  },
  Purview: {
    portalUrl: "https://purview.microsoft.com",
    authModel: "Portal session cookie (`sccauth`)",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Proxy and same-origin surfaces are already split; diff unresolved families before another broad run.",
  },
  "Purview Portal": {
    portalUrl: "https://purview.microsoft.com",
    authModel: "Portal session cookie (`sccauth`) + same-origin portal context",
    crawlPriority: "medium",
    nextPass: "full-layered-crawl",
    reason: "Recorder support exists, but the same-origin portal surface is still very small.",
  },
  SharePoint: {
    portalUrl: "https://{tenant}-admin.sharepoint.com",
    authModel: "Portal session cookie (`FedAuth`) + SharePoint form digest",
    crawlPriority: "medium",
    nextPass: "full-layered-crawl",
    reason: "Recorder coverage exists, but deeper list/detail and settings pivots are still plausible gaps.",
  },
  Teams: {
    portalUrl: "https://admin.teams.microsoft.com",
    authModel: "Portal bearer token + same-origin portal context",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Deep crawl already landed; remaining work should be driven by unresolved route families.",
  },
};

const recorderIdAliasesBySpecId = {
  "defender-xdr": ["defender"],
  "exchange-beta": ["exchange-beta"],
  "ibiza-iam": ["entra-iam"],
};

const crawlPriorityOrder = new Map([
  ["high", 0],
  ["medium", 1],
  ["diff-first", 2],
]);

function readRecorderPortalIds(source) {
  return new Set(
    Array.from(source.matchAll(/\bid:\s*'([^']+)'/gu), ([, portalId]) => portalId),
  );
}

function hasRecorderSupport(specId, recorderPortalIds) {
  const candidateIds = recorderIdAliasesBySpecId[specId] ?? [specId];
  return candidateIds.some((candidateId) => recorderPortalIds.has(candidateId));
}

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
