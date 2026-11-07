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

CI materializes the checked-in official Graph contract pin in runner temporary
storage with `sync:graph-contract -- --pinned-spec`, then verifies its source
hashes, operation counts and manifest before research validation. It needs no
tenant authentication, private capture cache or floating upstream contract.

## Fresh capture readiness and storage

Use the existing controller's managed known-refresh path, then the reviewed
owner/worker process in the runbook. Set `$node24` to the installed Node 24
binary and use that same binary for collection and analysis. This campaign used
24.22.1; the exact runtime is part of the analysis cache binding.

Compile, persist and explicitly enqueue one reviewed recipe without allocating
a browser. Use a fresh private plan filename and ledger outside the repository:

```powershell
& $node24 tools/portal-discovery-control-plane.mjs compile-plan `
  --managed-known-refresh --manifest tools/portal-discovery-portfolio.json `
  --portal m365-admin --recipe tools/capture-recipes/m365-admin-shell-loop-20261106.json `
  --worker-id ACTUAL-WORKER-ID --endpoint https://admin.cloud.microsoft `
  --output C:/private/refresh/plan.json --ledger C:/private/refresh/ledger.jsonl --apply
```

Read the capture assignment's full ID and digest from that persisted plan.
Pass those exact values, worker ID, plan and ledger to public CLI planning:

```powershell
& $node24 tools/run-portal-discovery.mjs --portal m365-admin `
  --recipe tools/capture-recipes/m365-admin-shell-loop-20261106.json `
  --profile bounded --phase plan --require-known-refresh `
  --orchestration-plan C:/private/refresh/plan.json `
  --assignment-id CAPTURE-ASSIGNMENT-ID --assignment-digest CAPTURE-ASSIGNMENT-DIGEST `
  --worker-id ACTUAL-WORKER-ID --ledger-path C:/private/refresh/ledger.jsonl `
  --endpoint https://admin.cloud.microsoft --model gpt-6-luna --reasoning low `
  --operation-ceiling observe-only --artifacts C:/private/refresh/run-01/driver --json
```

The existing compiler resolves the recipe and approval, binds the actual caller
origin, variables, execution, role and driver budget, and persists the digest
and explicit worker in the ledger. The driver checks these before browser
preflight. A full execution binding does not override an explicit denial of live
authority, an unperformed review, a pending proposal or an expired approval.
The managed path is opt-in for known-refresh recipes; it does not invent a
novelty frontier or authorize a new native action.

An explicit `materialized` field must be Boolean `true` for live execution.
`false`, null and string values are non-runnable even with matching execution
digests. Static metadata and inventory expose that hold separately from legacy
bindings. Offline analysis may inspect the hash-bound historical evidence; it
does not turn an unmaterialized approval into current authority.

The SharePoint CSP approval intentionally retains its historical bytes. Its
`materialized: false` marker and final-digest instruction were copied unchanged
from the proposal. A separate retained coordinator launch gate binds exactly
those approval and recipe bytes, explaining historical authorization; it does
not repair the missing controller identity or grant another run. Current
execution rejects this marker. Replace and rebind the approval only through a
new explicit review and separately authorized execution, never by flipping the
flag to make a retained capture look complete.

Follow the existing independent plan review and separate coordinator gate before
owner allocation. The browser owner profile and the capture action profile
(`bounded`) are different fields. Use the existing packet verifier and preflight;
do not add competing URL, variable or budget checks. If the reviewed gate permits
binding the real target ID after owned preflight, regenerate and retain that
runtime packet through public planning before executing its exact driver argv.
Its canonical packet digest must match `discovery-run.json.workerPacketSha256`.

Keep setup receipts outside the driver's fresh output directory:

```text
private/run-01/receipts/  # owner, plan, command stdout/stderr and worker reports
private/run-01/driver/    # --artifacts; absent or empty before all/capture
```

Never redirect stdout/stderr into `--artifacts` before invoking the driver.
Preserve a blocked directory and choose a new empty driver directory; do not
erase its receipts to make it appear fresh. A complete capture can feed offline
analysis without collecting it again. A pre-collection failure has no response
evidence to recover. Reuse a healthy authenticated owner only under the existing
reviewed recovery/lifecycle rules, with identity checks and no repeated startup
navigation or authentication. Stop on a new failure instead of changing routes
or retrying an unavailable login or feature.

After the driver is terminal, safely stop the exact manifest-owned browser and
retain before/stop/after receipts. Offline review does not require an idle open
browser. Cleanup alone does not accept the data; the next live lifecycle still
requires terminal review, disposition and accounting. Keep the cached profile.

Produce the existing typed worker-result envelope, including top-level
`assignmentId`, `assignmentDigest`, `workerId`, `runtimeRole`, `model`,
`reasoning`, `attemptNumber`, `captureRoot`, status/decision, accounting,
lessons and process-improvement disposition. Runtime flags or policy defaults
alone do not prove the actual delegated model. After actual closure, validate
the retained files through the existing control plane:

```powershell
& $node24 tools/portal-discovery-control-plane.mjs validate-capture-result `
  --result C:/private/refresh/run-01/receipts/worker-result.json `
  --plan C:/private/refresh/plan.json `
  --packet C:/private/refresh/run-01/receipts/runtime-packet.json `
  --run C:/private/refresh/run-01/driver/discovery-run.json `
  --ledger C:/private/refresh/ledger.jsonl
```

Retain the full plan, actual runtime packet, typed result, integrity/review and
closure receipts, and a full ledger snapshot with claim and terminal events.
The validator checks retained capture files and sidecars, healthy known-refresh
evidence, every recipe action, mutation safety and the exact worker/claim.
Closed leases retain `claimedBy`. A completed assignment cannot be silently
replayed; use the result validator for retrospective checks, and a distinct
reviewed plan/assignment for a newly justified capture.

Direct/older driver runs can still provide qualified observations. Missing
orchestration digests and worker links remain unknown and cannot pass managed
acceptance or unattended eligibility. Preserve those gaps; never manufacture
historical identities or collect again merely to repair their metadata.

`--endpoint` is the ledger origin/host key (for example
`https://admin.cloud.microsoft`), not the full native UI URL or the CDP endpoint.
Keep native paths, SPA fragments and approved query bindings in the recipe;
keep the loopback debugging URL in `--cdp-endpoint`. Planning now rejects
explicit endpoint paths/fragments/queries before browser allocation. A default
known-refresh packet derives its ledger key from the actual portal caller's
origin, including a proxy caller different from the canonical spec portal.
The ledger emits canonical `hostname:port`; use `normalizeEndpoint()` rather
than raw string equality with an HTTP(S) origin. Native `pageTarget` constraints
and API `matchPathPrefixes` describe different surfaces.

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

`execution.analysisReferences` returns one exact private cache path and file SHA,
analysis-content digest, analyzer digest, input digest, spec ID and capture ID.
Use this reference rather than choosing the first/newest cache file or copying
digest labels manually. These references stay outside the stable counts report
and must remain private. The offline consumer always reports
`freshCapturesClaimed: false`; actual driver/owner/exit receipts establish whether
an input was newly collected.

Use the existing `captureWorkerPacketDigest()` / `verifyCaptureWorkerPacket()`
helpers for packet checks. The canonical packet digest excludes its own digest
and nonauthoritative measurements. A hash of the entire JSON file is a separate
integrity commitment, not that canonical digest.

Cache publication writes and syncs a private temporary file before atomically
publishing the final name without replacing an existing entry. Interrupted
temporary files do not block an identical retry; preserve orphan files for
inspection. An invalid existing final entry still fails closed: do not silently
overwrite tampered or historical partial evidence. Hard-link publication must
be supported by the private cache filesystem; an unsupported filesystem is a
storage blocker, not permission to use a partial final-file write.

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
Proposal generation rejects identifier-like keys (including nested emails,
GUIDs, domains and filesystem/URL paths). Synthetic scalar substitution does
not sanitize those keys. Model dictionaries manually with reviewed generic
keys instead of publishing captured identifiers; the private analysis retains
the original shape. This guard is conservative, not a complete privacy proof.

The command revalidates cache, capture and current analyzer bindings before
proposing anything. It follows local `$ref`s to the owning source and writes full private
YAML proposals plus the existing source-review manifest format. It never applies
them. Shared components and aliased operations need manual reconciliation so a
single observation cannot change other operations. Independent review inspects the exact manifest, original observations,
variants, privacy and semantic limitations. Use the existing
`review:source prepare`, `accept`, and `apply` gates from the runbook. A cache hit
does not bypass the current source-review gate. Then regenerate the affected
Postman collections and site data and review the focused diff.

Postman generation and `--check` invoke the exact lockfile-installed Redocly and
OpenAPI-to-Postman JavaScript entrypoints with the current Node executable and
`shell: false`. Run `npm ci` first. There is no `cmd.exe`, `.cmd` wrapper or
`npm exec` in this path; repository, bundled-input and temporary check-output
paths stay individual arguments. Windows CI checks literal spaces, percent/bang
expansion text, quotes and shell metacharacters, plus a real collection check
under a TEMP directory containing those legal filename characters.

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

Also supply `captureIdentityEvidence` with `resultPath`, `planPath`, `packetPath`
and `ledgerPath` for the accepted managed capture. The reporter derives
`discovery-run.json` exclusively from the verified analysis's capture directory
and uses the same file-backed controller validator. Missing, malformed,
unaccepted or borrowed proof yields `capture-controller-identity-unproved`.
An identity flag or a valid managed result from another capture is insufficient.
Legacy observations can support manual review while remaining ineligible here.

The advisory report validates the existing source-review receipt, exact
before/proposal bytes and traceability. Only narrowly additive GET response schemas
without constraints/composition, and explicitly synthetic examples, can qualify.
For every edit it resolves the owning specification file and exact operation,
method, route, response status and media type, compares the full supporting
observation list against verified analysis, and reconstructs the expected edit.
The entire proposed document must equal that reconstruction. Expanded YAML
semantics must also stay inside verified targets: a shared response alias cannot
silently change an unobserved operation. A valid capture
or another observation in the same file cannot authorize an unrelated edit.
Example property names must also occur at their exact nesting level in the
original authored model; open dictionaries do not establish safe names. New
schema property names require manual review. Independent review and passing
checks cannot override these advisory exclusions.
After application, the original analysis is verified against exact reviewed
before bytes and the current before-to-proposal transition. The immutable capture
and analyzer dependencies must still match; post-change reanalysis is not passed
off as the original evidence. Unrelated source changes invalidate this binding.
New operations, other methods needing safety review, replacements, constraints, missing reviews, real scalar values,
untested final bytes and missing/failing checks explain why review is required.
The private fingerprint scan is only one privacy check; independent scalar and
property-name review remains necessary. A passing local gate does not prove
hosted CI or fresh portal acceptance.

Actual automatic merging is always disabled. There is no merge action or
GitHub credential in this path. Review these proposed rules and explicitly
authorize any future automation scope before implementing merge behavior.

## Reconciliation with #225

Public recipe evaluation summaries retain opaque artifact references and exact
file hashes for the capture and independent/coordinator reviews. New summaries
omit runtime assignment identifiers, which can encode private execution scope.
The private controller still requires the full assignment, worker, plan, packet
and ledger identity; omitting an ID from a publication summary never satisfies
that controller gate.

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
