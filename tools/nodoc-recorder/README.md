# nodoc-recorder — API Traffic Recorder

A Chrome/Edge DevTools extension that captures API traffic from Microsoft portals for OpenAPI specification generation.

## Supported Portals

| Portal | Domain | API Path |
|--------|--------|----------|
| Defender | `security.microsoft.com` | `/apiproxy/*` |
| M365 Admin | `admin.cloud.microsoft` | `/admin/api/*` |
| Exchange | `admin.exchange.microsoft.com` | `/beta/*` |
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

### Export Options

- **Export YAML** — Generates an OpenAPI 3.0.3 spec fragment with inferred server URLs, query parameters, request/response schemas, primitive formats, and scalar examples.
- **Export JSON** — Exports the full captured request/response data for further processing or scripting.
- **Copy cURL** — Copies a cURL command for the selected request (sensitive headers are redacted).

### Controls

- **Record / Pause** — Toggle recording on/off.
- **Clear** — Remove all captured requests.

## Architecture

```
manifest.json        → Extension manifest (Manifest V3)
background.js        → Service worker: intercepts request bodies via webRequest API
devtools.html/js     → Registers the DevTools panel
panel.html           → Panel UI (dark theme, split-pane layout)
panel.js             → Capture logic, rendering, deduplication, and export
```

## Adding New Portals

Edit the `portalConfig` array in both `background.js` and `panel.js`, including any exact `hostnames`, wildcard `hostSuffixes`, and `pathPrefixes`, then update `host_permissions` in `manifest.json` with the new URL patterns.
