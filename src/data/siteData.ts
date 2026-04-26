import { generatedSpecDataByTitle } from "../generated/specQuality";

type QualityMaturity = {
  label: string;
  tone: "success" | "neutral" | "warning";
  description: string;
};

type GeneratedSpecData = {
  title: string;
  specPath: string;
  specSourceUrl: string;
  specDownloadUrl: string;
  operationCount: number;
  navigationStandardized: boolean;
  ungroupedTagCount: number;
  metadataComplete: boolean;
  contactDefined: boolean;
  licenseDefined: boolean;
  externalDocsDefined: boolean;
  allServersDescribed: boolean;
  placeholderCount: number;
  successResponseExampleCount: number;
  maturity: QualityMaturity;
};

export type ApiCatalogItem = {
  title: string;
  slug: string;
  family: string;
  operations: number;
  authModel: string;
  baseUrl: string;
  summary: string;
  highlights: string[];
  collectionPath: string;
  collectionDownloadUrl: string;
  specPath: string;
  specSourceUrl: string;
  specDownloadUrl: string;
  quality: GeneratedSpecData | null;
  qualitySummary: string;
};

export type AccessModel = {
  title: string;
  description: string;
  portals: string[];
};

export type QuickStartStep = {
  title: string;
  description: string;
};

export type GettingStartedGuide = {
  title: string;
  portals: string[];
  authModel: string;
  baseUrls: string[];
  confirmedDetails: string[];
  practicalGuidance: string[];
  mutationGuidance: string[];
  pitfalls: string[];
};

export const gitHubRepositoryUrl = "https://github.com/nathanmcnulty/nodoc";
export const checkedInCollectionsTreeUrl =
  "https://github.com/nathanmcnulty/nodoc/tree/main/postman/collections";
export const postmanWorkspaceUrl =
  "https://www.postman.com/dolphinlabs/workspace/nodoc";
export const publishedSiteUrl = "https://nodoc.nathanmcnulty.com";

type ApiCatalogSeed = Omit<
  ApiCatalogItem,
  "quality" | "qualitySummary" | "specPath" | "specSourceUrl" | "specDownloadUrl"
>;

const apiCatalogSeed: ApiCatalogSeed[] = [
  {
    title: "Defender",
    slug: "/defender",
    family: "Security portal",
    operations: 558,
    authModel: "Portal session cookie (`sccauth`)",
    baseUrl: "https://security.microsoft.com/apiproxy",
    summary:
      "Security operations coverage across alerts, incidents, case management, hunting, multi-tenant management, cloud apps, investigation pivots, endpoint, identity, vulnerability, configuration, and exposure workflows.",
    highlights: [
      "Alerts, incidents, case management, and AutoIR coverage",
      "Advanced hunting, custom detections, and live response",
      "Cloud Apps discovery, App Governance policies, entity resolution, and device/file-page pivots",
      "Multi-tenant tenant groups, assignments, and wrapped case, hunting, identity, and configuration reads",
      "Threat Analytics detail pivots, Attack simulation training, XSPM connectors, and Sentinel graph/data lake routes",
    ],
    collectionPath: "postman/collections/defender.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/defender.collection.json",
  },
  {
    title: "M365 Admin",
    slug: "/m365-admin",
    family: "Admin portal",
    operations: 213,
    authModel: "Portal session cookie + custom admin headers",
    baseUrl: "https://admin.cloud.microsoft",
    summary:
      "Tenant settings, Copilot controls, reports, user and group management, app settings, and admin shell surfaces.",
    highlights: [
      "Copilot, agent, and security settings",
      "User, group, tenant, and billing operations",
      "Custom portal header requirements modeled in-spec",
    ],
    collectionPath: "postman/collections/m365-admin.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/m365-admin.collection.json",
  },
  {
    title: "Exchange",
    slug: "/exchange",
    family: "Exchange admin center",
    operations: 61,
    authModel: "Portal session cookie + same-origin `x-requested-with`",
    baseUrl: "https://admin.exchange.microsoft.com/beta",
    summary:
      "Same-origin Exchange admin center beta coverage for shell bootstrap, preferences, mail flow, recipients, migration, public folders, and report widgets.",
    highlights: [
      "Shell, tenant, profile, and preference routes used across the Exchange portal",
      "Accepted domains, connectors, transport rules, alert policies, and mail flow reports",
      "Recipient, role group, migration, and public folder inventory surfaces",
    ],
    collectionPath: "postman/collections/exchange-beta.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/exchange-beta.collection.json",
  },
  {
    title: "SharePoint",
    slug: "/sharepoint-admin",
    family: "SharePoint admin center",
    operations: 41,
    authModel: "Portal session cookie (`FedAuth`) + SharePoint form digest",
    baseUrl: "https://{tenant}-admin.sharepoint.com",
    summary:
      "Tenant bootstrap, site inventory, site-detail blades, storage quota, migration helpers, and settings workflows from the SharePoint admin center same-origin `/_api` surface.",
    highlights: [
      "Tenant admin bootstrap and multigeo discovery",
      "Site inventory, site-detail membership/settings helpers, deletion checks, and CSV export coverage",
      "Storage quota, migration-center, OneDrive policy, branding, and internal tenant settings coverage",
    ],
    collectionPath: "postman/collections/sharepoint-admin.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/sharepoint-admin.collection.json",
  },
  {
    title: "Teams",
    slug: "/teams",
    family: "Teams admin center",
    operations: 99,
    authModel: "Portal bearer token + same-origin portal context",
    baseUrl: "https://admin.teams.microsoft.com",
    summary:
      "Exhaustive Teams admin center coverage spanning left-nav routes, list/detail drill-ins, report interactions, records-backed policy and telephony surfaces, Frontline orchestration, devices, CQD data, app catalog detail pages, monetization, and planning helpers.",
    highlights: [
      "Deep crawl covered same-origin nav routes plus safe list/detail and report drill-ins",
      "Distinct Teams families now include policy configs, telephony, user analytics, Frontline, devices, CQD data, and add-on licensing",
      "Feature- and tenant-gated surfaces such as Silent Tests, hierarchy operations, and inactive Teams insights are called out explicitly",
    ],
    collectionPath: "postman/collections/teams.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/teams.collection.json",
  },
  {
    title: "Viva Engage",
    slug: "/viva-engage",
    family: "Viva",
    operations: 5,
    authModel: "MSAL PKCE bearer token + same-origin GraphQL",
    baseUrl: "https://engage.cloud.microsoft",
    summary:
      "Authenticated Viva Engage admin coverage now documents the same-origin persisted GraphQL contract, the bearer-backed token helper observed behind `engage.cloud.microsoft/main/admin`, and the transient Yammer-era realtime relay chain bootstrapped from `RealtimeConnectionSettingsClients`, together with direct-route captures for segmentation and external-network admin pages.",
    highlights: [
      "Same-origin `/graphql` admin endpoint documented from authenticated landing and direct-route captures, including `RealtimeConnectionSettingsClients` returning relay base URLs",
      "Direct-route captures resolved `/main/admin/segmentation`, `/main/admin/external-networks-settings`, and `/main/admin/setup-external-network`",
      "Cross-host `GET /api/v1/oauth2/aad_access_token` plus transient `*.rt.yammer.com/cometd/handshake`, `/cometd/`, and `/cometd/connect` relay endpoints documented from the live admin session",
      "Live capture confirmed bearer auth on GraphQL and token-helper requests, while realtime relay auth moved into redacted Bayeux payload fields without cookie headers",
    ],
    collectionPath: "postman/collections/viva-engage.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/viva-engage.collection.json",
  },
  {
    title: "M365 Apps Config",
    slug: "/m-365-apps-config",
    family: "M365 Apps admin center",
    operations: 23,
    authModel: "Portal bearer token + diagnostic headers",
    baseUrl: "https://config.office.com",
    summary:
      "Cloud Update, servicing profiles, policy management, device configuration, rollout metadata, and portal bootstrap state from the M365 Apps admin center.",
    highlights: [
      "Servicing profiles, tenant rules, and exclusion windows",
      "Policy settings catalog and Office Customization Tool save flows",
      "Browser bearer tokens with portal diagnostic headers modeled in-spec",
    ],
    collectionPath: "postman/collections/m365-apps-config.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/m365-apps-config.collection.json",
  },
  {
    title: "M365 Apps Services",
    slug: "/m-365-apps-services",
    family: "M365 Apps admin center",
    operations: 8,
    authModel: "Portal bearer token + diagnostic headers",
    baseUrl: "https://clients.config.office.net",
    summary:
      "Shared M365 Apps service coverage for onboarding state, feature availability, release catalogs, component sharding, and OneDrive Sync health.",
    highlights: [
      "Eligibility and feature provisioning state",
      "Release catalogs, setup state, and component mappings",
      "Shared services host used across Cloud Update, Device Configuration, and OneDrive Sync",
    ],
    collectionPath: "postman/collections/m365-apps-services.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/m365-apps-services.collection.json",
  },
  {
    title: "M365 Apps Inventory",
    slug: "/m-365-apps-inventory",
    family: "M365 Apps admin center",
    operations: 27,
    authModel: "Portal bearer token + diagnostic headers",
    baseUrl: "https://query.inventory.insights.office.net",
    summary:
      "Device inventory, build currency, add-ins, setup state, and security update status from the M365 Apps admin center inventory surface.",
    highlights: [
      "Device/build inventory with OData-style query support",
      "Add-ins, languages, Office applications, and onboarding state",
      "Setup and security-currency write flows captured from portal saves",
    ],
    collectionPath: "postman/collections/m365-apps-inventory.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/m365-apps-inventory.collection.json",
  },
  {
    title: "Intune Autopatch",
    slug: "/intune-autopatch",
    family: "Intune admin center",
    operations: 52,
    authModel: "Portal bearer token + x-ms portal headers",
    baseUrl: "https://services.autopatch.microsoft.com",
    summary:
      "Windows Autopatch tenant state, roles, groups, messages, support, and reporting surfaces from the Intune admin center.",
    highlights: [
      "Tenant resolution, feature enablement, and admin actions",
      "Autopatch roles, permissions, scope tags, and role assignments",
      "Messages, support flows, and quality/feature update reporting summaries, details, distinct filters, and export helpers",
    ],
    collectionPath: "postman/collections/intune-autopatch.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/intune-autopatch.collection.json",
  },
  {
    title: "Intune Portal",
    slug: "/intune-portal",
    family: "Intune admin center",
    operations: 3,
    authModel: "Portal bearer token + same-origin portal context",
    baseUrl: "https://intune.microsoft.com/api",
    summary:
      "Same-origin Intune admin center experimentation and persistent portal settings storage used across tenant administration blades.",
    highlights: [
      "Extension flighting for Intune, PIM, and Azure Monitor blades",
      "Persistent storage namespace reads via `Settings/Select`",
      "Portal settings writes via `Settings/Update`",
    ],
    collectionPath: "postman/collections/intune-portal.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/intune-portal.collection.json",
  },
  {
    title: "Power Platform",
    slug: "/power-platform",
    family: "Power Platform admin center",
    operations: 244,
    authModel: "Portal bearer tokens + service-specific audiences",
    baseUrl: "https://api.bap.microsoft.com",
    summary:
      "Exhaustive admin-center coverage across Business App Platform, analytics, licensing, Dataverse CRM, Power Pages portal infrastructure, tenant governance, notifications, and internal portal helpers used by the Power Platform admin center.",
    highlights: [
      "Nine backend families spanning Business App Platform, admin analytics, config analytics, licensing, tenant API, notifications, admin portal, Dynamics CRM, and Power Pages portal infrastructure",
      "Same-origin crawl coverage from left-nav, list/detail drill-ins, read-only pivots, and safe report interactions across manage, security, monitor, deployment, licensing, and support blades",
      "Tenant-dependent no-data, feature-limited, missing-link, and permission-limited surfaces called out from the live crawl",
    ],
    collectionPath: "postman/collections/power-platform.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/power-platform.collection.json",
  },
  {
    title: "Purview",
    slug: "/purview",
    family: "Security portal",
    operations: 124,
    authModel: "Portal session cookie (`sccauth`)",
    baseUrl: "https://purview.microsoft.com/apiproxy",
    summary:
      "Compliance, governance, DLP, insider risk, information protection, and Purview for AI coverage from the Purview portal proxy surface.",
    highlights: [
      "Purview for AI, DSPM for AI, oversharing assessments, and agent observability",
      "Information Protection settings, DLP devices, insider risk settings, and Exchange-backed admin commands",
      "Compliance exports, billing/license usage, and shared Purview backend prefixes",
    ],
    collectionPath: "postman/collections/purview.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/purview.collection.json",
  },
  {
    title: "Purview Portal",
    slug: "/purview-portal",
    family: "Security portal",
    operations: 6,
    authModel: "Portal session cookie (`sccauth`) + same-origin portal context",
    baseUrl: "https://purview.microsoft.com/api/",
    summary:
      "Same-origin Purview bootstrap, token minting, role evaluation, audit settings, and label-activity analytics used directly by the portal UX.",
    highlights: [
      "Portal-issued downstream token minting via `/api/Auth/getToken`",
      "Role cache and batch role-evaluation helpers used during startup",
      "Admin audit settings, user picker lookups, and label activity charts",
    ],
    collectionPath: "postman/collections/purview-portal.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/purview-portal.collection.json",
  },
  {
    title: "Security Copilot",
    slug: "/security-copilot",
    family: "Security portal",
    operations: 32,
    authModel: "Portal bearer tokens + workspace context",
    baseUrl: "https://api.securitycopilot.microsoft.com",
    summary:
      "Security Copilot portal coverage for bootstrap and preference reads, workspace provisioning and policy resolution, session and promptbook inventory, agent and builder discovery, and Security Store catalog flows.",
    highlights: [
      "Portal bootstrap and workspace-preference helpers across `api.securitycopilot.microsoft.com`",
      "Security Platform provisioning, policy, session, promptbook, agent, and skillset reads across global and regional control planes",
      "Security Store client configuration and catalog search, plus a safe what-if capture for the create-capacity flow",
    ],
    collectionPath: "postman/collections/security-copilot.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/security-copilot.collection.json",
  },
  {
    title: "Entra IAM",
    slug: "/entra-iam",
    family: "Entra portal",
    operations: 286,
    authModel: "Delegated OAuth2 + `X-Ms-Client-Request-Id`",
    baseUrl: "https://main.iam.ad.ext.azure.com/api",
    summary:
      "Deep IAM coverage spanning users, groups, applications, policies, directories, MFA, and related admin workflows.",
    highlights: [
      "Delegated-only Azure AD OAuth2 flow documented in-spec",
      "Azure Portal and Azure CLI pre-consent guidance included",
      "Largest modeled surface in the repository",
    ],
    collectionPath: "postman/collections/entra-iam.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/entra-iam.collection.json",
  },
  {
    title: "Entra PIM",
    slug: "/entra-pim",
    family: "Entra portal",
    operations: 16,
    authModel: "Azure AD bearer token",
    baseUrl: "https://api.azrbac.mspim.azure.com",
    summary:
      "Privileged Identity Management role assignments, requests, permissions, and role-setting workflows.",
    highlights: [
      "Entra roles, Azure resource roles, and group-based PIM",
      "Role activation, assignment, and removal requests",
      "Feature- and permission-gated surfaces called out in descriptions",
    ],
    collectionPath: "postman/collections/entra-pim.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/entra-pim.collection.json",
  },
  {
    title: "Entra IGA",
    slug: "/entra-iga",
    family: "Entra portal",
    operations: 10,
    authModel: "Azure AD bearer token",
    baseUrl: "https://elm.iga.azure.com",
    summary:
      "Legacy Identity Governance administration coverage for entitlement management, guest billing, connected organizations, and governance settings.",
    highlights: [
      "Legacy/non-Graph governance surfaces observed in the portal",
      "Entitlement management, billing, and governance admin endpoints",
      "License-gated behavior noted in descriptions",
    ],
    collectionPath: "postman/collections/entra-iga.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/entra-iga.collection.json",
  },
  {
    title: "Entra IDGov",
    slug: "/entra-id-gov",
    family: "Entra portal",
    operations: 14,
    authModel: "Azure AD bearer token",
    baseUrl: "https://api.accessreviews.identitygovernance.azure.com",
    summary:
      "Access Reviews and approval workflow coverage including providers, requests, decisions, and feature flags.",
    highlights: [
      "Provider-based routing guidance documented",
      "Access review instances and configuration surfaces",
      "Partner settings and feature-flag endpoints included",
    ],
    collectionPath: "postman/collections/entra-idgov.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/entra-idgov.collection.json",
  },
  {
    title: "Entra B2C",
    slug: "/entra-b-2-c",
    family: "Entra portal",
    operations: 5,
    authModel: "Azure AD bearer token + `tenantId` query context",
    baseUrl: "https://main.b2cadmin.ext.azure.com",
    summary:
      "External ID / B2C admin flows, user journeys, tenant information, and initialization-related endpoints.",
    highlights: [
      "User flow and custom policy surfaces",
      "Required `tenantId` context documented",
      "Feature-gated behavior described for non-B2C tenants",
    ],
    collectionPath: "postman/collections/entra-b2c.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/entra-b2c.collection.json",
  },
];

function getGeneratedSpecData(title: string): GeneratedSpecData | null {
  return (generatedSpecDataByTitle as Record<string, GeneratedSpecData>)[title] ?? null;
}

function getMetadataGapCount(quality: GeneratedSpecData): number {
  return Number(!quality.contactDefined)
    + Number(!quality.licenseDefined)
    + Number(!quality.externalDocsDefined)
    + Number(!quality.allServersDescribed);
}

function buildQualitySummary(quality: GeneratedSpecData | null): string {
  if (!quality) {
    return "Quality data unavailable";
  }

  const metadataSignal = quality.metadataComplete
    ? "complete metadata"
    : `${getMetadataGapCount(quality)} metadata gaps`;
  const placeholderSignal = quality.placeholderCount === 0
    ? "no placeholders"
    : `${quality.placeholderCount} placeholders`;
  const exampleSignal = quality.successResponseExampleCount === 0
    ? "no response examples yet"
    : `${quality.successResponseExampleCount} response examples`;

  return [
    quality.navigationStandardized ? "standardized nav" : `${quality.ungroupedTagCount} nav gaps`,
    metadataSignal,
    placeholderSignal,
    exampleSignal,
  ].join(" · ");
}

export const apiCatalog: ApiCatalogItem[] = apiCatalogSeed.map((api) => {
  const quality = getGeneratedSpecData(api.title);

  return {
    ...api,
    operations: quality?.operationCount ?? api.operations,
    specPath: quality?.specPath ?? "",
    specSourceUrl: quality?.specSourceUrl ?? gitHubRepositoryUrl,
    specDownloadUrl: quality?.specDownloadUrl ?? gitHubRepositoryUrl,
    quality,
    qualitySummary: buildQualitySummary(quality),
  };
});

export const accessModels: AccessModel[] = [
  {
    title: "Portal session cookies",
    description:
      "Defender and Purview rely on the portal's `sccauth` cookie and an authenticated browser session.",
    portals: ["Defender", "Purview"],
  },
  {
    title: "Portal session + same-origin XHR",
    description:
      "Exchange uses the authenticated Exchange admin center browser session with `.AspNetCore.Cookies` and same-origin `x-requested-with: XMLHttpRequest` requests.",
    portals: ["Exchange"],
  },
  {
    title: "Portal session + same-origin context",
    description:
      "Purview Portal uses the same `sccauth` browser session, but its same-origin `/api/` calls also depend on portal bootstrap state and are where Purview mints downstream bearer tokens.",
    portals: ["Purview Portal"],
  },
  {
    title: "Portal session + custom headers",
    description:
      "M365 Admin requires `AjaxSessionKey` plus portal routing and hosting headers extracted from the admin shell.",
    portals: ["M365 Admin"],
  },
  {
    title: "Portal session + SharePoint digest",
    description:
      "SharePoint uses the tenant's `-admin.sharepoint.com` browser session together with same-origin SharePoint headers such as `x-requestdigest`, `SdkVersion`, and `odata-version` on POST requests.",
    portals: ["SharePoint"],
  },
  {
    title: "Portal bearer tokens + regional discovery",
    description:
      "Teams admin center uses browser-acquired bearer tokens across multiple Teams and Office service hosts, plus same-origin portal context for `/api/log` and resolver calls that map the tenant to regional backends.",
    portals: ["Teams"],
  },
  {
    title: "MSAL PKCE bearer token + same-origin GraphQL",
    description:
      "Viva Engage admin uses a browser-acquired bearer token from the Engage MSAL PKCE flow with the Yammer `user_impersonation` scope, then calls same-origin persisted GraphQL on `engage.cloud.microsoft`, a bearer-backed token helper on `api.engage.cloud.microsoft`, and a transient `*.rt.yammer.com` Bayeux relay chain whose auth material is carried in the handshake body rather than in `Authorization` or cookie headers. No cookie header was observed on the authenticated admin API requests captured for this pass.",
    portals: ["Viva Engage"],
  },
  {
    title: "Portal bearer tokens + diagnostic headers",
    description:
      "M365 Apps uses browser-obtained bearer tokens together with diagnostic headers such as `x-api-name`, `x-correlationid`, `x-manageoffice-client-sid`, and `x-requested-with`.",
    portals: ["M365 Apps Config", "M365 Apps Services", "M365 Apps Inventory"],
  },
  {
    title: "Portal bearer tokens + service-specific audiences",
    description:
      "Power Platform reuses browser-obtained bearer tokens from the admin center, but different backends expect different audiences plus portal context headers such as correlation IDs, session IDs, tenant IDs, and app identifiers.",
    portals: ["Power Platform"],
  },
  {
    title: "Portal bearer tokens",
    description:
      "Intune Portal and Intune Autopatch use browser-obtained bearer tokens plus same-origin cookies or portal headers from the authenticated Intune session.",
    portals: ["Intune Portal", "Intune Autopatch"],
  },
  {
    title: "Delegated OAuth2",
    description:
      "Entra IAM uses the ADIbizaUX resource with delegated user auth only and typically needs `X-Ms-Client-Request-Id`.",
    portals: ["Entra IAM"],
  },
  {
    title: "Azure AD bearer tokens",
    description:
      "Entra PIM, IGA, IDGov, and B2C use Azure AD bearer tokens, with tenant- or feature-specific constraints on top.",
    portals: ["Entra PIM", "Entra IGA", "Entra IDGov", "Entra B2C"],
  },
];

const modeledOperationCount = apiCatalog.reduce((total, api) => total + api.operations, 0);
const checkedInCollectionCount = apiCatalog.length;
const standardizedNavigationCount = apiCatalog.filter(
  (api) => api.quality?.navigationStandardized,
).length;
const remainingPlaceholderCount = apiCatalog.reduce(
  (total, api) => total + (api.quality?.placeholderCount ?? 0),
  0,
);

export const launchStats = [
  { label: "Published specs", value: String(apiCatalog.length) },
  { label: "Modeled operations", value: modeledOperationCount.toLocaleString() },
  { label: "Standardized nav specs", value: String(standardizedNavigationCount) },
  { label: "Remaining placeholders", value: remainingPlaceholderCount.toLocaleString() },
  { label: "Access models", value: String(accessModels.length) },
  { label: "Checked-in collections", value: String(checkedInCollectionCount) },
];

export const quickStartSteps: QuickStartStep[] = [
  {
    title: "Pick the portal family first",
    description:
      "Each spec maps to a different portal surface, auth model, and backend. Start with the API page that matches the portal you already use.",
  },
  {
    title: "Prove access with GET requests",
    description:
      "Validate cookies, tokens, tenant context, and required headers with read-only endpoints before attempting any state-changing operations.",
  },
  {
    title: "Use generated artifacts",
    description:
      "The site ships both OpenAPI specs and checked-in Postman collections so you can inspect requests before building any automation.",
  },
  {
    title: "Treat mutations as real writes",
    description:
      "Assume POST, PATCH, PUT, and DELETE will change tenant state unless an endpoint is explicitly documented as safe. Use a non-production tenant whenever possible.",
  },
];

export const safeUsePrinciples = [
  "These are undocumented Microsoft portal APIs and may change without notice.",
  "Prefer browser traffic inspection, spec review, and GET-only validation before attempting writes.",
  "Use a non-production tenant for any endpoint that could create, modify, or delete configuration or identity state.",
  "If you need to map POST/PATCH/DELETE behavior safely, observe portal traffic and request bodies without replaying them until you understand the side effects.",
];

export const gettingStartedGuides: GettingStartedGuide[] = [
  {
    title: "Defender XDR and Purview proxy",
    portals: ["Defender", "Purview"],
    authModel: "Portal session cookie (`sccauth`)",
    baseUrls: [
      "https://security.microsoft.com/apiproxy",
      "https://purview.microsoft.com/apiproxy",
    ],
    confirmedDetails: [
      "Both specs model `PortalSession` as an API key in the `sccauth` cookie.",
      "Both portals route through `/apiproxy` and call out shared backend prefixes such as `/di/`, `/gws/`, `/medeina/`, `/msgraph/`, and `/shell/`.",
      "Defender MTO flows resolve accessible tenants through `GET /mtoapi/tenants/TenantPicker`, which reflects the operator's current multi-tenant scope.",
      "The specs explicitly say these APIs are used internally by the portals and are not officially documented.",
    ],
    practicalGuidance: [
      "Authenticate to the portal in a browser first, then capture the active session context before replaying requests elsewhere.",
      "For Defender multi-tenant flows, capture the paired `XSRF-TOKEN`/`X-XSRF-TOKEN` context and `mtoproxyurl=MTO` routing hint in addition to the `sccauth` session.",
      "Expect portal-only behavior such as short-lived sessions, backend-specific authorization, and inconsistent errors across different proxy prefixes.",
      "Start with list and lookup operations so you can validate the session cookie and shared-service routing without changing state.",
    ],
    mutationGuidance: [
      "Treat any POST, PATCH, PUT, or DELETE call as a live tenant change unless you have verified otherwise from portal behavior.",
      "For mutation mapping, prefer observing browser traffic and saving request/response examples over replaying state-changing calls.",
    ],
    pitfalls: [
      "Expired portal sessions usually fail without a helpful auth error.",
      "Multi-tenant Defender routes can require extra XSRF and routing context beyond the session cookie alone.",
      "Shared prefixes can expose different subsets of the same backend depending on the portal you entered through.",
      "Because these APIs are internal, some endpoints can disappear or change shape with little warning.",
    ],
  },
  {
    title: "Purview Portal",
    portals: ["Purview Portal"],
    authModel: "Portal session cookie (`sccauth`) + same-origin portal context",
    baseUrls: [
      "https://purview.microsoft.com/api/",
    ],
    confirmedDetails: [
      "Observed operations are same-origin `/api/` calls rather than `/apiproxy` backend routes.",
      "`GET /api/Auth/getToken` mints short-lived downstream tokens for Purview services, Microsoft Graph, and Azure Resource Manager resources.",
      "Role and feature evaluation happens through `GET /api/v2/auth/GetCachedRoles` and `POST /api/auth/IsInRoles` before many blades fully light up.",
    ],
    practicalGuidance: [
      "Capture requests from an already-authenticated Purview tab because same-origin portal state matters more here than with pure proxy calls.",
      "Expect many useful `/api/` calls to be bootstrap or lookup helpers that front other services rather than the final workload APIs themselves.",
      "Start with the read-only auth, role, audit, and picker endpoints so you can validate the session safely before chasing downstream APIs.",
    ],
    mutationGuidance: [
      "The published same-origin set is mostly read-heavy, but treat any newly discovered POST under `/api/` as a live write until you have mapped its side effects.",
      "If Purview uses `/api/Auth/getToken` to mint a downstream bearer token, validate the target resource with harmless GETs before invoking its write APIs directly.",
    ],
    pitfalls: [
      "`/api/` and `/apiproxy/` are distinct surfaces with different responsibilities, so don't assume routing or auth behavior from one applies cleanly to the other.",
      "Some same-origin responses contain user directory or role data, so sanitize captures before keeping artifacts.",
      "Portal-minted downstream tokens are short-lived and resource-specific, which makes replay brittle if you capture them too early.",
    ],
  },
  {
    title: "Security Copilot",
    portals: ["Security Copilot"],
    authModel: "Portal bearer tokens + workspace context",
    baseUrls: [
      "https://api.securitycopilot.microsoft.com",
      "https://api.securityplatform.microsoft.com",
      "https://us.api.securityplatform.microsoft.com",
      "https://prod.cds.securitycopilot.microsoft.com",
      "https://securitymarketplaceapi-prod.microsoft.com",
    ],
    confirmedDetails: [
      "The live portal used a browser-acquired Entra bearer token across `api.securitycopilot.microsoft.com`, `api.securityplatform.microsoft.com`, and the regional `us.api.securityplatform.microsoft.com` content plane.",
      "Security Copilot startup resolved the active workspace through `GET /userPreferences/currentWorkspace`, then loaded workspace content from regional `/pods/{podId}/workspaces/{workspaceName}/securitycopilot/*` routes.",
      "Opening the create-capacity dialog triggered `POST /provisioning/create` and returned `OperationWhatIfSuccess` before any real submission, which makes it a useful safe write-shape capture point.",
    ],
    practicalGuidance: [
      "Capture from an already-authenticated portal tab so the current workspace, regional pod host, and browser bearer token all line up with the requests you observe.",
      "Treat the global `api.securitycopilot.microsoft.com` bootstrap host and the Security Platform content hosts as one portal family; you need both to understand startup and page-specific reads.",
      "Use read-only surfaces such as Agents, Promptbooks, Manage workspaces, Usage monitoring, Build, and Security Store to expand coverage before you attempt any setup or save flows.",
    ],
    mutationGuidance: [
      "Treat all POST, PUT, PATCH, and DELETE routes as live writes unless you have concrete evidence they are read-like or what-if only.",
      "The captured `POST /provisioning/create` call appears to be a safe preflight when the dialog is opened and then canceled, but real provisioning and builder save flows still need separate intercepted capture before publication.",
    ],
    pitfalls: [
      "The portal also touches generic Entra login endpoints, telemetry sinks, and shared Azure Resource Manager reads; keep those out of the published Security Copilot scope unless they become product-specific.",
      "Some builder traffic used malformed empty identifiers such as `skillsets//authSettings` and `sessions//prompts/`; those are useful artifact clues but not strong enough for direct publication as stable paths.",
      "Several icon and expiry routes returned contextual `400` or `404` responses in the current workspace, which still confirms the route family but means tenant state matters heavily.",
    ],
  },
  {
    title: "M365 Admin",
    portals: ["M365 Admin"],
    authModel: "Portal session cookie + route-specific admin headers (plus brokered bearer tokens for some SharePoint-backed helpers)",
    baseUrls: ["https://admin.cloud.microsoft"],
    confirmedDetails: [
      "The spec models `AjaxSessionKey` as the session cookie and documents `x-portal-routekey`, `x-adminapp-request`, `x-ms-mac-appid`, and `x-ms-mac-hostingapp` as required headers for most requests.",
      "Live captures showed that `x-ms-mac-appid` is blade-specific rather than globally stable: `/homepage`, `/MicrosoftSearch`, `/brandcenter`, `/Settings/enhancedRestore`, and `/Settings/Services/:/Settings/L1/OfficeOnline` all emitted different GUIDs while reusing `M365AdminPortal`.",
      "M365 Admin uses `/admin/api/` and a separate `/fd/msgraph/` proxy instead of the shared Defender/Purview `/apiproxy` layout.",
    ],
    practicalGuidance: [
      "Capture the portal bootstrap or initial admin-shell requests so you can reproduce the required routing headers alongside the cookie.",
      "Keep request context tied to the admin experience you are using; several endpoints depend on admin-shell state in addition to auth.",
      "Expect SharePoint-backed helpers such as Brand center and Microsoft 365 Backup billing reads to layer additional SPO-specific routing or bearer-token requirements on top of the shell cookies.",
      "Use GET requests against shell, navigation, and current-user endpoints to confirm your headers before touching tenant settings.",
    ],
    mutationGuidance: [
      "Assume tenant, user, policy, and app-management endpoints will apply immediately to your tenant.",
      "When mapping writes, collect payloads from the portal UI and document them before you attempt any replay in a disposable tenant.",
    ],
    pitfalls: [
      "Missing one of the custom admin headers can look like a generic auth or routing failure.",
      "Some data comes through federated Graph proxies and can differ from the shared Graph proxy behavior in Defender or Purview.",
      "Header values can change as the admin shell bootstraps, refreshes, or switches blades; there is no single durable `x-ms-mac-appid` for the whole portal.",
    ],
  },
  {
    title: "Exchange admin center",
    portals: ["Exchange"],
    authModel: "Portal session cookie + same-origin `x-requested-with`",
    baseUrls: ["https://admin.exchange.microsoft.com/beta"],
    confirmedDetails: [
      "Observed Exchange calls were same-origin `/beta/` routes on `admin.exchange.microsoft.com`, not Microsoft Graph.",
      "The published spec models the live Exchange browser session with `.AspNetCore.Cookies` plus companion chunk cookies and same-origin `x-requested-with: XMLHttpRequest` requests.",
      "Shared `admin.microsoft.com` support, SharePoint, and feedback traffic appeared in the same browsing session but was excluded from Exchange coverage because it was generic shell traffic or already documented elsewhere.",
    ],
    practicalGuidance: [
      "Start from a real signed-in Exchange admin center tab and capture same-origin XHR/fetch requests instead of trying to replay the surface with a guessed token alone.",
      "Treat the OData-style `ExchangeAdminCenter.*` routes as parameterized functions, not as fixed timestamped paths copied straight out of one capture.",
      "Validate access with read-only bootstrap and list operations such as `GET /beta/Shell`, `GET /beta/UserProfile`, `GET /beta/AcceptedDomainFullListIC`, and `GET /beta/MigrationBatch` before mapping writes.",
    ],
    mutationGuidance: [
      "The only write-shaped Exchange route confirmed in this pass was `POST /beta/UserPreference`; treat additional POST, PUT, PATCH, or DELETE flows as live writes until you have captured and reviewed them carefully.",
      "If you need mailbox, connector, or rule mutations, capture the browser request body and original state first, then replay only in a disposable tenant.",
    ],
    pitfalls: [
      "Exchange pages also load generic Microsoft 365 shell, support, and feedback traffic from `admin.microsoft.com` and `portal.office.com`; do not confuse those hosts with the Exchange beta surface.",
      "A same-origin telemetry POST to `/api/instrument/logclient` returned `404` during live capture and was intentionally left out of published coverage.",
      "Many useful Exchange routes are OData function calls with embedded parameters, so literal timestamped paths from one capture will be brittle when replayed later.",
    ],
  },
  {
    title: "SharePoint",
    portals: ["SharePoint"],
    authModel: "Portal session cookie (`FedAuth`) + same-origin SharePoint headers",
    baseUrls: ["https://{tenant}-admin.sharepoint.com/_api"],
    confirmedDetails: [
      "The observed SharePoint-specific surface is same-origin `/_api/*` traffic on the tenant's `-admin.sharepoint.com` host rather than `graph.microsoft.com` or the generic Microsoft 365 shell.",
      "Observed POST requests included `x-requestdigest`, `SdkVersion`, `odata-version`, and a SharePoint admin `Referer` alongside the authenticated browser cookies.",
      "The captured routes covered Home, Active sites, Deleted sites, site-detail tabs, Settings, Migration, More features, and Advanced management, with no second SharePoint-specific non-Graph API family beyond `/_api`.",
    ],
    practicalGuidance: [
      "Start from a real authenticated SharePoint admin browser tab and keep the tenant-specific `-admin.sharepoint.com` host intact when replaying requests.",
      "Validate access with read-only calls such as `/_api/TenantAdminEndpoints`, `/_api/TenantInformationCollection`, `/_api/SPO.Tenant/sites('{siteId}')`, or `/_api/StorageQuotas()` before attempting POST requests.",
      "Expect many useful routes to expose internal SharePoint list names, migration property keys, and service objects rather than polished public contracts.",
    ],
    mutationGuidance: [
      "Treat POST calls such as `RenderAdminListData`, `ExportToCSV`, `GetSitesByState`, `GetSiteAdministrators`, and `UpdateJobsWorkItems` as live portal operations even when they look report-like or read-heavy.",
      "If you need more write coverage, capture the exact portal payload first and preserve original state in a safe tenant before replaying anything.",
    ],
    pitfalls: [
      "The portal mixes SharePoint-specific `/_api` traffic with generic shell calls to `admin.microsoft.com`, `portal.office.com`, and telemetry endpoints; only the same-origin SharePoint host belongs in this family.",
      "Request digests are short-lived and tied to the current page context, so replay can fail even when the browser cookies are still valid.",
      "Some confirmed routes returned empty or null responses in this tenant, especially migration and settings-adjacent helpers, but they are still real portal endpoints.",
    ],
  },
  {
    title: "Teams admin center",
    portals: ["Teams"],
    authModel: "Portal bearer token + same-origin portal context",
    baseUrls: [
      "https://admin.teams.microsoft.com",
      "https://teams.microsoft.com/api",
      "https://api.interfaces.records.teams.microsoft.com",
      "https://monitoringplatform.teams.microsoft.com/api",
    ],
    confirmedDetails: [
      "Most cross-origin Teams admin calls used browser-acquired bearer tokens, while same-origin `POST /api/log` depended on the active portal context.",
      "The spec preserves separate sections for each discovered API family, including `teams.microsoft.com/api`, `api.interfaces.records.teams.microsoft.com`, monitoring, config, virtual visits, monetization, reports, CQD bootstrap, tags, and app catalog services.",
      "Regional discovery is part of normal portal startup via endpoints such as `POST /api/authsvc/v1.0/users/region`, `GET /api/v1/regionalDomainNameForTenant`, and `GET /api/v1/mta/TenantclusterLookup`.",
    ],
    practicalGuidance: [
      "Start from an authenticated `admin.teams.microsoft.com` browser tab and validate access with resolver or lookup endpoints before replaying partitioned or regional service calls.",
      "Capture the region, partition, tenant ID, and any region-specific host values first; several Teams backends depend on that discovery chain rather than a fixed global host.",
      "Keep page context in mind when following the portal into reports, app catalog, virtual visits, or telephony flows, because those features fan out to different backend families.",
    ],
    mutationGuidance: [
      "Treat `PUT /api/v1/userpreference` and any future Teams POST or PUT outside the confirmed read-like bootstrap calls as live writes with tenant impact.",
      "Even read-like POSTs such as `POST /api/authsvc/v1.0/users/region` or `POST /hasActiveCapabilities` should be captured from the portal first so you preserve the exact auth and request shape.",
    ],
    pitfalls: [
      "The Teams admin center mixes same-origin portal routes, partitioned Teams APIs, and region-specific service hosts, so a valid token alone is not enough if you skip the discovery step.",
      "Some routes, such as virtual visits aggregate records, are real but sensitive to exact query defaults and can return contextual `422` responses when replayed without the right state.",
      "Dashboard widgets introduce adjacent Office-hosted report and app-catalog APIs that are specific to the Teams admin experience even though they do not live on a `teams.microsoft.com` hostname.",
    ],
  },
  {
    title: "Viva Engage admin",
    portals: ["Viva Engage"],
    authModel: "MSAL PKCE bearer token + same-origin GraphQL",
    baseUrls: [
      "https://engage.cloud.microsoft/graphql",
      "https://api.engage.cloud.microsoft/api/v1/oauth2/aad_access_token",
    ],
    confirmedDetails: [
      "The first live seed redirected to Microsoft Entra sign-in, which confirmed the MSAL PKCE flow and the `https://www.yammer.com/user_impersonation openid profile offline_access` scope.",
      "Live capture confirmed same-origin `RealtimeConnectionSettingsClients`, the cross-host `https://api.engage.cloud.microsoft/api/v1/oauth2/aad_access_token` helper, and the transient `*.rt.yammer.com/cometd/` relay chain that the GraphQL response bootstraps.",
      "Telemetry sinks `/api/v1/yamalytics/webui`, `/api/v2/events`, and `/api/v3/events` were observed in bundles and are intentionally excluded from the published spec.",
    ],
    practicalGuidance: [
      "Start from an already-authenticated `https://engage.cloud.microsoft/main/admin` tab and capture the first hydrated GraphQL requests, especially `RealtimeConnectionSettingsClients`, before chasing bundle-only route hints.",
      "Preserve the MSAL redirect context, requested scope, any `Authorization` or `X-Request-Id` headers, and the redacted Bayeux handshake shape, but never store raw token or cookie values in committed artifacts.",
      "Treat the visible `Generate code` and `Redeem code` affordances on `/main/admin/setup-external-network` as likely live writes; prefer direct-route capture and bundle inspection before clicking them.",
    ],
    mutationGuidance: [
      "Treat future non-telemetry POSTs under `/graphql` or `api.engage.cloud.microsoft` as live writes until the browser flow proves they are read-only.",
      "If you map a new admin mutation, capture the full GraphQL document or request body and confirm the rendered page state before replaying anything.",
    ],
    pitfalls: [
      "Unauthenticated deep crawls fall back immediately to Microsoft Entra sign-in, so bundle analysis alone is not enough to publish field-level GraphQL operations.",
      "The client bundles also reference legacy Yammer hosts such as `msgraph.yammer.com`, `broadcast.yammer.com`, and transient `*.rt.yammer.com`; only the realtime relay family has direct live-confirmed admin traffic so far.",
      "Conditional `X-Yam-*` headers appear to depend on request scope and may not be present on every admin request.",
    ],
  },
  {
    title: "M365 Apps admin center",
    portals: ["M365 Apps Config", "M365 Apps Services", "M365 Apps Inventory"],
    authModel: "Portal bearer token + diagnostic headers",
    baseUrls: [
      "https://config.office.com",
      "https://clients.config.office.net",
      "https://query.inventory.insights.office.net",
    ],
    confirmedDetails: [
      "All three specs use browser-obtained bearer tokens from the live M365 Apps admin center session.",
      "Observed requests include diagnostic headers such as `x-api-name`, `x-correlationid`, `x-manageoffice-client-sid`, and `x-requested-with`.",
      "Config covers servicing and policy saves, Services covers feature/onboarding/release lookups, and Inventory covers device, add-in, and security-currency paths.",
    ],
    practicalGuidance: [
      "Start from a signed-in `config.office.com` session and validate access with read-only calls on the same host family you intend to automate.",
      "Keep host-specific routing in mind: `config.office.com`, `clients.config.office.net`, and `query.inventory.insights.office.net` serve different parts of the M365 Apps experience.",
      "Use browser capture for write flows first; setup and security-status operations include real POST and PUT requests with tenant impact.",
    ],
    mutationGuidance: [
      "Treat configuration updates, Setup saves, and Security Currency Goal posts as live writes.",
      "Capture the original values and portal request bodies before replaying any mutation, and test only in a safe tenant.",
    ],
    pitfalls: [
      "The portal spreads related workflows across multiple hosts that share the same token/header model.",
      "Preview or bundle-only hosts such as canary, sip, or health surfaces are not necessarily active in every tenant.",
      "Missing diagnostic headers can look like generic API or auth failures even when the bearer token is valid.",
    ],
  },
  {
    title: "Intune Portal and Autopatch",
    portals: ["Intune Portal", "Intune Autopatch"],
    authModel: "Portal bearer token + same-origin cookies or portal headers",
    baseUrls: [
      "https://intune.microsoft.com/api",
      "https://services.autopatch.microsoft.com",
    ],
    confirmedDetails: [
      "Both specs use browser-obtained bearer tokens from the live Intune admin center session.",
      "Intune Portal also carries same-origin cookies plus portal headers such as `x-ms-client-request-id`, `x-ms-client-session-id`, `x-ms-extension-flags`, and `x-requested-with`.",
      "Intune Autopatch confirmed live tenant, support, and access-control paths on `services.autopatch.microsoft.com`, with additional support detail and mutation shapes recovered from the Support requests bundle.",
    ],
    practicalGuidance: [
      "Start from a real authenticated Intune admin center browser session and validate access with read-only calls such as `GET /api/Flighting`, `GET /api/v1.0/tenant/resolve`, or `POST /api/Settings/Select`.",
      "Keep the current blade in mind when replaying requests: Tenant administration routes can redirect into different blade namespaces such as the roles landing blade or connectors menu.",
      "Expect the portal host to mix useful same-origin APIs with telemetry, ARM calls, and static extension loading; isolate the feature-specific calls before automating.",
    ],
    mutationGuidance: [
      "Treat `POST /api/Settings/Update` and any undocumented Autopatch onboarding/support mutations as live writes with tenant impact.",
      "If you need to map a write flow, capture the request shape from the browser first, wait before making a change, record the original value, and revert immediately after testing in a safe tenant.",
    ],
    pitfalls: [
      "The Intune portal issues a large amount of telemetry and extension bootstrapping traffic that is easy to confuse with real feature APIs.",
      "Some bundles reference Microsoft Graph or public ARM paths alongside the undocumented Intune and Autopatch hosts; only the dedicated non-Graph hosts belong in this family.",
      "Bundle-visible paths are not always safe GETs: `PreOnboardTenant` returned `405 Method Not Allowed` when probed as a GET and should be treated as a likely write-oriented flow.",
    ],
  },
  {
    title: "Power Platform admin center",
    portals: ["Power Platform"],
    authModel: "Portal bearer tokens + service-specific audiences",
    baseUrls: [
      "https://api.bap.microsoft.com",
      "https://api.admin.powerplatform.microsoft.com",
      "https://{region}.adminanalytics.powerplatform.microsoft.com",
      "https://{region}.csanalytics.powerplatform.microsoft.com",
      "https://licensing.powerplatform.microsoft.com",
      "https://{tenantHost}.tenant.api.powerplatform.com",
      "https://{organizationHost}.crm.dynamics.com",
      "https://{portalInfraHost}.portal-infra.dynamics.com",
    ],
    confirmedDetails: [
      "The spec combines nine backend families observed live from `admin.powerplatform.microsoft.com`, including new `*.crm.dynamics.com` and `*.portal-infra.dynamics.com` sections recovered from environment, deployment, security, and Power Pages detail surfaces.",
      "Coverage came from exhaustive same-origin crawling of left-nav routes, list/detail drill-ins, read-only pivots, and safe report interactions rather than a landing-page sweep.",
      "Regional, tenant-scoped, organization-scoped, and portal-infra hosts are modeled with server variables so the same paths cover shard-specific PPAC and Dataverse hosts.",
    ],
    practicalGuidance: [
      "Start from a real authenticated Power Platform admin center session because the portal fans out across multiple backends with different tokens, headers, and shard-specific hosts.",
      "Drill into list rows, environment hubs, read-only tabs and pivots, and safe report interactions because many dedicated CRM and Power Pages endpoints do not appear on landing views.",
      "Validate access with read-only environment, analytics, capacity, governance, deployment, or portal-management calls on the host family you care about before replaying any mutations.",
    ],
    mutationGuidance: [
      "Treat Business App Platform POSTs, governance policy operations, and licensing/capacity actions as live tenant changes unless you have proven otherwise in a safe tenant.",
      "When documenting a new flow, capture the original browser request body and headers per host family first because replaying the wrong bearer audience against another backend will fail or produce misleading errors.",
    ],
    pitfalls: [
      "A token that works for one Power Platform backend is not automatically valid for another backend in the same admin center session.",
      "Regional, tenant-specific, organization-specific, and portal-infra hosts change by tenant and blade, so hardcoding captured hosts will make automation brittle.",
      "Some same-origin routes are tenant-dependent: this crawl hit feature-limited Copilot pages, no-data usage and portal blades, and permission-limited Dataverse user or role-editor details.",
      "The admin center also touches Microsoft Graph, static assets, and downstream Dynamics-related surfaces, so isolate the non-Graph Power Platform hosts before expanding scope.",
    ],
  },
  {
    title: "Entra IAM",
    portals: ["Entra IAM"],
    authModel: "Delegated OAuth2 + `X-Ms-Client-Request-Id`",
    baseUrls: ["https://main.iam.ad.ext.azure.com/api"],
    confirmedDetails: [
      "The spec models OAuth2 authorization code flow against the ADIbizaUX resource `74658136-14ec-4630-ad9b-26e160ff0fc6`.",
      "The description explicitly says the API only supports delegated auth and does not support service principals or client credentials flow.",
      "The spec also notes that the majority of requests require `X-Ms-Client-Request-Id` to be set to a GUID.",
    ],
    practicalGuidance: [
      "Use Azure Portal or Azure CLI delegated tokens first because the spec documents both as pre-consented clients.",
      "If you are scripting requests, include a fresh request ID and keep the token scoped to the IAM resource rather than Microsoft Graph.",
      "Validate permissions with read operations before trying policy or directory writes.",
    ],
    mutationGuidance: [
      "Most write endpoints touch core identity objects such as users, groups, apps, and policies, so use an isolated tenant for any experimentation.",
      "If you only need to understand a write flow, start by capturing the portal request shape and body rather than replaying it immediately.",
    ],
    pitfalls: [
      "Using a Graph token or client-credentials flow will not match the auth model documented by the spec.",
      "Missing `X-Ms-Client-Request-Id` can break otherwise valid requests.",
      "Portal-only features can expose behavior that does not line up exactly with public Microsoft Graph operations.",
    ],
  },
  {
    title: "Entra PIM, IGA, IDGov, and B2C",
    portals: ["Entra PIM", "Entra IGA", "Entra IDGov", "Entra B2C"],
    authModel: "Azure AD bearer tokens",
    baseUrls: [
      "https://api.azrbac.mspim.azure.com",
      "https://elm.iga.azure.com",
      "https://api.accessreviews.identitygovernance.azure.com",
      "https://main.b2cadmin.ext.azure.com",
    ],
    confirmedDetails: [
      "All four specs model HTTP bearer auth with Azure AD JWTs.",
      "Entra B2C documents `tenantId` query context as required on most endpoints and allows either a GUID or tenant domain.",
      "The PIM, IGA, and IDGov descriptions all call out license- or feature-gated behavior for some endpoints.",
    ],
    practicalGuidance: [
      "Use delegated user tokens with the appropriate Entra role or governance permissions for the portal area you are targeting.",
      "Keep tenant context, provider IDs, and feature flags in mind when replaying requests because several endpoints are scoped more narrowly than the URL alone suggests.",
      "Start with list endpoints and configuration reads so you can distinguish missing permission from disabled feature paths.",
    ],
    mutationGuidance: [
      "Assume activation requests, access review actions, billing changes, and B2C initialization endpoints are real writes with tenant impact.",
      "If you are documenting a write flow, capture and annotate the request path, headers, and payload first, then replay only in a safe tenant.",
    ],
    pitfalls: [
      "404 can mean a feature or license is unavailable, not just that the route is wrong.",
      "B2C and IDGov endpoints often depend on tenant- or provider-specific routing values beyond the bearer token.",
      "Portal features may fall back to Microsoft Graph for some related workflows, so not every Entra screen maps entirely to these dedicated endpoints.",
    ],
  },
];
