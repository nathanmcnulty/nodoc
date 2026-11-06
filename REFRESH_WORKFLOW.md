# Repeatable portfolio refresh

The existing discovery controller has an offline `refresh` path. It consumes one
completed capture for discovery, exact known-operation observations, and private
schema/example proposals. It does not allocate browsers, replay requests, edit
specifications, change access, or merge PRs. Capture remains the existing
`discover:portal` CLI and owner/lease/recipe workflow in
[the runbook](AGENT_DISCOVERY_RUNBOOK.md).

Use Node 24. Keep capture inputs, cache, proposals, review receipts and output
outside the repository, in separate directories. Raw property names, request
variants, captured values, body fingerprints and body lengths stay private.
The complete JSON reports are private too; publish only independently reviewed
counts and public specification references.

## Inventory and reuse

Pass a private configuration to the existing controller:

```json
{
  "asOf": "2026-11-06",
  "freshnessDays": 30,
  "cacheDir": "C:/private/refresh/cache",
  "outputDir": "C:/private/refresh/pass-1",
  "captures": [
    {"specId": "purview", "artifacts": "C:/private/captures/purview/capture"}
  ]
}
```

```powershell
npm run refresh:portfolio -- C:/private/refresh/input.json
```

An empty capture list inventories all specifications using authored metadata;
it establishes no current observations. The full inventory includes every
operation, schema/example diagnostic, historical annotation, evidence file,
recipe opportunity and prerequisite/evaluation/expiry blocker. A successful
recipe never makes the whole specification current.

The analyzer reads original raw requests when available, falling back explicitly
to aggregated API records. It verifies complete sidecars and original action
attribution, dates and canonical health. Protocol, host, port, server base,
method and canonical route must match. Ambiguous owners remain unresolved.
HTTP errors, semantic errors, no-content responses, aborts, incomplete bodies
and unobserved operations stay distinct. A 404 never recommends removal.
Semantic checks recognize known envelopes; an unfamiliar logical error remains
a review limitation. Observed roles do not establish minimum permissions.

One private analysis contains the existing candidate queue, review handoff and
partitioned handoff, known observations, enrichment candidates and supported
new-GET drafts. Adjacent traffic and writes remain in the existing review path.
Freshness, health, schema and example coverage are independent. Complete bodies
do not prove requiredness, populated states, enums, or the entire contract.

Repeat with identical inputs and a second output directory. Stable reports must
match exactly; `execution.analysesReused` records cache hits without claiming a
new observation or a new reviewer execution. Cache identity covers immutable
capture bytes, physical sidecars, analyzer dependencies, specifications, policy,
runtime and inventory. Changed bindings invalidate reuse. Both computed and
cached results recheck capture immutability. Invalid evidence blocks that capture
while independent portfolio work continues. Preserve failed artifacts.

## Focused proposals

Use the private cache entry as `analysisPath`. Select exact evidence IDs and
destination spec IDs; do not promote a whole candidate queue:

```json
{
  "analysisPath": "C:/private/refresh/cache/ANALYSIS_KEY.json",
  "outputDir": "C:/private/refresh/proposal-1",
  "selections": [
    {"specId": "purview", "evidenceId": "OBSERVATION_ID", "kind": "response-schema"}
  ]
}
```

```powershell
npm run refresh:proposals -- C:/private/refresh/proposals-input.json
```

Supported selections are `response-schema`, `synthetic-example`, and
`new-operation`. New-operation drafts require `ownershipConfirmed: true`, a
complete observed GET response and one existing public server-template binding.
They always need contract/ownership review. Other methods are retained in the
handoff for safety and request-contract review rather than guessed into drafts.

Missing/empty schemas may receive optional observed token types. Existing
nonempty schemas are not overwritten. Changed contracts, unsupported composition
and conflicting shapes require reconciliation. Null-only fields do not acquire
a non-null type; empty arrays do not supply item schemas. Examples replace
scalar values with synthetic constants and illustrate one shape, not all states.
Property names and dynamic dictionaries still require privacy review.

The command revalidates cache, capture and current analyzer bindings before
proposing anything. It follows local `$ref`s to the owning source and writes full private
YAML proposals plus the existing source-review manifest format. It never applies
them. Shared components and aliased operations need manual reconciliation so a
single observation cannot change other operations. Independent review inspects the exact manifest, original observations,
variants, privacy and semantic limitations. Use the existing
`review:source prepare`, `accept`, and `apply` gates from the runbook. A cache hit
does not bypass the current source-review gate. Then regenerate the affected
Postman collections and site data and review the focused diff.

## Dry-run merge eligibility

```powershell
npm run refresh:eligibility -- C:/private/refresh/eligibility-input.json
```

The private input names `analysisPath`, `manifestPath`, `reviewPath`, `checksPath`,
`proposalRoot`, `sourceRevision`, and `sourceReview` with the existing
`manifestPath`, `reviewPath`, `receiptPath` bindings. Check receipts must name the
actual tested revision, `sourceStateDigest` from `refreshSourceState()` in
`tools/portal-refresh-binding.mjs`, and exact manifest digest. The reporter derives
the actual Git HEAD and complete nonignored source-state binding itself; a supplied
revision string cannot establish current checks. `results` contains observed
exit codes for `discovery`, `spec-quality`, `portal-metadata`, `evaluations`,
`graph-research`, `site-data`, `postman-parity`, `typecheck`, `build`, and `privacy`.
`appliedChanges` binds each final destination to its tested proposal digest.
Use actual local/CI outcomes; declarations are not execution evidence.

The advisory report validates the existing source-review receipt, exact
before/proposal bytes and traceability. Only narrowly additive GET response schemas
without constraints/composition, and explicitly synthetic examples, can qualify.
New operations, other methods needing safety review, replacements, constraints, missing reviews, real scalar values,
untested final bytes and missing/failing checks explain why review is required.
The private fingerprint scan is only one privacy check; independent scalar and
property-name review remains necessary. A passing local gate does not prove
hosted CI or fresh portal acceptance.

Actual automatic merging is always disabled. There is no merge action or
GitHub credential in this path. Review these proposed rules and explicitly
authorize any future automation scope before implementing merge behavior.

## Reconciliation with #225

The starting point is main after merged #226 (`db6c17f`). #225 (`f145adb`) has
real capture and generated-collection conflicts; it is not merged wholesale.
Its useful private error-variant approach is adapted into current capture
aggregation, together with exact origin/media and request/query variant identity.
Full retained bodies take precedence over previews, with their original
evidence ID, action and timestamp. The refresh analyzer shares that semantic
error classifier. Older captures are interpreted from raw records when retained.

The parallel contract comparator and public origin/error hashes are not imported;
the current verified-sidecar comparison and private evidence references serve
the refresh path. Recorder UI/export changes remain separate in #225 and retain
their unperformed live UI acceptance; its response-length/export/privacy rules
need reconciliation before promotion. Preserve #226's sidecar, safety,
source-review and policy controls throughout.
