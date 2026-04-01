# nodoc-recorder — API Traffic Recorder

A Chrome/Edge DevTools extension that captures API traffic from Microsoft portals for OpenAPI specification generation.

## Supported Portals

| Portal | Domain | API Path |
|--------|--------|----------|
| Defender XDR | `security.microsoft.com` | `/apiproxy/*` |
| M365 Admin | `admin.cloud.microsoft` | `/admin/api/*` |
| Microsoft Purview | `purview.microsoft.com` | `/apiproxy/*` |
| Entra IAM | `main.iam.ad.ext.azure.com` | `/api/*` |
| Entra IGA | `elm.iga.azure.com`, `api.accessreviews.identitygovernance.azure.com` | `/api/*` |

## Installation

1. Open **Edge** or **Chrome** and navigate to `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select this `tools/nodoc-recorder` directory.
4. Open DevTools (F12) on any supported portal — the **nodoc-recorder** tab will appear.

> **Note:** Icon files are not included yet. The extension will load without them.

## Usage

1. Navigate to a supported Microsoft portal (e.g., `security.microsoft.com`).
2. Open DevTools (F12) and switch to the **nodoc-recorder** panel.
3. Interact with the portal — API requests matching the configured patterns will be captured automatically.
4. Use the **portal filter** dropdown to focus on a specific portal.
5. Click any request to view full details (URL, headers, request/response bodies).

### Export Options

- **Export YAML** — Generates an OpenAPI 3.0.3 spec fragment with all captured endpoints grouped by path and method.
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
