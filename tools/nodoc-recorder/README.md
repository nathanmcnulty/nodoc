# nodoc-recorder — API Traffic Recorder

A Chrome/Edge DevTools extension that captures API traffic from Microsoft portals for OpenAPI specification generation.

## Supported Portals

| Portal | Domain | API Path |
|--------|--------|----------|
| Defender | `security.microsoft.com` | `/apiproxy/*` |
| M365 Admin | `admin.cloud.microsoft` | `/admin/api/*` |
| Exchange | `admin.exchange.microsoft.com`, `exchange.admin.cloud.microsoft` | `/beta/*` |
| SharePoint | `{tenant}-admin.sharepoint.com` | `/_api/*` |
| Teams | `admin.teams.microsoft.com` + related Teams/Office hosts | `/api/*`, `/admin/api/*`, `/amer/api/*`, `/data/*`, `/Teams.*`, `/Skype.*`, `/config/*`, `/repository/*`, and related report/app-catalog paths |
| M365 Apps Config | `config.office.com` | `/appConfig/*`, `/endpointprovisionhealth/*`, `/intents/*`, `/policyadmin/*`, `/releases/*`, `/rollout/*`, `/serviceProfile/*`, `/ServiceProfile/*`, `/settings/*` |
| M365 Apps Services | `clients.config.office.net` | `/intents/*`, `/odbhealth/*`, `/onboarding/*`, `/releases/*` |
| M365 Apps Inventory | `query.inventory.insights.office.net` | `/inventory/*` |
| Intune Autopatch | `services.autopatch.microsoft.com` | `/api/*`, `/tenant-management/*`, `/update-management/*`, `/access-control/*`, `/device/*`, `/unified-reporting/*`, `/reporting/*`, `/support/*` |
| Intune Portal | `intune.microsoft.com` | `/api/*` |
| Power Platform | `api.bap.microsoft.com`, `api.admin.powerplatform.microsoft.com`, `licensing.powerplatform.microsoft.com`, `*.adminanalytics.powerplatform.microsoft.com`, `*.csanalytics.powerplatform.microsoft.com`, `*.tenant.api.powerplatform.com`, `*.crm.dynamics.com`, `*.portal-infra.dynamics.com` | `/providers/*`, `/api/*`, `/analytics/*`, `/governance/*`, `/notificationservice/*`, `/v0.1*`, `/v0.1-alpha*`, `/v1.0*`, `/api/data/*`, `/api/nosql/*`, `/api/v1/*` |
| Purview | `purview.microsoft.com` | `/apiproxy/*` |
| Purview Portal | `purview.microsoft.com` | `/api/*` |
| Security Copilot | `api.securitycopilot.microsoft.com`, `api.securityplatform.microsoft.com`, `*.api.securityplatform.microsoft.com`, `prod.cds.securitycopilot.microsoft.com`, `securitymarketplaceapi-prod.microsoft.com`, `ecs.office.com` | `/auth*`, `/users/*`, `/settings/*`, `/userPreferences/*`, `/usage/*`, `/graphData/*`, `/provisioning/*`, `/account/*`, `/api/gateway/*`, `/pods/*`, `/trial`, `/catalog/*`, `/config/v1/SecurityMarketplaceClient/*` |
| Entra IAM | `main.iam.ad.ext.azure.com` | `/api/*` |
| Entra IGA | `elm.iga.azure.com` | `/api/*` |
| Entra PIM | `api.azrbac.mspim.azure.com` | `/api/*` |
| Entra IDGov | `api.accessreviews.identitygovernance.azure.com` | `/accessReviews/*` |
| Entra B2C | `main.b2cadmin.ext.azure.com` | `/api/*` |

## Installation

1. Open **Edge** and navigate to `edge://extensions` (or use `chrome://extensions` if Chrome is available).
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select this `tools/nodoc-recorder` directory.
4. Open DevTools (F12) on any supported portal — the **nodoc-recorder** tab will appear.

## Usage

1. Navigate to a supported Microsoft portal (e.g., `security.microsoft.com`).
2. Open DevTools (F12) and switch to the **nodoc-recorder** panel.
3. Interact with the portal — API requests matching the configured patterns will be captured automatically.
4. Use the **portal filter** dropdown to focus on a specific portal.
5. Click any request to view full details (URL, headers, request/response bodies).

Every retained request has its own observation ID. A separate variant index counts repeated evidence by origin, method, path, query-key set, media types, status, conservative request/response schemas and service error/message signature. Neither repeated requests nor same-shaped errors overwrite earlier observations. Recording pauses at 5000 observations or 32 MiB retained data; export and clear to continue. Response retrieval distinguishes empty, unavailable, invalid base64/UTF-8 and bodies omitted by the 1 MiB decoded limit.

### Export Options

- **Export YAML** - Generates a YAML 1.2 stream with one OpenAPI 3.0.3 document per origin (JSON syntax within each document). Split on the YAML document separator before passing to tools that accept one document. Retains every observed status and media type; incompatible schemas use conservative alternatives. Unknown response types remain explicit. Query/body requiredness remains unknown.
- **Export JSON** - Exports sanitized draft observations and the same origin-bound OpenAPI documents as an array. The format version is 2. Request/response bodies include schema, redacted value and capture state rather than raw text.
- **Copy cURL / Copy sanitized URL** - Copies a sanitized structural request or URL. Supply real values privately before use.

Exports replace all string body values, numeric example values, non-content-type header values and query values. Schemas are inferred before redaction. Unknown origins receive a stable pseudonym; only exact known service hosts remain. Unknown path segments receive redaction placeholders, with separate route bindings when redaction would otherwise collide. Raw captures remain private in memory and are never emitted by an export button. Opaque variant IDs preserve distinctions between private error signatures without publishing messages.

These are **sanitized drafts requiring review**, not a guarantee of safe automatic publication. Inspect retained property/header/query names and known route words, which may themselves contain environment-specific information. Unknown route placeholders cannot establish a reusable route template. Keep original evidence private for interpretation and replace placeholders only after review. Exported traffic establishes observations, not supported-method completeness, required inputs, permissions, licensing causes or retry safety.

Exports also retain capture-completeness metadata. A retention-limit refusal persists until Clear; the refusal counter only counts callbacks rejected by the bound. Traffic while recording is paused remains unobserved and is not counted.

### Controls

- **Record / Pause** — Toggle recording on/off.
- **Clear** — Remove all captured requests.

## Architecture

```
manifest.json        → Extension manifest (Manifest V3)
background.js        → Service worker: intercepts request bodies via webRequest API
devtools.html/js     → Registers the DevTools panel
panel.html           → Panel UI (dark theme, split-pane layout)
evidence.js          - Pure inference, evidence identity and sanitized export helpers
panel.js             → Capture logic, rendering, deduplication, and export
```

## Adding New Portals

Edit the `portalConfig` array in both `background.js` and `panel.js`, including any exact `hostnames`, wildcard `hostSuffixes`, and `pathPrefixes`, then update `host_permissions` in `manifest.json` with the new URL patterns.
