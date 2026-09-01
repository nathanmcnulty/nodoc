// Browser origins stay URL-shaped here; runtime capture leases canonicalize them centrally.
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
  "Defender XDR": {
    portalUrl: "https://security.microsoft.com",
    authModel: "Portal session cookies (`sccauth`, `XSRF-TOKEN`)",
    crawlPriority: "diff-first",
    nextPass: "normalized-family-diff",
    reason: "Largest surface in the repo; use capture-vs-spec diffs before another broad crawl.",
  },
  "Defender XDR (MTO)": {
    portalUrl: "https://mto.security.microsoft.com",
    authModel: "Defender portal session cookies plus MTO tenant, XSRF, and proxy routing context",
    crawlPriority: "diff-first",
    nextPass: "mto-view-diff",
    reason: "Treat MTO as a distinct multi-tenant portal view and target only wrapper or workflow contracts absent from the MTO baseline.",
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
    authModel: "Legacy portal cookie or current admin-shell bearer token",
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
  "Microsoft Graph Research": {
    portalUrl: "https://graph.microsoft.com",
    authModel: "Delegated Microsoft Graph bearer token observed through portal-owned browser sessions",
    crawlPriority: "diff-first",
    nextPass: "cross-portal-contract-delta-corroboration",
    reason: "Research-only ownership surface for Graph operations absent from pinned official v1.0 and beta contracts; collect evidence through owning portal recipes.",
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
  "Viva Engage": {
    portalUrl: "https://engage.cloud.microsoft/main/admin",
    authModel: "MSAL PKCE bearer token + same-origin GraphQL",
    crawlPriority: "high",
    nextPass: "external-network-write-follow-up",
    reason: "The authenticated landing, direct-route, and realtime relay captures confirmed GraphQL, token-helper, and transient Yammer relay behavior; remaining work is the setup-external-network write path plus any directly product-bound legacy Yammer hosts.",
  },
};

export const recorderIdAliasesBySpecId = {
  "defender-xdr": ["defender"],
  "defender-mto": ["defender"],
  "exchange-beta": ["exchange-beta"],
  "ibiza-iam": ["entra-iam"],
};

export const coverageOverlayByTitle = {
  "Defender XDR": {
    seedUrls: [
      "https://security.microsoft.com",
    ],
    observedHosts: [
      "security.microsoft.com",
    ],
    lastSuccessfulPassDepth: "bounded-normal-ui-diff",
    promotedDiscoveries: [
      route("GET", "/apiproxy/securityplatform/graphs/graph-instances", "Promoted from a fresh Defender Security Graph inventory with an exact empty-collection response shape."),
      route("GET", "/apiproxy/arm/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.OperationsManagement/solutions/SecurityInsights({solutionName})", "Promoted from bounded normal-UI Defender traffic with all Azure identifiers parameterized."),
      route("GET", "/apiproxy/mcas/cas/api/v1/app_connectors/dashboard/get_app_connectors_count_by_status", "Promoted from bounded normal-UI Defender for Cloud Apps traffic."),
      route("GET", "/apiproxy/medeina/settings/datashare", "Promoted from bounded normal-UI Security Copilot settings traffic."),
      route("GET", "/apiproxy/medeina/usage/capacities", "Promoted from bounded normal-UI Security Copilot capacity traffic."),
      route("POST", "/apiproxy/mtp/xspmatlas/attacksurface/query", "Promoted with exact request and response shapes from a passive Attack map capture."),
      route("GET", "/apiproxy/mtp/ndr/machines/deviceTotals", "Promoted with the observed array item contract from a passive Attack map capture."),
      route("POST", "/apiproxy/securityplatform/sentinelgraph/provisioning/checkTenant", "Promoted with empty-request and readiness-response shapes from Sentinel Graph readiness."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/api/log/Put", "Telemetry and performance sink confirmed during the checked-in Defender verification recipe."),
      route("POST", "/apiproxy/mtp/phoenixSocomatApi/recording/upload/encoded", "Passive UI recording upload confirmed in normal portal traffic; intentionally excluded from the documented API surface and probe planning."),
    ],
    knownCandidateExclusions: [
      route("GET", "/apiproxy/mtp/userPreferences/api/mgmt/userpreferencesservice/userPreference/{preferenceKey}", "Deferred because the observed tenant-scoped suffix is not proven to be a stable wildcard preference resource."),
    ],
    openGaps: [
      "Reopen Identity Explorer only after adding a deterministic identity-page-to-tab transition that reproduces an exact unmodeled Defender or Graph proxy operation.",
      "Reopen Sentinel Graph catalog discovery when the tenant reaches a different provisioning state; the current readiness state did not emit the catalog route.",
    ],
    notes: [
      "The Graph-focused recipe now targets parameterized Identity Explorer state instead of replaying the exhausted graphs and machines states.",
      "Focused recipes separate Attack map, App Governance, and Sentinel Graph readiness traffic because multiple views share the opaque POST-backed attack-surface query transport.",
      "The checked-in Defender XDR coverage includes same-origin navigation and representative entity pages; MTO-wrapped operations now have separate portal-view ownership.",
      "Passive Attack map and Sentinel Graph runs promoted complete request, response, query, and readiness shapes with no deliberate mutation.",
      "A dedicated live verification pass confirmed Defender also emits POST /api/log/Put, so candidate diffs now suppress it as telemetry-only traffic.",
      "A bounded normal-UI pass promoted four read-only families and retained the recurring recording upload as a telemetry exclusion.",
      "Offline structural reconciliation is complete: 602 source declarations partition into 592 emitted, 8 intentionally filtered, 1 Sentinel transport alias, and 1 duplicate-shadowed Cloud Apps declaration, with no unresolved or orphaned identities.",
      "CloudApps.GetSettings remains an explicit duplicate-shadowed ownership disposition for the root-indexed Configuration.GetCloudAppsSettings operation; it is not an outstanding coverage gap.",
    ],
  },
  "Defender XDR (MTO)": {
    seedUrls: [
      "https://mto.security.microsoft.com",
    ],
    observedHosts: [
      "mto.security.microsoft.com",
    ],
    lastSuccessfulPassDepth: "passive-landing-reload",
    promotedDiscoveries: [
      route("GET", "/apiproxy/mtoapi/mtp/incidentDashboard/Dashboard/ActiveIncidentsSummary", "Promoted from passive MTO landing hydration with result and execution-metadata envelope shapes."),
      route("GET", "/apiproxy/mtoapi/mtp/rbacManagementApi/rbac/machine_groups", "Promoted from passive MTO landing hydration with machine-group and wrapper contracts."),
      route("GET", "/apiproxy/mtoapi/mtp/sccManagement/mgmt/TenantContext", "Enriched with the observed feature-group, feature-name, and tenant-keyed bootstrap shape."),
      route("GET", "/apiproxy/mtoapi/tenantGroups/effective/", "Enriched with a sanitized current response example and exact response shape."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/api/log/Put", "Shared Defender shell telemetry observed during passive MTO landing hydration."),
    ],
    openGaps: [
      "Use exact MTO views to capture tenant picker, recent items, tenant groups, assignments, and RBAC-group contracts that do not naturally emit from the landing page.",
      "Classify future MTO captures as wrapper-specific, native-shared, or shared-shell before assigning specification ownership.",
    ],
    notes: [
      "MTO is modeled as a distinct portal view for operators managing multiple tenants, not as a separate implementation of every Defender backend.",
      "MTO-wrapped routes retain this spec's ownership because their tenant selection, routing context, and response envelope differ from native Defender XDR calls.",
      "The successful landing capture completed with no required action failures, no deliberate mutation attempts, and no Graph telemetry.",
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
      "The August 2026 exact-state reload capture completed with healthy action accounting and observed only GET /api/Permissions on main.iam; it produced no in-scope confirmed candidate and no target signal for /B2B/customIdentityProviders.",
    ],
    openGaps: [
      "The current All identity providers state did not emit the checked-in main.iam GET /B2B/customIdentityProviders operation. Reopen only with a different deterministic product-bearing state or current bundle-to-control mapping; non-observation alone is not removal evidence.",
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
    lastSuccessfulPassDepth: "deep-href-clickflow",
    knownTelemetryExclusions: [
      route("GET", "/api/SearchData/LogSearchTerm", "Bundle-only search telemetry; no matching PIM API traffic was observed."),
      route("GET", "/api/make-reset-styles", "Bundle-only UI stylesheet helper; no matching PIM API traffic was observed."),
      route("GET", "/api/shorthands", "Bundle-only UI shorthand helper; no matching PIM API traffic was observed."),
    ],
    openGaps: [],
    notes: [
      "The prior label-based flow clicked Microsoft Entra roles once, then repeated the same state because RoleSettings was exposed by href rather than the attempted Role settings label.",
      "The three bundle-only UI and telemetry observations are explicitly excluded from candidate planning until confirmed by read-only PIM traffic.",
      "The schema-v2 href capture completed all 26 eligible feature clicks with transitions and observed read-only traffic on api.azrbac.mspim.azure.com; no unresolved in-scope candidates were generated.",
    ],
  },
  Exchange: {
    seedUrls: [
      "https://admin.cloud.microsoft/exchange#/",
    ],
    observedHosts: [
      "admin.exchange.microsoft.com",
      "exchange.admin.cloud.microsoft",
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
  "Microsoft Graph Research": {
    seedUrls: [
      "https://graph.microsoft.com",
    ],
    observedHosts: [
      "graph.microsoft.com",
      "intune.microsoft.com",
      "admin.cloud.microsoft",
      "purview.microsoft.com",
      "security.microsoft.com",
    ],
    lastSuccessfulPassDepth: "cross-portal-contract-delta-review",
    notes: [
      "This is a research ownership surface, not a standalone portal; capture through the owning portal recipes and promote only canonical Graph member operations absent from the pinned official contracts.",
      "Proxy routes and the Graph batch wrapper remain in their owning portal specifications and evidence artifacts.",
      "Fresh Entra, Intune, Purview, Defender, and M365 Admin inventories have now exercised direct and proxied Graph telemetry; no additional contract-undocumented operation currently meets promotion requirements.",
    ],
  },
  "M365 Admin": {
    seedUrls: [
      "https://admin.cloud.microsoft",
    ],
    observedHosts: [
      "admin.cloud.microsoft",
    ],
    lastSuccessfulPassDepth: "graph-proxy-inventory",
    promotedDiscoveries: [
      route("GET", "/admin/api/Intune/devices", "Promoted from the fresh Intune devices inventory state with a sanitized managed-device projection."),
      route("GET", "/admin/api/rbac/adminunit/customization", "Promoted from the fresh administrative-units inventory state."),
      route("GET", "/admin/api/rbac/roles/customization", "Promoted from the fresh directory-roles inventory state."),
      route("GET", "/fd/MSGraph/beta/admin/cloudLicensing/allotments", "Promoted from the fresh subscriptions state with two observed OData response shapes."),
      route("GET", "/admin/api/copilot/getPreferences", "Promoted from bounded normal-UI Copilot traffic."),
      route("GET", "/admin/api/Domains/Summary", "Promoted from bounded normal-UI Domains traffic."),
      route("GET", "/admin/api/licenses/requests/summary", "Promoted from bounded normal-UI licensing traffic."),
      route("GET", "/admin/api/metrics/GetOverviewMetrics", "Promoted from bounded normal-UI overview traffic."),
      route("GET", "/admin/api/neptunelicensing/configurationplans", "Promoted from bounded normal-UI licensing traffic."),
      route("GET", "/admin/api/neptunelicensing/creditrequests", "Promoted from bounded normal-UI licensing traffic."),
      route("GET", "/admin/api/reports/GetMWSUsers", "Promoted from bounded normal-UI reports traffic."),
      route("GET", "/admin/api/settings/company/copilotpolicy/pinApp", "Promoted from bounded normal-UI Copilot settings traffic."),
      route("GET", "/admin/api/Users/getunlicenseduserscount", "Promoted from bounded normal-UI user-management traffic."),
      route("GET", "/fd/addins/api/apps/insight", "Promoted from bounded normal-UI integrated-apps traffic."),
      route("GET", "/fd/arm/providers/Microsoft.Billing/billingAccounts/{billingAccountId}/billingProfiles/{billingProfileId}/providers/Microsoft.Marketplace/products", "Promoted from bounded normal-UI marketplace catalog traffic with billing identifiers parameterized."),
      route("GET", "/fd/arm/providers/Microsoft.Billing/billingAccounts/{billingAccountId}/billingProfiles/{billingProfileId}/providers/Microsoft.Marketplace/skus", "Promoted from bounded normal-UI marketplace catalog traffic with billing identifiers parameterized."),
      route("GET", "/fd/dms/odata/C2RReleaseInfo", "Promoted from bounded normal-UI portal traffic."),
      route("GET", "/fd/m365licensing/v3/licensedProducts/{productId}/allotments", "Promoted from bounded normal-UI licensing traffic with the product identifier parameterized."),
      route("GET", "/fd/msgraph/beta/deviceManagement/configurationCategories", "Promoted from bounded normal-UI Edge management traffic."),
      route("GET", "/fd/msgraph/beta/deviceManagement/configurationSettings", "Promoted from bounded normal-UI Edge management traffic."),
      route("GET", "/fd/msgraph/v1.0/users/$count", "Promoted from bounded normal-UI user-management traffic."),
      route("POST", "/admin/api/Users/ListExternalGuestUsers", "Confirmed as a read-only list POST in bounded normal-UI guest-user traffic; corrected to the observed path casing."),
      route("POST", "/fd/arm/providers/Microsoft.Billing/billingAccounts/{billingAccountId}/billingSubscriptions/{billingSubscriptionId}/fetchProductDetails", "Confirmed as a read-only product-details lookup POST in bounded normal-UI billing traffic with identifiers parameterized."),
      route("POST", "/fd/arm/providers/Microsoft.Billing/billingAccounts/{billingAccountId}/checkAccess", "Confirmed as a read-only authorization decision POST in bounded normal-UI billing traffic with the billing identifier parameterized."),
    ],
    openGaps: [
      "The administrative-unit getadminunits POST remains deferred until read-only semantics and its mutation-shaped response fields are resolved.",
      "Provider-registration POSTs observed during marketplace and subscription loading remain intentionally unpromoted because replay could change tenant resource-provider state.",
      "The captured substrate suggestions POST remains intentionally unpromoted because it is an active search operation rather than a safe discovery probe.",
    ],
    notes: [
      "A fresh seven-state Graph inventory promoted four reads and produced nine documented Graph operations, eight enrichments, and no Graph Research candidate.",
      "Drive future M365 Admin discovery from candidate diffs before another broad live crawl.",
      "A bounded normal-UI pass evaluated 23 confirmed candidates and promoted 20 read-only or read-equivalent operations.",
    ],
    knownCandidateExclusions: [
      route("POST", "/admin/api/rbac/adminunit/getadminunits", "Deferred because the read-like paging request returns mutation-shaped administrative-unit fields and read-only semantics are not yet proven."),
      route("POST", "/fd/arm/providers/Microsoft.SaaSHub/register", "Provider registration is side-effect-capable and unsafe to replay."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/api/instrument/logclient", "Shared Microsoft 365 admin shell telemetry sink."),
    ],
  },
  "Power Platform": {
    seedUrls: [
      "https://admin.powerplatform.microsoft.com",
    ],
    observedHosts: [
      "admin.powerplatform.microsoft.com",
      "api.bap.microsoft.com",
      "licensing.powerplatform.microsoft.com",
    ],
    lastSuccessfulPassDepth: "bounded-normal-ui-diff",
    promotedDiscoveries: [
      route("GET", "/providers/PowerPlatform.Governance/v1/tenants/{tenantId}/tenantIsolationPolicy", "Promoted from bounded normal-UI Power Platform security traffic with the tenant identifier parameterized."),
      route("GET", "/v0.1-alpha/tenants/{tenantId}/entitlements/MCSMessages/snapshot/resources", "Promoted as a read-only legacy Copilot Studio licensing lookup; the captured tenant returned not found."),
      route("GET", "/v2.0/tenants/{tenantId}/entitlements/MCSMessages/resources", "Promoted from successful bounded normal-UI Copilot Studio licensing traffic."),
      route("GET", "/v2.0/tenants/{tenantId}/entitlements/MCSMessages/users", "Promoted from successful bounded normal-UI Copilot Studio licensing traffic."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/Collector/3.0", "Shared browser telemetry collector observed in portal traffic; intentionally excluded from API documentation and probe planning."),
      route("POST", "/OneCollector/1.0", "Shared browser telemetry collector observed in portal traffic; intentionally excluded from API documentation and probe planning."),
      route("POST", "/api/instrument/logclient", "Shared admin-shell client logging endpoint observed on two hosts; intentionally excluded from API documentation and probe planning."),
    ],
    openGaps: [
      "Nine confirmed tenant-island API reads remain adjacent scope-review evidence until their effective host templates are assigned explicitly.",
      "Two ECS routes match the Security Copilot server family and remain for explicit cross-spec assignment.",
      "Twenty-seven other shared Microsoft 365, Graph, Azure management, authentication, and Defender-family operations remain for a later cross-spec assignment pass.",
    ],
    notes: [
      "A bounded normal-UI pass promoted all four in-scope confirmed GET candidates and did not promote any bundle-only candidate.",
      "The initial adjacent review contained 68 confirmed items: 26 static localization or shared shell assets, four telemetry observations covered by three suppression routes, nine tenant-island reads, two ECS routes matching the Security Copilot server family, and 27 other shared cross-spec candidates.",
    ],
  },
  Purview: {
    seedUrls: [
      "https://purview.microsoft.com",
    ],
    observedHosts: [
      "purview.microsoft.com",
    ],
    lastSuccessfulPassDepth: "graph-proxy-inventory",
    promotedDiscoveries: [
      route("GET", "/apiproxy/edlp/dlpInternalApi/api/cloud/dlp/machines/count", "Promoted from a fresh bounded Data Loss Prevention overview capture with an exact aggregate response shape."),
      route("GET", "/apiproxy/edlp/dlpInternalApi/api/cloud/dlp/machines/summaryStatus", "Promoted from a fresh bounded Data Loss Prevention overview capture with a time-bucketed aggregate response shape."),
      route("GET", "/apiproxy/di/Find/InsiderRiskTag", "Promoted from bounded normal-UI Insider Risk traffic with the tenant identifier parameterized."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/InsiderRiskTenantActivityAnalytics('{activityCategory}')", "Promoted from bounded normal-UI Insider Risk analytics traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/InsiderRiskTenantPolicyAnalytics('{policyAnalyticsType}')", "Promoted from bounded normal-UI Insider Risk analytics traffic for two observed analytics types."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/IptIndicatorProfilesWithCounts", "Promoted from bounded normal-UI Insider Risk indicator traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/OnboardingChecklist", "Promoted only the read operation from bounded normal-UI onboarding traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/OnboardingChecklistCheckTaskStatus", "Promoted from bounded normal-UI onboarding traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/overview/activitySensitiveLabeledAggregate", "Promoted from bounded normal-UI Insider Risk overview traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/overview/agentRiskLevelAggregate", "Promoted from bounded normal-UI Insider Risk overview traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/PolicyMetrics", "Promoted from bounded normal-UI Insider Risk policy-health traffic."),
      route("GET", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/UserReports", "Promoted from bounded normal-UI Insider Risk report traffic."),
      route("POST", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{tenantId}/IptAllIndicatorsMergedProfile", "Confirmed as a bounded read-only indicator-profile calculation in normal-UI traffic."),
    ],
    knownCandidateExclusions: [
      route("POST", "/apiproxy/gws/ipmlservice/CategoryTrainingModel/getAll", "Deferred because the capture did not prove read-only semantics and the response surface contains sensitive identity, location, and credential-like fields."),
      route("POST", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{id}/IRMEasyPolicy", "Policy POST omitted because the capture does not prove that replay is free of policy state changes."),
      route("POST", "/apiproxy/insiderrisk/insiderrisk/api/v1.0/{id}/OnboardingChecklist", "State-changing onboarding task update observed in normal-UI traffic; intentionally excluded from documentation and probe planning."),
      route("POST", "/apiproxy/msgraph/v1.0/$batch", "Generic Graph batch wrapper omitted because it can carry mutations and the captured tenant-specific subrequest is not a stable operation contract."),
    ],
    openGaps: [
      "The CategoryTrainingModel getAll POST remains unpromoted until repeated evidence and explicit read-like POST safety proof are available.",
      "The IRMEasyPolicy POST remains unpromoted unless a future intercepted capture proves it is a bounded read-only lookup.",
      "The generic Microsoft Graph batch wrapper remains unpromoted; document stable inner operations individually when they can be generalized safely.",
    ],
    notes: [
      "Keep same-origin Purview Portal /api traffic distinct from the broader Purview proxy surface during follow-up diffing.",
      "A Defender cross-portal capture enriched Insider Risk analytics insight metadata and Microsoft Graph service-announcement response schemas without adding a Graph Research operation.",
      "A fresh proxy-focused pass captured 601 API requests, promoted two endpoint DLP reads, and found seven officially documented Graph operations with no Graph Research candidate.",
      "A bounded normal-UI pass evaluated 15 confirmed candidates, promoted all 11 GET candidates as 10 parameterized paths, promoted one read-only calculation POST, and excluded three unsafe or ambiguous POSTs.",
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
    openGapClasses: ["fresh-capture"],
    openGaps: [
      "A fresh runtime capture is still outstanding; checked-in historical evidence exists, but no distinct Purview Portal operation live-capture record or fresh runtime artifact is available.",
    ],
    notes: [
      "Checked-in historical evidence includes a live April 2026 same-origin route pass that confirmed GET /api/Auth/getSpaAuthCode during home, solution-launcher, and Data Security Investigations navigation.",
      "This coverage is historical only: no distinct Purview Portal operation live-capture ledger record or fresh runtime artifact is currently available.",
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
      "An August 2026 healthy deep pass exercised Home, Agents, Promptbooks, Manage workspaces, Usage monitoring, Security Store, Build, and Builder with no unresolved mutation and no new product API contract; thirteen same-origin /languages/strings/*.json bundles were retained as static feature-discovery telemetry rather than promoted as callable APIs.",
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
    promotedDiscoveries: [
      route("GET", "/_api/SPO.SPOContentSecurityPolicyConfiguration", "Promoted from the current Advanced > Script sources capture; the captured tenant returned an empty Items collection."),
    ],
    notes: [
      "A live April 2026 tenant shell snapshot confirmed stable admin hash routes for #/home, #/siteManagement, #/recycleBin, #/settings, #/migration, #/classicFeatures, and #/advancedManagement.",
      "A bounded authenticated August 2026 pass promoted the Script sources configuration read with a current response envelope and bundle-confirmed item member names.",
    ],
    openGaps: [
      "The current tenant nav also exposes SharePoint Embedded and Reports subpages such as Data access governance and OneDrive accounts; those surfaces still need route-specific capture before promoting any additional same-origin /_api routes.",
      "The client bundle references POST /_api/SPO.SPOContentSecurityPolicyConfiguration/UpdateScriptSources, but that write remains unpromoted until an abort-before-send or verified reversible-operation receipt captures its exact request and response contract.",
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
    knownTelemetryExclusions: [
      route("POST", "/api/instrument/logclient", "Same-origin Teams admin shell logging sink observed during authenticated Manage users navigation and excluded from the reusable data API surface."),
    ],
    notes: [
      "Teams already has a deeper capture baseline in the repo, so future follow-up should remain diff-driven.",
      "A bounded authenticated August 2026 Manage users capture enriched the existing user collection with its projection, ordering, active-user filter, page size, continuation link, assigned-plan contract, and a tenant-safe response example.",
      "The same pass retained five direct Microsoft Graph reads and classified all five against the current public contract; none produced an undocumented or error candidate.",
    ],
    openGaps: [
      "Other Teams operations still expose generic or opaque response schemas; choose one deterministic portal state with a non-empty response at a time instead of replaying Manage users.",
      "Populated telephone-number entries were not present in the current user inventory, so their item contract remains unconfirmed.",
    ],
  },
  "Viva Engage": {
    seedUrls: [
      "https://engage.cloud.microsoft/main/admin",
    ],
    observedHosts: [
      "engage.cloud.microsoft",
      "api.engage.cloud.microsoft",
      "www.yammer.com",
      "*.rt.yammer.com",
      "broadcast.yammer.com",
      "msgraph.yammer.com",
    ],
    lastSuccessfulPassDepth: "bounded-token-helper-frontier-and-live-graphql-correlation",
    promotedDiscoveries: [
      route("POST", "/graphql", "Promoted from the authenticated Viva Engage admin landing capture, which confirmed persisted GraphQL operations and the live bearer-header profile."),
      route("GET", "/api/v1/oauth2/aad_access_token", "Observed as a bearer-backed cross-host helper during the authenticated admin landing flow."),
      route("POST", "/cometd/handshake", "Observed on transient `*.rt.yammer.com` relay hosts after `RealtimeConnectionSettingsClients` returned the realtime `cometdBaseUrl`."),
      route("POST", "/cometd/", "Observed as Bayeux subscribe traffic on transient `*.rt.yammer.com` relay hosts after the realtime handshake completed."),
      route("POST", "/cometd/connect", "Observed as Bayeux long-poll traffic on transient `*.rt.yammer.com` relay hosts after the realtime subscriptions were established."),
    ],
    knownTelemetryExclusions: [
      route("POST", "/api/v1/yamalytics/webui", "Telemetry sink exposed by the shipped client bundle and excluded from the published admin surface."),
      route("POST", "/api/v2/events", "Telemetry sink exposed by the shipped client bundle and excluded from the published admin surface."),
      route("POST", "/api/v3/events", "Telemetry sink exposed by the shipped client bundle and excluded from the published admin surface."),
      route("POST", "/OneCollector/1.0/", "Microsoft browser telemetry collector observed during the authenticated admin landing flow and excluded from the published admin surface."),
    ],
    knownCandidateExclusions: [
      route("GET", "/api/shell/navbardata", "Shared Microsoft 365 shell navigation route; not owned by the Viva Engage API surface."),
      route("GET", "/api/bootlog/bootfailure", "Shared Microsoft 365 shell boot logging route; not owned by the Viva Engage API surface."),
      route("GET", "/api/clientshell/GetOriginAllowList", "Shared Microsoft 365 client-shell route; not owned by the Viva Engage API surface."),
      route("GET", "/api/instrument/logclient", "Shared Microsoft 365 shell instrumentation route; not owned by the Viva Engage API surface."),
      route("GET", "/api/myapps/GetAllApplications", "Shared Microsoft 365 My Apps route; not owned by the Viva Engage API surface."),
      route("GET", "/api/myapps/GetAllApps", "Shared Microsoft 365 My Apps route; not owned by the Viva Engage API surface."),
      route("GET", "/api/myapps/GetAppDataCache", "Shared Microsoft 365 My Apps route; not owned by the Viva Engage API surface."),
      route("GET", "/api/myapps/GetAppDetails", "Shared Microsoft 365 My Apps route; not owned by the Viva Engage API surface."),
      route("GET", "/api/myapps/GetIcon", "Shared Microsoft 365 My Apps route; not owned by the Viva Engage API surface."),
      route("GET", "/api/settings/darkmode", "Shared Microsoft 365 shell preference route; not owned by the Viva Engage API surface."),
      route("GET", "/api/settings/datetimeformats", "Shared Microsoft 365 shell preference route; not owned by the Viva Engage API surface."),
      route("GET", "/api/settings/theme", "Shared Microsoft 365 shell preference route; not owned by the Viva Engage API surface."),
      route("GET", "/api/shell/getshellinfo", "Shared Microsoft 365 shell bootstrap route; not owned by the Viva Engage API surface."),
      route("GET", "/api/shellbootstrapper", "Shared Microsoft 365 shell bootstrap route; not owned by the Viva Engage API surface."),
      route("GET", "/api/shellbootstrapper/{id}/oneshell", "Shared Microsoft 365 shell bootstrap route; not owned by the Viva Engage API surface."),
      route("GET", "/api/storage/{id}/{id}/{id}", "Shared Microsoft 365 shell storage route; not owned by the Viva Engage API surface."),
      route("GET", "/api/theme/tenant", "Shared Microsoft 365 shell theme route; not owned by the Viva Engage API surface."),
      route("GET", "/api/uxversion", "Shared Microsoft 365 shell version route; not owned by the Viva Engage API surface."),
      route("GET", "/api/cn", "Substring mined from OneShell's `/shellux/api/cn/` sovereign-cloud asset prefix; not a Viva Engage endpoint."),
      route("GET", "/api/mil", "Substring mined from OneShell's `/shellux/api/mil/` sovereign-cloud asset prefix; not a Viva Engage endpoint."),
      route("GET", "/api/us", "Substring mined from OneShell's `/shellux/api/us/` sovereign-cloud asset prefix; not a Viva Engage endpoint."),
      route("GET", "/api/selection", "Substring mined from the shared OneShell bundle's external `https://arc.msn.com/v4/api/selection` advertising call; not a Viva Engage endpoint."),
      route("GET", "/api/v1/topic/capabilities", "Literal error-message text mined from the shared OWA boot bundle with no runtime Viva observation; not a Viva Engage endpoint candidate."),
    ],
    notes: [
      "The authenticated default-Edge landing capture confirmed 27 unique persisted GraphQL operations, including `RealtimeConnectionSettingsClients`, plus a stable bearer-plus-`x-request-id` GraphQL header profile and no cookie header on the captured authenticated admin API requests for this pass.",
      "Direct-route captures validated `/main/admin/segmentation`, `/main/admin/external-networks-settings`, and `/main/admin/setup-external-network`, adding route-specific GraphQL operations `NetworkSegmentationQueryClients` and `ExternalNetworksAdminSettingsClients`.",
      "Repeated admin captures also observed `UniversalCreateButtonQueryClients`, which returned create-capability flags and dismissable prompt state for the shell `Create new` affordance.",
      "The `setup-external-network` page text described `Generate code` and `Redeem code` as one-time access-code actions used to link an external network to the current Engage network, which makes the visible flow look more like network-link setup than billing or add-on procurement.",
      "A final no-submit probe of a visible access-code control on `/main/admin/setup-external-network` kept the browser on the same route and did not emit a distinct write or redemption request before the next user-input step.",
      "The same-origin `RealtimeConnectionSettingsClients` response returned transient `*.rt.yammer.com/cometd/` relay hosts, after which the browser performed Bayeux handshake, subscribe, and connect POSTs with redacted `token` and `hub_tenant_token` fields in the body rather than `Authorization` or cookie headers.",
      "A bearer-backed GET `/api/v1/oauth2/aad_access_token` helper was also observed on `api.engage.cloud.microsoft`; bundle code still requests it through Yammer-named helper logic with `X-Yammer-OAuthTokenExpiration` and optional `X-Yammer-ThirdPartyCookieBlocked` headers.",
      "A review of the checked-in April 2026 raw-request artifacts still found no direct admin request to `broadcast.yammer.com` or `msgraph.yammer.com`, so both hosts remain unpromoted config references.",
      "The guessed `/main/admin/external-networks` path changed the URL but rendered the generic admin landing state during this pass; the canonical external admin surface resolved under `external-networks-settings` instead.",
      "An August 2026 token-helper frontier repeated the healthy authenticated landing and an explicit reload: both returned 200 `text/html` metadata for `/api/v1/oauth2/aad_access_token`, but neither retained a response body, so the evidence does not establish an empty-body contract.",
      "The same pass correlated 27 live GraphQL operations with tenant-safe variable names, status/media metadata, and response-field paths; document kinds remain `unresolved` where the current bundle set did not corroborate query versus mutation.",
      "`UpdateAppActivityStateClients` was passively emitted by normal landing hydration and returned 200, but discovery did not intentionally invoke it and has no verified before/after or restoration receipt.",
      "One direct Microsoft Graph profile-photo read matched the current public Graph contract; the pass found no undocumented Graph route and no Graph error candidate.",
      "The static classifier now removes 20 versioned Yammer locale and shared-shell catalogs from the adjacent ownership queue without hiding confirmed API transport.",
      "The five remaining bundle-only strings were traced to shared OneShell or OWA bundles: three sovereign-cloud `/shellux` substrings, one external MSN advertising route, and one OWA error-message literal. They are excluded from Viva endpoint planning unless first observed on a product-owned host at runtime.",
    ],
    openGaps: [
      "Intercept the next step after code generation or code entry if `setup-external-network` ever advances beyond the shared `ExternalNetworksAdminSettingsClients` bootstrap query and shell-state reads, because the no-submit access-code control probe did not emit a distinct write or redemption family.",
      "Intentional GraphQL mutation discovery needs an operation-name and body-aware abort gate plus a verified before/after receipt. The shared `POST /graphql` transport is too broad for method-and-path-only interception.",
    ],
  },
};

export const captureRecipesByTitle = {
  "Defender XDR": [
    "tools/capture-recipes/defender-deep.json",
    "tools/capture-recipes/defender-attack-map-enrichment.json",
    "tools/capture-recipes/defender-app-governance-enrichment.json",
    "tools/capture-recipes/defender-graph-inventory.json",
    "tools/capture-recipes/defender-sentinel-graph-enrichment.json",
    "tools/capture-recipes/defender-telemetry-verification.json",
    "tools/capture-recipes/defender-entity-replay.json",
  ],
  "Defender XDR (MTO)": [
    "tools/capture-recipes/defender-mto-landing-enrichment.json",
  ],
  "Entra B2C": [
    "tools/capture-recipes/entra-b2c-deep.json",
    "tools/capture-recipes/entra-b2c-seeded-replay.json",
  ],
  "Entra IAM": [
    "tools/capture-recipes/entra-iam-deep.json",
    "tools/capture-recipes/entra-graph-inventory.json",
    "tools/capture-recipes/entra-iam-seeded-replay.json",
  ],
  "Entra IDGov": [
    "tools/capture-recipes/entra-idgov-deep.json",
    "tools/capture-recipes/entra-idgov-seeded-replay.json",
  ],
  "Entra IGA": [
    "tools/capture-recipes/entra-iga-novelty.json",
  ],
  "Entra PIM": [
    "tools/capture-recipes/entra-pim-expired-assignments-enrichment.json",
    "tools/capture-recipes/entra-pim-novelty.json",
    "tools/capture-recipes/entra-pim-deep.json",
    "tools/capture-recipes/entra-pim-seeded-replay.json",
  ],
  Exchange: [
    "tools/capture-recipes/exchange-bootstrap-shape-novelty.json",
    "tools/capture-recipes/exchange-deep.json",
    "tools/capture-recipes/exchange-seeded-replay.json",
  ],
  "Intune Autopatch": [
    "tools/capture-recipes/intune-autopatch-deep.json",
    "tools/capture-recipes/intune-autopatch-support-enrichment.json",
    "tools/capture-recipes/intune-deep.json",
    "tools/capture-recipes/intune-seeded-replay.json",
  ],
  "Intune Portal": [
    "tools/capture-recipes/intune-deep.json",
    "tools/capture-recipes/intune-graph-inventory.json",
    "tools/capture-recipes/intune-portal-deep.json",
    "tools/capture-recipes/intune-seeded-replay.json",
  ],
  "M365 Admin": [
    "tools/capture-recipes/m365-admin-deep.json",
    "tools/capture-recipes/m365-admin-graph-inventory.json",
    "tools/capture-recipes/m365-admin-seeded-replay.json",
  ],
  "M365 Apps Config": [
    "tools/capture-recipes/m365-apps-config-deep.json",
    "tools/capture-recipes/m365-apps-deep.json",
    "tools/capture-recipes/m365-apps-seeded-replay.json",
  ],
  "M365 Apps Inventory": [
    "tools/capture-recipes/m365-apps-inventory-deep.json",
    "tools/capture-recipes/m365-apps-deep.json",
    "tools/capture-recipes/m365-apps-seeded-replay.json",
  ],
  "M365 Apps Services": [
    "tools/capture-recipes/m365-apps-services-deep.json",
    "tools/capture-recipes/m365-apps-deep.json",
    "tools/capture-recipes/m365-apps-seeded-replay.json",
  ],
  "Power Platform": [
    "tools/capture-recipes/power-platform-environments-novelty.json",
    "tools/capture-recipes/power-platform-deep.json",
    "tools/capture-recipes/power-platform-seeded-replay.json",
  ],
  Purview: [
    "tools/capture-recipes/purview-deep.json",
    "tools/capture-recipes/purview-graph-inventory.json",
    "tools/capture-recipes/purview-seeded-replay.json",
  ],
  "Purview Portal": [
    "tools/capture-recipes/purview-portal-deep.json",
    "tools/capture-recipes/purview-portal-seeded-replay.json",
  ],
  "Security Copilot": [
    "tools/capture-recipes/security-copilot-deep.json",
    "tools/capture-recipes/security-copilot-builder-followup.json",
    "tools/capture-recipes/security-copilot-trial-inspection.json",
    "tools/capture-recipes/security-copilot-seeded-replay.json",
  ],
  SharePoint: [
    "tools/capture-recipes/sharepoint-script-sources-novelty.json",
    "tools/capture-recipes/sharepoint-admin-deep.json",
    "tools/capture-recipes/sharepoint-admin-seeded-replay.json",
  ],
  Teams: [
    "tools/capture-recipes/teams-manage-users-novelty.json",
    "tools/capture-recipes/teams-deep.json",
    "tools/capture-recipes/teams-seeded-replay.json",
  ],
  "Viva Engage": [
    "tools/capture-recipes/viva-engage-token-helper-novelty.json",
    "tools/capture-recipes/viva-engage-admin-roles-deep.json",
    "tools/capture-recipes/viva-engage-admin-deep.json",
    "tools/capture-recipes/viva-engage-external-networks-deep.json",
    "tools/capture-recipes/viva-engage-segmentation-deep.json",
    "tools/capture-recipes/viva-engage-setup-external-network-deep.json",
    "tools/capture-recipes/viva-engage-tenant-settings-deep.json",
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
      knownCandidateExclusions: [],
      knownTelemetryExclusions: [],
      notes: [],
      openGapClasses: [],
      observedHosts: [],
      openGaps: [],
      promotedDiscoveries: [],
      seedUrls: [],
    };
  }

  return {
    ...overlay,
    knownCandidateExclusions: (overlay.knownCandidateExclusions ?? []).map(normalizeRouteEntry),
    knownTelemetryExclusions: (overlay.knownTelemetryExclusions ?? []).map(normalizeRouteEntry),
    notes: [...(overlay.notes ?? [])],
    observedHosts: uniqueOrdered(overlay.observedHosts ?? []),
    openGaps: [...(overlay.openGaps ?? [])],
    openGapClasses: [...(overlay.openGapClasses ?? [])],
    promotedDiscoveries: (overlay.promotedDiscoveries ?? []).map(normalizeRouteEntry),
    seedUrls: uniqueOrdered(overlay.seedUrls ?? []),
  };
}

export function getTelemetrySuppressions(title) {
  return getCoverageOverlay(title).knownTelemetryExclusions;
}

export function getCandidateSuppressions(title) {
  const overlay = getCoverageOverlay(title);
  return [
    ...overlay.knownTelemetryExclusions,
    ...overlay.knownCandidateExclusions,
  ];
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
    ...(coverageOverlay.knownCandidateExclusions.length > 0
      ? { knownCandidateExclusions: [...coverageOverlay.knownCandidateExclusions] }
      : {}),
    knownTelemetryExclusions: [...coverageOverlay.knownTelemetryExclusions],
    openGaps: [...coverageOverlay.openGaps],
    ...(coverageOverlay.openGapClasses.length > 0
      ? { openGapClasses: [...coverageOverlay.openGapClasses] }
      : {}),
    notes: [...coverageOverlay.notes],
  };
}
