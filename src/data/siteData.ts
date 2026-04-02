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

export const apiCatalog: ApiCatalogItem[] = [
  {
    title: "Defender",
    slug: "/defender",
    family: "Security portal",
    operations: 261,
    authModel: "Portal session cookie (`sccauth`)",
    baseUrl: "https://security.microsoft.com/apiproxy",
    summary:
      "Security operations coverage across alerts, incidents, hunting, endpoint, identity, vulnerability, and exposure workflows.",
    highlights: [
      "Alerts, incidents, and action center coverage",
      "Advanced hunting, custom detections, and live response",
      "Endpoint, identity, XSPM, and TVM portal surfaces",
    ],
    collectionPath: "postman/collections/defender.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/defender.collection.json",
  },
  {
    title: "M365 Admin",
    slug: "/m-365-admin",
    family: "Admin portal",
    operations: 215,
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
    title: "Purview",
    slug: "/purview",
    family: "Security portal",
    operations: 74,
    authModel: "Portal session cookie (`sccauth`)",
    baseUrl: "https://purview.microsoft.com/apiproxy",
    summary:
      "Compliance, governance, eDiscovery, audit, insider risk, and shared data-service coverage from the Purview portal.",
    highlights: [
      "Data infrastructure, governance, and compliance manager",
      "eDiscovery, audit, DLP devices, and insider risk",
      "Shared backend prefixes called out alongside Defender",
    ],
    collectionPath: "postman/collections/purview.collection.json",
    collectionDownloadUrl:
      "https://raw.githubusercontent.com/nathanmcnulty/nodoc/main/postman/collections/purview.collection.json",
  },
  {
    title: "Entra IAM",
    slug: "/entra-iam",
    family: "Entra portal",
    operations: 277,
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
    operations: 14,
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
    operations: 14,
    authModel: "Azure AD bearer token",
    baseUrl: "https://elm.iga.azure.com",
    summary:
      "Identity Governance administration coverage for entitlement management, guest billing, settings, and lifecycle workflows.",
    highlights: [
      "Non-Graph governance surfaces observed in the portal",
      "OData query parameters modeled for list endpoints",
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
    operations: 11,
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

export const launchStats = [
  { label: "Published specs", value: "8" },
  { label: "Modeled operations", value: "871" },
  { label: "Access models", value: "4" },
  { label: "Checked-in collections", value: "8" },
];

export const accessModels: AccessModel[] = [
  {
    title: "Portal session cookies",
    description:
      "Defender and Purview rely on the portal's `sccauth` cookie and an authenticated browser session.",
    portals: ["Defender", "Purview"],
  },
  {
    title: "Portal session + custom headers",
    description:
      "M365 Admin requires `AjaxSessionKey` plus portal routing and hosting headers extracted from the admin shell.",
    portals: ["M365 Admin"],
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
    title: "Defender XDR and Purview",
    portals: ["Defender", "Purview"],
    authModel: "Portal session cookie (`sccauth`)",
    baseUrls: [
      "https://security.microsoft.com/apiproxy",
      "https://purview.microsoft.com/apiproxy",
    ],
    confirmedDetails: [
      "Both specs model `PortalSession` as an API key in the `sccauth` cookie.",
      "Both portals route through `/apiproxy` and call out shared backend prefixes such as `/di/`, `/gws/`, `/medeina/`, `/msgraph/`, and `/shell/`.",
      "The specs explicitly say these APIs are used internally by the portals and are not officially documented.",
    ],
    practicalGuidance: [
      "Authenticate to the portal in a browser first, then capture the active session context before replaying requests elsewhere.",
      "Expect portal-only behavior such as short-lived sessions, backend-specific authorization, and inconsistent errors across different proxy prefixes.",
      "Start with list and lookup operations so you can validate the session cookie and shared-service routing without changing state.",
    ],
    mutationGuidance: [
      "Treat any POST, PATCH, PUT, or DELETE call as a live tenant change unless you have verified otherwise from portal behavior.",
      "For mutation mapping, prefer observing browser traffic and saving request/response examples over replaying state-changing calls.",
    ],
    pitfalls: [
      "Expired portal sessions usually fail without a helpful auth error.",
      "Shared prefixes can expose different subsets of the same backend depending on the portal you entered through.",
      "Because these APIs are internal, some endpoints can disappear or change shape with little warning.",
    ],
  },
  {
    title: "M365 Admin",
    portals: ["M365 Admin"],
    authModel: "Portal session cookie + custom admin headers",
    baseUrls: ["https://admin.cloud.microsoft"],
    confirmedDetails: [
      "The spec models `AjaxSessionKey` as the session cookie and documents `x-portal-routekey`, `x-adminapp-request`, `x-ms-mac-appid`, and `x-ms-mac-hostingapp` as required headers for most requests.",
      "The documented application ID is `f00c5fa5-eee4-4f57-88fa-c082d83b3c94`, and the hosting app name is `M365AdminPortal`.",
      "M365 Admin uses `/admin/api/` and a separate `/fd/msgraph/` proxy instead of the shared Defender/Purview `/apiproxy` layout.",
    ],
    practicalGuidance: [
      "Capture the portal bootstrap or initial admin-shell requests so you can reproduce the required routing headers alongside the cookie.",
      "Keep request context tied to the admin experience you are using; several endpoints depend on admin-shell state in addition to auth.",
      "Use GET requests against shell, navigation, and current-user endpoints to confirm your headers before touching tenant settings.",
    ],
    mutationGuidance: [
      "Assume tenant, user, policy, and app-management endpoints will apply immediately to your tenant.",
      "When mapping writes, collect payloads from the portal UI and document them before you attempt any replay in a disposable tenant.",
    ],
    pitfalls: [
      "Missing one of the custom admin headers can look like a generic auth or routing failure.",
      "Some data comes through federated Graph proxies and can differ from the shared Graph proxy behavior in Defender or Purview.",
      "Header values can change as the admin shell bootstraps or refreshes.",
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
