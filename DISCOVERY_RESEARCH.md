# Discovery Research Backlog

This file tracks discovery improvements that need design or live-portal
experiments before they are safe to automate.

## High priority

### Safe GraphQL and RPC probing

Bundle mining records GraphQL operation names, but the runner intentionally
permits only GET probes. Design a query-only POST mode that parses the GraphQL
document, rejects mutations and subscriptions, fixes the endpoint and headers
to an observed request family, and never accepts arbitrary payloads. Apply the
same semantic treatment to OData batch, JSON-RPC, and constant-URL command APIs.

### Source-map acquisition

The bundle manifest records source-map URLs but does not fetch them. Evaluate a
credential-free downloader restricted to the observed script host, HTTPS, size
limits, public address ranges, manual redirects, and content-addressed storage.
Measure whether source maps materially improve route, enum, and request-factory
recovery before enabling this by default.

### Role, license, and tenant-state matrix

One authenticated tenant cannot establish complete coverage. Define a sanitized
comparison format for role, license, feature-flag, empty-data, and populated-data
runs. Store only normalized coverage deltas and blocker classifications, never
tenant identifiers or credentials.

### Portal manifest consolidation

Host and path matching still appears in multiple recorder and discovery
surfaces. Replace it with one validated portal manifest that drives the
extension, capture runner, recipes, candidate scoping, and coverage ledger.
Account for extension host-permission generation before removing duplicated
configuration.

## Medium priority

### Content-addressed analysis cache

Bundles already use content hashes on disk, but mining is repeated at every
checkpoint. Cache parsed candidates by parser version, bundle hash, and prefix
set. Add a feature-to-bundle index so unchanged shell chunks can be skipped.

### Semantic control traversal

The bounded crawler follows links but does not autonomously exercise arbitrary
buttons, shadow DOM, virtualized rows, or form-backed tabs. Design a read-only
control classifier with explicit deny rules, per-state action budgets, and
state restoration. Validate it against representative settings, report, and
list/detail portals before general use.

### Coverage saturation

Define stop criteria based on consecutive states producing no new normalized
route families, payload-shape fingerprints, GraphQL operations, script hashes,
or passive transports. Avoid stopping early when several shell pages precede a
feature-specific route.

### Streaming payload semantics

Passive WebSocket, EventSource, and beacon endpoint inventory is safe. Frame
payload mining is not yet enabled because messages may contain tenant data,
tokens, or high-volume telemetry. Design bounded redaction and operation-name
extraction before persisting frames.

## Completed foundation

- Authenticated XHR/fetch capture with redacted artifacts
- Adaptive network-idle settling
- State and request/response shape fingerprints
- Bounded same-origin link crawling
- Same-origin GET probing with structured outcomes
- Authenticated JavaScript bundle capture and AST mining
- GraphQL operation-name and source-map-reference extraction
- Candidate evidence separation for confirmed, probed, and bundle-only routes
