# Graph flighting historical-evidence Luna pilot

Review date: November 25, 2026 (local); November 26 UTC. Input revision:
`010a5a94bafcfe0300fce58d029ccf8eedbd7529`.
This bounded offline review used existing sanitized public evidence, not a
synthetic benchmark, new capture, live endpoint test, or proof of current health.

## Inputs and review

The only worker inputs were the `GraphResearch.RetrieveProjectFlightingStatuses`
operation block in
`specifications/nodoc-graph-research/specification/openapi.yml:142-226`
and `specifications/nodoc-graph-research/evidence/retrieve-project-flighting-statuses.json`.
Line references apply to the pinned input revision.
The operation is the exact beta GET function form
`/deviceManagement/retrieveProjectFlightingStatuses(projectNames=null)`.

One worker was explicitly configured `gpt-6-luna` / `xhigh`; its model was
corroborated by the runtime agent listing. Runtime reasoning-effort telemetry
was unavailable. The coordinator independently counted the same checked-in
records and checked the caveats; this was not a second model review or private
capture verification. No other model supplied a worker answer.

## Supported historical corroboration

The evidence JSON contains three distinct public artifact IDs:

- `intune-graph-inventory-optimized-20260829T222438391`
- `intune-graph-inventory-corroboration-20260829T223113209`
- `intune-graph-refresh-20260831T174500Z`

Each record declares terminal status `completed`, complete capture, consistent
interaction accounting, no unresolved mutation, HTTP status `[200]`, and
successful transport `["direct"]`. Each has empty request-shape digests and
corroborating-request transports. These are retained declarations, not new tests.

There are two distinct telemetry file hashes and two distinct telemetry digests:
the first two records share both, while the third differs. All three share one
response-shape digest and one operation observation ID. This supports historical
fingerprint-level corroboration across three listed records, not three proven
independent request events. The operation's evidence and corroborating-capture
counts of three remain unchanged.

## Limits and correction

Matching sanitized telemetry fingerprints alone prove neither duplicated
captures nor independent live calls. A shared shape digest does not prove
identical response bodies, values, semantic/business health, or independently
verify schema compatibility. Empty request-shape arrays do not establish absent
runtime request requirements. Recorded GET/read-only and no-mutation annotations
do not prove the absence of passive effects.

The JSON does not enumerate individual portal invocations or their surface
mappings. Dates encoded in public artifact IDs and the separately authored
October 31 provenance are historical claims, not independently validated
timestamps. The October provenance is not an additional record in the linked
three-artifact JSON. Its raw-witness normalization does not add operation
identities or establish an independent-call count for the August records.
Current authentication, endpoint health, minimum roles and delegated permissions
remain unproved.

The operation's safety and provenance prose was clarified to state this record
scope and fingerprint limitation. No historical count, date, artifact ID, digest,
schema, requiredness, example, transport or status was revised. The evidence JSON
was left unchanged.

## Outcome and accounting

One operation received an offline historical-evidence review and an in-scope
wording clarification. No endpoint was newly verified; no new operation was
discovered. No portal/network I/O, browser, login, Azure action, schedule change
or fresh capture occurred. Prior source work and private receipts were preserved.

Exact execution bounds and attribution were retained privately for reconciliation.
New-run token usage, billing units and provider USD were unavailable at report
time; no costs were guessed. Configuration and a returned review are not billing
telemetry. This public receipt contains no private runtime identifiers or usage.
