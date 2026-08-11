import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSpecRouteInventory,
  canonicalOperationKey,
  reconcileOperationSets,
  repoRoot,
} from "./spec-quality-lib.mjs";

const outputPath = path.join(
  repoRoot,
  "src",
  "generated",
  "defenderOperationReconciliation.json",
);

const shadowed = {
  operationId: "CloudApps.GetSettings",
  method: "GET",
  path: "/mcas/cas/api/v1/settings",
  key: canonicalOperationKey({ method: "GET", path: "/mcas/cas/api/v1/settings" }),
  reason: "Duplicate source declaration; root-indexed Configuration.GetCloudAppsSettings owns the route.",
  owner: "Configuration.GetCloudAppsSettings",
};

const intentionallyFiltered = [
  {
    operationId: "Configuration.GetDataExportSettings",
    method: "GET",
    path: "/mtp/wdatpApi/dataexportsettings",
    key: canonicalOperationKey({ method: "GET", path: "/mtp/wdatpApi/dataexportsettings" }),
    reason: "Export-related route is excluded from generated request coverage pending explicit safety and ownership review.",
  },
  {
    operationId: "CloudApps.ListSubnets",
    method: "POST",
    path: "/mcas/cas/api/v1/subnet",
    key: canonicalOperationKey({ method: "POST", path: "/mcas/cas/api/v1/subnet" }),
    reason: "Adjacent Defender for Cloud Apps route; POST semantics require explicit ownership and safety evidence before emission.",
  },
  {
    operationId: "CloudApps.GetAppConnectorsCountByStatus",
    method: "GET",
    path: "/mcas/cas/api/v1/app_connectors/dashboard/get_app_connectors_count_by_status",
    key: canonicalOperationKey({ method: "GET", path: "/mcas/cas/api/v1/app_connectors/dashboard/get_app_connectors_count_by_status" }),
    reason: "Adjacent Defender for Cloud Apps route without promoted checked-in request evidence; retain adjacency without blind emission.",
  },
  {
    operationId: "CloudApps.GetDiscoveryEncryptionSettings",
    method: "GET",
    path: "/mcas/cas/api/v1/discovery/get_encryption_settings",
    key: canonicalOperationKey({ method: "GET", path: "/mcas/cas/api/v1/discovery/get_encryption_settings" }),
    reason: "Adjacent Defender for Cloud Apps route without promoted checked-in request evidence; retain adjacency without blind emission.",
  },
  {
    operationId: "CloudApps.GetDiscoveryUserEnrichment",
    method: "GET",
    path: "/mcas/cas/api/v1/tenant_config/resolveDiscoveryUserWithAAD",
    key: canonicalOperationKey({ method: "GET", path: "/mcas/cas/api/v1/tenant_config/resolveDiscoveryUserWithAAD" }),
    reason: "Adjacent Defender for Cloud Apps route without promoted checked-in request evidence; retain adjacency without blind emission.",
  },
  {
    operationId: "SentinelPrecision.ListSubscriptions",
    method: "GET",
    path: "/apiproxy/arm/subscriptions",
    key: canonicalOperationKey({ method: "GET", path: "/apiproxy/arm/subscriptions" }),
    reason: "SentinelPrecision/ARM route is adjacent Sentinel ownership; do not promote it into Defender Postman coverage without Sentinel evidence.",
  },
  {
    operationId: "PortalServices.GetMedeinaDataShareSettings",
    method: "GET",
    path: "/medeina/settings/datashare",
    key: canonicalOperationKey({ method: "GET", path: "/medeina/settings/datashare" }),
    reason: "Medeina/Security Copilot route is explicitly outside Defender ownership.",
  },
  {
    operationId: "PortalServices.GetMedeinaCapacities",
    method: "GET",
    path: "/medeina/usage/capacities",
    key: canonicalOperationKey({ method: "GET", path: "/medeina/usage/capacities" }),
    reason: "Medeina/Security Copilot route is explicitly outside Defender ownership.",
  },
];

const aliases = [
  {
    operationId: "SentinelPrecision.GetOperationsManagementSolution",
    method: "GET",
    path: "/arm/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.OperationsManagement/solutions/SecurityInsights({solutionName})",
    key: canonicalOperationKey({ method: "GET", path: "/arm/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.OperationsManagement/solutions/SecurityInsights({solutionName})" }),
    aliasPath: "/apiproxy/arm/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.OperationsManagement/solutions/SecurityInsights({solutionName})",
    reason: "Checked-in promoted evidence uses the /apiproxy/arm transport form for the same SentinelPrecision operation; /apiproxy is an existing Defender host route prefix, not a separate operation.",
  },
];

const inventory = await buildSpecRouteInventory();
const defender = inventory.find((entry) => entry.specId === "defender-xdr");
if (!defender) {
  throw new Error("Missing defender-xdr route inventory.");
}

const collection = JSON.parse(await readFile(
  path.join(repoRoot, "postman", "collections", "defender.collection.json"),
  "utf8",
));
const report = reconcileOperationSets(defender.operations, collection, {
  intentionallyFiltered,
  aliases,
});
const unresolved = report.unresolved;
const result = {
  schemaVersion: 1,
  specId: "defender-xdr",
  effectiveOpenApiOperationCount: defender.operations.length,
  sourceDeclarationCount: defender.operations.length + 1,
  postmanRequestCount: report.postmanRequestCount,
  normalizedMethodPathParity: report.emitted.length,
  emitted: report.emitted,
  counts: {
    emitted: report.emitted.length,
    intentionallyFiltered: report.counts.intentionallyFiltered,
    postmanFiltered: report.postmanFiltered.length,
    orphaned: report.orphaned.length,
    duplicateShadowed: 1,
    aliases: report.counts.aliases,
    unresolved: unresolved.length,
  },
  duplicateShadowed: [shadowed],
  intentionallyFiltered: report.intentionallyFiltered,
  postmanFiltered: report.postmanFiltered,
  aliases: report.aliases,
  orphaned: report.orphaned,
  unresolved,
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);
