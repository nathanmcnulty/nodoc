# nodoc-recorder — API Traffic Recorder

A Chrome/Edge DevTools extension that captures API traffic from Microsoft portals for OpenAPI specification generation.

## Supported Portals

| Portal | Domain | API Path |
|--------|--------|----------|
| Defender | `security.microsoft.com` | `/apiproxy/*` |
| M365 Admin | `admin.cloud.microsoft` | `/admin/api/*` |
| SharePoint Admin | `{tenant}-admin.sharepoint.com` | `/_api/*` |
| Purview | `purview.microsoft.com` | `/apiproxy/*` |
| Purview Portal | `purview.microsoft.com` | `/api/*` |
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

Edit the `portalConfig` array in both `background.js` and `panel.js`, then update `host_permissions` in `manifest.json` with the new URL patterns.
