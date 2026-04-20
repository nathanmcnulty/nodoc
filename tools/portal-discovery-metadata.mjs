function route(method, path, note) {
  return {
    method: method.toUpperCase(),
    note,
    path,
  };
}

function uniqueOrdered(values) {
  const seen = new Set();
  const ordered = [];

  for (const value of values ?? []) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    ordered.push(value);
  }

  return ordered;
}

export const crawlMetadataByTitle = {
  Defender: {
    portalUrl: "https://security.microsoft.com",
    authModel: "Portal session cookies (`sccauth`, `XSRF-TOKEN`) + MTO routing context",
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
    reason: "Keep follow-up focused on legacy entitlement-management and other non-Graph ELM surfaces; Graph-backed Lifecycle Workflows pages are intentionally out of scope.",
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
  "Security Copilot": {
    portalUrl: "https://securitycopilot.microsoft.com",
    authModel: "Portal bearer tokens + workspace context",
    crawlPriority: "medium",
    nextPass: "normalized-family-diff",
    reason: "The first deep pass captured the main host families and read-only blades; follow-up should now stay focused on unresolved builder and safely intercepted write shapes.",
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

export const recorderIdAliasesBySpecId = {
  "defender-xdr": ["defender"],
  "exchange-beta": ["exchange-beta"],
  "ibiza-iam": ["entra-iam"],
};

export const coverageOverlayByTitle = {
  Defender: {
    seedUrls: [
      "https://security.microsoft.com",
    ],
    observedHosts: [
      "security.microsoft.com",
      "mto.security.microsoft.com",
    ],
    lastSuccessfulPassDepth: "same-origin-entity-crawl",
    knownTelemetryExclusions: [
      route("POST", "/api/log/Put", "Telemetry and performance sink confirmed during the checked-in Defender verification recipe."),
    ],
    notes: [
      "The checked-in Defender coverage includes same-origin nav, representative entity pages, and MTO-backed proxy APIs.",
      "A dedicated live verification pass confirmed Defender also emits POST /api/log/Put, so candidate diffs now suppress it as telemetry-only traffic.",
    ],
  },
  "Entra B2C": {
    seedUrls: [
      "https://entra.microsoft.com/#blade/Microsoft_AAD_IAM/CompanyRelationshipsMenuBlade/menuId/ExternalIdentitiesGettingStarted",
    ],
    observedHosts: [
      "main.b2cadmin.ext.azure.com",
    ],
    lastSuccessfulPassDepth: "deep-clickflow",
    promotedDiscoveries: [
      route("GET", "/api/userAttribute/GetAvailableOutputClaimsList", "Promoted from the External Identities deep pass."),
    ],
    notes: [
      "The current tenant returned AADB2C99039 on some External Identities surfaces, but the promoted route is still a confirmed portal endpoint.",
    ],
  },
  "Entra IAM": {
    seedUrls: [
      "https://entra.microsoft.com",
    ],
    observedHosts: [
      "entra.microsoft.com",
    ],
    lastSuccessfulPassDepth: "diff-first",
    notes: [
      "Use child reactblade iframe targets rather than only the top-level shell when planning future Entra IAM follow-up passes.",
    ],
  },
  "Entra IDGov": {
    seedUrls: [
      "https://entra.microsoft.com/#blade/Microsoft_AAD_ERM/DashboardBlade",
    ],
    observedHosts: [
      "api.accessreviews.identitygovernance.azure.com",
    ],
    lastSuccessfulPassDepth: "deep-clickflow",
    promotedDiscoveries: [
      route("GET", "/accessReviews/v2.0/approvalWorkflowProviders/{providerId}/businessFlows", "Promoted from the Programs blade."),
      route("GET", "/accessReviews/v2.0/reports", "Promoted from the Review History blade."),
    ],
  },
  "Entra IGA": {
    observedHosts: [],
    lastSuccessfulPassDepth: "scope-correction",
    notes: [
      "Lifecycle Workflows pages in the Entra admin center are Graph-backed and intentionally out of scope for the legacy Entra IGA ELM spec.",
      "Future Entra IGA discovery should stay focused on entitlement-management and other non-Graph ELM-backed surfaces.",
    ],
    openGaps: [
      "A fresh non-Graph capture pass is still needed for the legacy Entra IGA entitlement-management surfaces.",
    ],
  },
  "Entra PIM": {
    seedUrls: [
      "https://entra.microsoft.com/#blade/Microsoft_Azure_PIMCommon/CommonMenuBlade",
    ],
    observedHosts: [
      "api.azrbac.mspim.azure.com",
    ],
    lastSuccessfulPassDepth: "deep-clickflow",
    notes: [
      "The deep clickflow pass woke the PIM backend, but the resulting routes were already covered by the checked-in spec.",
    ],
  },
  Exchange: {
    seedUrls: [
      "https://admin.exchange.microsoft.com",
    ],
    observedHosts: [
      "admin.exchange.microsoft.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
  },
  "Intune Autopatch": {
    seedUrls: [
      "https://intune.microsoft.com",
    ],
    observedHosts: [
      "intune.microsoft.com",
      "services.autopatch.microsoft.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    promotedDiscoveries: [
      route("GET", "/unified-reporting/odata/1.0/AutopatchManagementStatusSummary", "Promoted from the deeper device/report interaction pass."),
    ],
  },
  "Intune Portal": {
    seedUrls: [
      "https://intune.microsoft.com",
    ],
    observedHosts: [
      "intune.microsoft.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    promotedDiscoveries: [
      route("POST", "/api/Portal/GetEarlyUserData", "Promoted from the first-pass portal bootstrap capture."),
      route("POST", "/api/Portal/GetLazyUserData", "Promoted from the first-pass portal bootstrap capture."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/api/ClientTrace", "Trace sink captured during deep portal passes."),
      route("POST", "/api/extensionclienttrace", "Extension trace sink captured during deep portal passes."),
      route("POST", "/api/extensiontelemetry", "Extension telemetry sink captured during deep portal passes."),
      route("POST", "/api/metric", "Portal metrics sink captured during deep portal passes."),
      route("POST", "/api/Telemetry", "Portal telemetry sink captured during deep portal passes."),
    ],
  },
  "M365 Apps Config": {
    seedUrls: [
      "https://config.office.com/officeSettings",
    ],
    observedHosts: [
      "config.office.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    notes: [
      "Use /officeSettings as the live seed URL; the site root is just a sign-in or landing shell.",
    ],
  },
  "M365 Apps Inventory": {
    seedUrls: [
      "https://config.office.com/officeSettings",
    ],
    observedHosts: [
      "query.inventory.insights.office.net",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
  },
  "M365 Apps Services": {
    seedUrls: [
      "https://config.office.com/officeSettings",
    ],
    observedHosts: [
      "clients.config.office.net",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
  },
  "M365 Admin": {
    seedUrls: [
      "https://admin.cloud.microsoft",
    ],
    observedHosts: [
      "admin.cloud.microsoft",
    ],
    lastSuccessfulPassDepth: "diff-first",
    notes: [
      "Drive future M365 Admin discovery from candidate diffs before another broad live crawl.",
    ],
  },
  "Power Platform": {
    seedUrls: [
      "https://admin.powerplatform.microsoft.com",
    ],
    observedHosts: [
      "admin.powerplatform.microsoft.com",
    ],
    lastSuccessfulPassDepth: "diff-first",
    notes: [
      "Recent discovery already covered many Power Platform host families, so future passes should stay gap-driven.",
    ],
  },
  Purview: {
    seedUrls: [
      "https://purview.microsoft.com",
    ],
    observedHosts: [
      "purview.microsoft.com",
    ],
    lastSuccessfulPassDepth: "diff-first",
    notes: [
      "Keep same-origin Purview Portal /api traffic distinct from the broader Purview proxy surface during follow-up diffing.",
    ],
  },
  "Purview Portal": {
    seedUrls: [
      "https://purview.microsoft.com",
    ],
    observedHosts: [
      "purview.microsoft.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    promotedDiscoveries: [
      route("GET", "/api/Auth/getSpaAuthCode", "Promoted from the live home, solution-launcher, and Data Security Investigations route pass."),
      route("POST", "/api/Report/GetReportSummaryData", "Promoted from the deeper report interaction pass."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/api/log/Put", "Telemetry and performance sink captured from multiple Purview Portal surfaces."),
    ],
    notes: [
      "A live April 2026 same-origin route pass confirmed GET /api/Auth/getSpaAuthCode during home, solution-launcher, and Data Security Investigations navigation.",
    ],
  },
  "Security Copilot": {
    seedUrls: [
      "https://securitycopilot.microsoft.com",
    ],
    observedHosts: [
      "securitycopilot.microsoft.com",
      "api.securitycopilot.microsoft.com",
      "api.securityplatform.microsoft.com",
      "us.api.securityplatform.microsoft.com",
      "prod.cds.securitycopilot.microsoft.com",
      "securitymarketplaceapi-prod.microsoft.com",
      "ecs.office.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    promotedDiscoveries: [
      route("POST", "/provisioning/create", "Promoted from the canceled create-capacity preflight, which returned OperationWhatIfSuccess without a real submission."),
      route("GET", "/pods/{podId}/workspaces/{workspaceName}/securitycopilot/agents", "Promoted from the Agents blade."),
      route("GET", "/pods/{podId}/workspaces/{workspaceName}/securitycopilot/agentdefinitions", "Promoted from the Agents blade."),
      route("GET", "/catalog/search", "Promoted from the Security Store blade."),
    ],
    notes: [
      "The documented scope intentionally excludes generic login, telemetry, and Azure Resource Manager discovery calls even though the portal used them during startup.",
      "The Build and Builder pass confirmed live configuration and requirement-check reads without submitting any agent or plugin creation changes.",
    ],
    openGaps: [
      "Builder save flows, agent setup submits, promptbook creation submits, and plugin configuration writes still need intercepted capture before promotion.",
      "The builder pass also emitted malformed empty-ID requests such as skillsets//authSettings and sessions//prompts/, which should be revisited only after capturing the same family with a concrete selected object.",
    ],
  },
  SharePoint: {
    seedUrls: [
      "https://{tenant}-admin.sharepoint.com",
    ],
    observedHosts: [
      "{tenant}-admin.sharepoint.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    notes: [
      "A live April 2026 tenant shell snapshot confirmed stable admin hash routes for #/home, #/siteManagement, #/recycleBin, #/settings, #/migration, #/classicFeatures, and #/advancedManagement.",
    ],
    openGaps: [
      "The current tenant nav also exposes SharePoint Embedded, Reports subpages such as Data access governance and OneDrive accounts, and Advanced > Script sources; those surfaces still need route-specific capture before promoting any additional same-origin /_api routes.",
    ],
  },
  Teams: {
    seedUrls: [
      "https://admin.teams.microsoft.com",
    ],
    observedHosts: [
      "admin.teams.microsoft.com",
    ],
    lastSuccessfulPassDepth: "deep-interaction",
    notes: [
      "Teams already has a deeper capture baseline in the repo, so future follow-up should remain diff-driven.",
    ],
  },
};

export const captureRecipesByTitle = {
  Defender: [
    "tools/capture-recipes/defender-telemetry-verification.json",
    "tools/capture-recipes/defender-entity-replay.json",
  ],
  "Entra B2C": [
    "tools/capture-recipes/entra-b2c-deep.json",
    "tools/capture-recipes/entra-b2c-seeded-replay.json",
  ],
  "Entra IAM": [
    "tools/capture-recipes/entra-iam-deep.json",
    "tools/capture-recipes/entra-iam-seeded-replay.json",
  ],
  "Entra IDGov": [
    "tools/capture-recipes/entra-idgov-deep.json",
    "tools/capture-recipes/entra-idgov-seeded-replay.json",
  ],
  "Entra IGA": [],
  "Entra PIM": [
    "tools/capture-recipes/entra-pim-deep.json",
    "tools/capture-recipes/entra-pim-seeded-replay.json",
  ],
  Exchange: [
    "tools/capture-recipes/exchange-deep.json",
    "tools/capture-recipes/exchange-seeded-replay.json",
  ],
  "Intune Autopatch": [
    "tools/capture-recipes/intune-deep.json",
    "tools/capture-recipes/intune-autopatch-deep.json",
    "tools/capture-recipes/intune-seeded-replay.json",
  ],
  "Intune Portal": [
    "tools/capture-recipes/intune-deep.json",
    "tools/capture-recipes/intune-portal-deep.json",
    "tools/capture-recipes/intune-seeded-replay.json",
  ],
  "M365 Admin": [
    "tools/capture-recipes/m365-admin-deep.json",
    "tools/capture-recipes/m365-admin-seeded-replay.json",
  ],
  "M365 Apps Config": [
    "tools/capture-recipes/m365-apps-deep.json",
    "tools/capture-recipes/m365-apps-config-deep.json",
    "tools/capture-recipes/m365-apps-seeded-replay.json",
  ],
  "M365 Apps Inventory": [
    "tools/capture-recipes/m365-apps-deep.json",
    "tools/capture-recipes/m365-apps-inventory-deep.json",
    "tools/capture-recipes/m365-apps-seeded-replay.json",
  ],
  "M365 Apps Services": [
    "tools/capture-recipes/m365-apps-deep.json",
    "tools/capture-recipes/m365-apps-services-deep.json",
    "tools/capture-recipes/m365-apps-seeded-replay.json",
  ],
  "Power Platform": [
    "tools/capture-recipes/power-platform-deep.json",
    "tools/capture-recipes/power-platform-seeded-replay.json",
  ],
  Purview: [
    "tools/capture-recipes/purview-deep.json",
    "tools/capture-recipes/purview-seeded-replay.json",
  ],
  "Purview Portal": [
    "tools/capture-recipes/purview-portal-deep.json",
    "tools/capture-recipes/purview-portal-seeded-replay.json",
  ],
  "Security Copilot": [
    "tools/capture-recipes/security-copilot-deep.json",
    "tools/capture-recipes/security-copilot-builder-followup.json",
    "tools/capture-recipes/security-copilot-seeded-replay.json",
  ],
  SharePoint: [
    "tools/capture-recipes/sharepoint-admin-deep.json",
    "tools/capture-recipes/sharepoint-admin-seeded-replay.json",
  ],
  Teams: [
    "tools/capture-recipes/teams-deep.json",
    "tools/capture-recipes/teams-seeded-replay.json",
  ],
};

function normalizeRouteEntry(entry) {
  return {
    method: String(entry.method || "").toUpperCase(),
    note: entry.note ?? null,
    path: entry.path,
  };
}

export function readRecorderPortalIds(source) {
  return new Set(
    Array.from(source.matchAll(/\bid:\s*'([^']+)'/gu), ([, portalId]) => portalId),
  );
}

export function hasRecorderSupport(specId, recorderPortalIds) {
  const candidateIds = recorderIdAliasesBySpecId[specId] ?? [specId];
  return candidateIds.some((candidateId) => recorderPortalIds.has(candidateId));
}

export function getCoverageOverlay(title) {
  const overlay = coverageOverlayByTitle[title];
  if (!overlay) {
    return {
      knownTelemetryExclusions: [],
      notes: [],
      observedHosts: [],
      openGaps: [],
      promotedDiscoveries: [],
      seedUrls: [],
    };
  }

  return {
    ...overlay,
    knownTelemetryExclusions: (overlay.knownTelemetryExclusions ?? []).map(normalizeRouteEntry),
    notes: [...(overlay.notes ?? [])],
    observedHosts: uniqueOrdered(overlay.observedHosts ?? []),
    openGaps: [...(overlay.openGaps ?? [])],
    promotedDiscoveries: (overlay.promotedDiscoveries ?? []).map(normalizeRouteEntry),
    seedUrls: uniqueOrdered(overlay.seedUrls ?? []),
  };
}

export function getTelemetrySuppressions(title) {
  return getCoverageOverlay(title).knownTelemetryExclusions;
}

export function getCaptureRecipes(title) {
  return [...(captureRecipesByTitle[title] ?? [])];
}

export function buildCoverageLedgerEntry(specRecord, recorderPortalIds) {
  const crawlMetadata = crawlMetadataByTitle[specRecord.title];
  if (!crawlMetadata) {
    throw new Error(`Missing crawl metadata for "${specRecord.title}"`);
  }

  const coverageOverlay = getCoverageOverlay(specRecord.title);

  return {
    title: specRecord.title,
    specId: specRecord.specId,
    specPath: specRecord.specPath,
    portalUrl: crawlMetadata.portalUrl,
    seedUrls: uniqueOrdered([
      ...(coverageOverlay.seedUrls ?? []),
      ...(coverageOverlay.seedUrls?.length ? [] : [crawlMetadata.portalUrl]),
    ]),
    authModel: crawlMetadata.authModel,
    recorderSupported: hasRecorderSupport(specRecord.specId, recorderPortalIds),
    crawlPriority: crawlMetadata.crawlPriority,
    nextPass: crawlMetadata.nextPass,
    nextPassReason: crawlMetadata.reason,
    apiHosts: [...specRecord.serverUrls],
    observedHosts: [...coverageOverlay.observedHosts],
    pathPrefixes: [...specRecord.pathPrefixes],
    operationCount: specRecord.operationCount,
    lastSuccessfulPassDepth: coverageOverlay.lastSuccessfulPassDepth ?? "untracked",
    captureRecipes: getCaptureRecipes(specRecord.title),
    promotedDiscoveries: [...coverageOverlay.promotedDiscoveries],
    knownTelemetryExclusions: [...coverageOverlay.knownTelemetryExclusions],
    openGaps: [...coverageOverlay.openGaps],
    notes: [...coverageOverlay.notes],
  };
}
