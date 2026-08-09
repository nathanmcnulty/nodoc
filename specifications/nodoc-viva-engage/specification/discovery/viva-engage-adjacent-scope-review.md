# Viva Engage bounded discovery adjacency scope-review handoff

Portal: Viva Engage  
Spec: viva-engage  
Artifacts directory: `C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-viva-engage-discovery-1c319b10-f452-4be9-964a-99d91c40bc6d`

## Run completion

- Status: completed
- Recommended next action: `review-adjacent-candidate-scope`
- Candidate counts: confirmed-read=0, confirmed-safety=0, successfully-probed=0, bundle-only=42, suppressed=0, adjacent-confirmed-read=35, adjacent-safety=9, adjacent-probed=0, adjacent-bundle-only=0
- Evidence channels: GraphQL=0, RPC=0, streaming=0, successful probe results=0

This is an ownership handoff only. No adjacent route is promotion-ready for the Viva Engage
specification, and no write or probe should be performed from this artifact without a separate
scope and safety decision.

## Confirmed reads requiring scope assignment

| Method | Normalized path or family | Observed host family | Recommended owner | Reason |
| --- | --- | --- | --- | --- |
| GET | `/owamail/.../resources/boot-analytics-ping.js` | `[redacted-host]` | Outlook web / OWA spec | Cross-product boot asset; not Viva Engage API surface |
| GET | `/api/myapps/GetAppDataCache`, `/api/shell/navbardata`, `/api/storage/SystemMetadata/User/AppsPinnedData`, `/api/v1/livepersonacard/configuration` | `{tenant}.{tenant}.office.com` | Microsoft 365 shell / Teams-family spec | Shared shell and persona services; host and path are outside Viva Engage |
| GET | `/files/...` (four Fabric assets) | `{tenant}.{tenant}.office.net` | Microsoft 365 static-assets owner | Front-end fonts and animation assets, not API operations |
| GET | `/shellux/...` (two shell localization/theme assets) | `{tenant}.{tenant}.office.net` | Microsoft 365 shell / Teams-family spec | Shared shell resources |
| GET | `/teams-js/validDomains/json/validDomains.json` | `{tenant}.{tenant}.office.net` | Teams platform spec | Teams SDK configuration asset |
| GET | `/yammer/.../yammer-locale/en-us/*.json` (20 locale assets) | `{tenant}.{tenant}.office.net` | Yammer/Viva shared static-assets owner | Localization bundles, not callable API routes |
| GET | `/config/v1/YammerClients/0.0.1` | `ecs.office.com` | `security-copilot` or shared ECS owner | Existing matching spec metadata points outside Viva Engage |
| GET | `/v1.0/users/{id}/photo/$value` | `graph.microsoft.com` | Microsoft Graph spec | Microsoft Graph profile-photo read |

The grouped rows above account for all 35 adjacent confirmed reads from the handoff artifact.
Individual URL evidence remains in `candidate-handoff.json`; the grouped presentation avoids
turning static asset paths into proposed API operations.

## Confirmed safety-classification candidates requiring scope assignment

| Method | Normalized path | Observed host family | Recommended owner | Safety classification |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/yamalytics/webui` | `[redacted-host]` | Viva telemetry / shared telemetry owner | Telemetry sink; do not probe or promote |
| POST | `/api/v2/events` | `[redacted-host]` | Viva telemetry / shared telemetry owner | Telemetry sink; do not probe or promote |
| POST | `/api/v3/events` | `[redacted-host]` | Viva telemetry / shared telemetry owner | Telemetry sink; do not probe or promote |
| POST | `/Collector/3.0` | `{tenant}.{tenant}.{tenant}.microsoft.com` | Microsoft telemetry owner | Telemetry collector; do not probe or promote |
| POST | `/OneCollector/1.0` | `{tenant}.{tenant}.{tenant}.microsoft.com` | Microsoft telemetry owner | Telemetry collector; do not probe or promote |
| POST | `/api/v2/personacards/preparePersona` | `{tenant}.{tenant}.{tenant}.office.com` | Microsoft 365 persona service owner | Potential stateful preparation call; no probe authorized |
| PUT | `/api/settings/theme` | `{tenant}.{tenant}.office.com` | Microsoft 365 shell owner | Confirmed non-GET; write-like settings operation; no probe authorized |
| POST | `/organizations/{id}/v2.0/token` | `{tenant}.microsoftonline.com` | Microsoft Entra authentication owner | Token endpoint; never probe or promote from portal discovery |
| POST | `/owa/{id}/startupdata.ashx` | `{tenant}.office.com` | Outlook web / OWA spec | OWA startup endpoint; outside Viva Engage |

These nine candidates require explicit owner and safety review. They are not confirmed Viva Engage
operations and must not be replayed, submitted, or converted into OpenAPI paths by this handoff.

## Successful probes

- None.

## Bundle-only validation candidates

- 42 candidates remain bundle-only and are not promotion-ready.
- Keep them in a separate targeted validation pass; require a matching host family and a safe,
  read-only runtime confirmation before any specification review.
- Do not treat bundle presence as evidence that a route is reachable or supported.

## Suppressions

- None emitted by the driver.

## Adjacent scope-review evidence

- Adjacent confirmed reads: 35; assign by host family before any promotion review.
- Adjacent confirmed non-GETs: 9; classify as telemetry, authentication, startup, settings, or
  persona behavior before considering ownership.
- Adjacent successful probes: 0.
- Adjacent bundle-only leads: 0.
- Primary Viva Engage confirmed reads: 0.
- Primary Viva Engage confirmed non-GETs: 0.
- Primary Viva Engage successful probes: 0.

## Recommended next actions

- Keep the Viva Engage OpenAPI surface unchanged from this run.
- Route the explicit `security-copilot` match for `/config/v1/YammerClients/0.0.1` to that
  specification’s owner for independent review.
- Route the Graph photo request to the Microsoft Graph owner.
- Route shell, Office static assets, Teams SDK configuration, OWA, Entra token, persona, and
  telemetry entries to their respective owning specifications or shared-service owners.
- Run a separate, human-approved bounded validation for selected bundle-only leads only after
  host-family ownership is established.
- Do not promote adjacent entries without explicit specification assignment and safety review.
