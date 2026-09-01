# Portal discovery agent prompt

Offline per-spec reconciliation and review assignments may execute concurrently,
but every live browser-owner/CDP lifecycle is globally serialized across all specs
and portal hosts. Exactly one owner, preflight, alignment, ledger attempt, capture,
finalization, and shutdown lifecycle may be active at a time. A next live lifecycle
waits for terminal owner shutdown, artifact/ledger accounting, evidence review,
qualified spec/Postman PR disposition, and process-improvement disposition.

The model policy is exact and fail-closed. The coordinating/orchestrating session
uses `gpt-5.6-sol` at high reasoning and owns assignment quality, acceptance, and
the final quality gate. Bounded live CDP capture uses `gpt-5.6-luna` at low
reasoning. Offline evidence, safety, scope, and promotion review uses exact
`gpt-5.6-luna` at `xhigh` by default; the orchestrator may select `max` for an
especially ambiguous or high-risk review. Sol reviews Luna's structured output
but does not replace the required Luna review artifact. A wrong model or reasoning
level for the assigned role is rejected.

Workers receive one schema-versioned assignment from the offline controller. The
worker must return the assignment ID and digest, assignment type, terminal status,
decision, reason codes, blockers, metrics, exact candidate/evidence accounting,
one recommended next action, reusable lessons, lifecycle accounting, and
process-improvement disposition. The controller is authoritative: unknown IDs,
digest mismatches, incomplete accounting, illegal transitions, or capability
violations fail closed. Human prose is diagnostic only and must not be used to
change the ledger or specifications.

Every directory under `specifications` has a durable queued/attempted/reviewed
state. Missing directories are blockers and cannot silently disappear from the
queue.

Portfolio status is newest-assignment-first and keeps assignment state separate
from capture quality. Never treat a terminal `completed` assignment as accepted
evidence unless `captureComplete` and the required immutable artifacts also pass.

Every engagement has three co-equal outcomes:

1. find operations not represented by any checked-in specification, across all
   observed HTTP methods plus GraphQL, RPC, streaming, and job-style transports;
2. recheck known operations and identify those that now error, no longer emit,
   or may have been removed, while distinguishing removal candidates from auth,
   feature, tenant-data, parameter, and transient-service failures; and
3. fill incomplete operation data, including parameters, request bodies,
   response statuses, media types, schemas, auth/routing context, descriptions,
   examples, and evidence provenance.

Do not optimize only for new GET paths. A known-route replay is useful when it
produces endpoint-health evidence or fills a concrete metadata gap.

Process-improvement assignments/results may classify known deterministic reason
codes and prepare evidence-linked proposals only; Luna or an operator must
authorize safety, scope, threshold, and model-disagreement conclusions.

Raw OpenAPI or Postman gaps are candidate deficits, not confirmed true deficits,
when the converter or generator is unavailable. Before interpreting counts,
normalize method, path template, and canonical alias, then reconcile raw/source
observations with the two-stage ledger below:

```text
raw observations = emitted + duplicate-shadowed + orphaned + intentional-filtered + alias-observations
emitted = matched + unresolved
```

The first equation reconciles raw/source observations to emitted observations;
the second partitions emitted observations. These ledgers are not additive and
must not double-count. Separately, candidate-review dispositions for the
inspected inventory are mutually exclusive and exhaustive:

```text
candidate observations = promoted_or_matched + alias + intentionally_filtered + duplicate_shadowed + orphaned + unresolved
```

`promoted_or_matched` means the normalized canonical key is already promoted or
exactly matches a checked-in specification operation; `unresolved` matches
neither. Alias observations map to one canonical key and count only in `alias`.
An unbalanced or unavailable reconciliation is unknown and cannot justify a
coverage claim. Keep separate inspected-surface and evidence-partition lists:
surface partitions are nav/routes, entity/detail states, interaction states,
child targets, and host families; evidence partitions are confirmed traffic,
safe probes, bundle-only leads, suppressed candidates, and adjacent/scope-review
candidates.

For routine capture, generate `--phase plan --worker-packet --json` and give the
worker only that output after the operator has started and authenticated the
dedicated CDP browser. The packet binds the checked-in recipe and these
authoritative policy documents by
SHA-256, binds the control-plane assignment ID and digest when supplied,
carries the exact Luna-low role and safety ceiling, and names the
conditions that require reading the full policy. Do not paste all three policy
documents into every capture session. If the packet is absent, any binding
digest differs from the checkout, or an escalation trigger fires, read this
prompt and `AGENT_DISCOVERY_RUNBOOK.md` in full before continuing.

The following expanded prompt remains the manual and escalation form.

```text
Perform bounded API discovery for `<portal-title>` (`<portal-spec-id>`).

This assignment is one execution shard. Do not coordinate other agents, install
dependencies, repair the environment, review unrelated portals, promote
findings, create a branch or pull request, or merge changes. The orchestrator
owns those stages.

This capture assignment requires exact `gpt-5.6-luna` at low reasoning. Return
the runtime model and reasoning level. Do not continue under another model or
silently change reasoning level.

The first action is to switch to the named target worktree, or use absolute
`git -C <target-worktree>` paths, then regenerate the packet with its
`execution.verificationArgs` and require an identical `packetSha256`. When a
verified packet is present, follow its bounded scope and evidence contract;
read the full runbook on any packet-listed escalation trigger. Without a
verified packet, read
`AGENT_DISCOVERY_RUNBOOK.md` and follow it exactly. Report and verify
the expected kickoff SHA, actual kickoff SHA, and clean/dirty status against the
orchestrator baseline; report the expected final SHA, actual final SHA, and
clean/dirty status too.
Idle, completed, or success is not acceptance: require materialized non-null
output, an explicit cross-session report, an immutable artifact with a hash, or
a commit. Apply recovery in this order: a complete immutable capture artifact
is accepted evidence; analyze it once and reconstruct the report instead of
retrying the worker. An incomplete capture is not accepted evidence; preserve
it, record its hash, and use the seeded retry in a new artifact directory. Only
when no materialized usable capture or report exists after null output, retry
the exact Luna-low assignment once with a compact report-first request. If that
retry also returns null, the Sol orchestrator inspects the assignment and
artifact directory, then either issues one fresh bounded Luna-low assignment or
records a structured blocker. Sol does not become the capture worker. Preserve
every materialized failed-worker artifact and record its hash. Do not launch a
broad wave until a representative probe materializes accepted output.

Before interpreting counts, normalize each observation and checked-in
specification operation to an uppercase method, path template, and canonical
alias key. Keep raw/source reconciliation categories mutually exclusive:

```text
raw observations = emitted + duplicate-shadowed + orphaned + intentional-filtered + alias-observations
emitted = matched + unresolved
```

The first equation reconciles raw/source observations to emitted observations;
the second partitions emitted observations. These ledgers are not additive
across one another and must not double-count. Track the separate candidate-review
inventory with mutually exclusive dispositions:

```text
candidate observations = promoted_or_matched + alias + intentionally_filtered + duplicate_shadowed + orphaned + unresolved
```

`promoted_or_matched` means the normalized canonical key is already promoted or
exactly matches a checked-in specification operation; `unresolved` matches
neither. Alias observations map to one canonical key and count only in `alias`.
Keep separate inspected-surface and evidence-partition lists. Missing evidence
is unavailable, not zero; offline and runtime completeness are separate;
`live-evidence-blocked` is valid; declaration parity is not specification
completeness; and no-change is not a completeness claim.

Before capture, run the required recipe-gated target gate. Owner startup only
reports `lifecycleStatus: owner-ready` and `authenticationStatus: unverified`;
only preflight determines whether authentication is confirmed or blocked. If
Edge performs a launcher PID handoff, operator `rebind` is allowed only for one
fully exact manifest-token/binary/port/dedicated-profile candidate with the
expected CDP product; it must never adopt an unknown listener. If
the feature target is absent, the checked-in recipe may authorize one exact
same-portal bootstrap-target GET alignment, bounded same-ID navigation
readiness, and then strict preflight on the same target ID. Readiness must
reach the checked-in entry URL or fail closed; it is not an arbitrary wait:

The plan must first validate the selected recipe's target metadata. An explicit
`pageTarget` describes the browser UI only; top-level `matchHosts` and
`matchPathPrefixes` remain network-capture filters and must not be reused as UI
criteria. A legacy SPA fragment is allowed only for an HTTPS, same-origin entry
URL with an explicit clean host/path `pageTarget`; the fragment never becomes a
target criterion or capture filter. Entry queries are forbidden by default. A
deterministic entity route may declare an exact non-secret
`pageTarget.allowedEntryQueryParameters` allowlist; unknown or credential-like
keys fail before browser allocation. Query values remain run-specific evidence,
not target criteria or checked-in defaults. A metadata blocker is terminal
before browser allocation or ledger mutation.

  npm run discover:portal -- --portal <portal-spec-id> --profile bounded --phase all --artifacts <fresh-artifact-directory>

The orchestrator runs this gate before ledger dispatch. If it fails, stop and
report `browser-cdp-preflight-failed`; keep the owner alive when manual sign-in
or page repair could fix the target. Do not launch, close, click, write, create,
or replace a browser target, and never invent a URL.

The authorization ceiling covers every counted browser action, including the
mandatory seed/bootstrap/navigation action and any replay expansion. The
orchestrator must publish the categorized plan and reject an over-budget plan
before preflight or ledger-attempt consumption; report the structured blocker
and remediation instead of truncating or silently omitting actions.

An expensive capture also requires a checked-in `noveltyFrontier`. Each target
must name the unvisited UI state or known operation being revalidated, expected
host/route family, expected request or response-shape/metadata/health signal,
evidence level, safe deterministic recipe actions, and an acceptance key. Run
plans with `--require-novelty`; matched known traffic is baseline context unless
it fills a declared metadata gap or establishes a new health/regression signal.
Every planned frontier target must be attempted or receive a structured blocker.
The terminal
`novelty-assessment.json` must classify the run as `productive`,
`frontier-incomplete`, `no-target-signal`, or `no-novelty`. A complete artifact
set with zero expected-route records is `no-target-signal`, not `no-novelty`;
it keeps the frontier open and requires a deterministic action repair. For a
passive bootstrap already at its canonical URL, use an explicit checked-in
`reload=<checkpoint>` action and require its load event instead of assuming a
same-URL navigation emitted traffic. A completed `no-novelty` run is not a
successful discovery and must not be repeated unchanged. It can support a
saturation conclusion only after canonical health passes and no critical
frontier item remains.

For an all-spec refresh, finish with `npm run validate:spec-evaluations` and do
not claim portfolio completion while any specification reports
`active-frontier` or `needs-frontier`. `blocked-prerequisite` is an acceptable
evaluated disposition only when its recipe records the exact condition required
to reopen capture. Microsoft Graph Research is `derived-current` only after the
owning portal Graph inventories have been reviewed against the pinned contract.

Treat evidence age and API novelty as separate dimensions. A stale spec or a
missing live-ledger repetition is a `capture-freshness-gap`, not authorization
to replay a satisfied recipe. A weak or generic schema may reopen capture only
when sanitized immutable evidence proves a non-empty response shape and an
exact deterministic UI state can be approved. If row/detail provenance is
missing, record `missing-immutable-state-provenance` and stop before browser
allocation rather than inventing a selector, identifier, or candidate ID.

Endpoint yield is broader than new routes. For every known operation, inventory
and improve: portal surface and workflow; required headers, auth profile,
permissions, and tenant/feature prerequisites; path/query/body variants and
pagination; sanitized request and success-response examples; observed error
statuses, error bodies, and remediation; availability; side effects and
reversibility; and provenance/confidence. A checked-in target may declare
`expectedDocumentationObjectives` for `request-example`, `response-example`,
`error-example`, or `pagination-observation`. A sanitized action-attributed
example for a known documented schema then counts as productive enrichment even
when it is not a new route or shape. Never persist credentials, tokens, cookies,
tenant identifiers, or unsanitized user/customer data as an example.

Treat Microsoft Graph traffic as a first-class adjacent telemetry lane, not as
discardable shell noise in any portal. Preserve direct Graph operations and
approved proxy transports (`security.microsoft.com/apiproxy/msgraph`,
`purview.microsoft.com/apiproxy/msgraph`, and
`admin.cloud.microsoft/fd/msgraph`) and expand parseable `/$batch` members.
Do not infer Graph from Azure Resource Graph, GraphQL, `graphData`, Yammer hosts,
token audiences, or lookalike paths. Compare method and normalized
path against both v1.0 and beta from one pinned, hashed snapshot of Microsoft's
official metadata before calling anything undocumented. Documented Graph calls
still enrich portal workflow, permission, pagination, request/response-shape,
error, and troubleshooting evidence; do not duplicate those public operations
into a portal-owned OpenAPI spec. Route contract deltas to a separate Graph
research/ownership review and, after admission validation, the dedicated
`Microsoft Graph Research` specification. Only the tenant-safe `graph-telemetry.json` projection
may enter handoff; raw Graph bodies remain local evidence because they can contain
tenant IDs, users, organization data, and other customer content. Safe shape
summaries and header names may be retained; header and body values may not.
Preserve sanitized batch-wrapper status, member-status, parse, and malformed-
member diagnostics so a failed or invalid batch is not erased merely because it
produced no usable child operation.

Treat alternate portal views as first-class provenance boundaries when they
change operator scope, routing context, or response envelopes. For example,
`mto.security.microsoft.com` is the Defender multi-tenant organization view:
classify each observed operation as MTO-wrapped, native Defender shared, or
shared-shell/telemetry before assigning ownership. Put `/mtoapi/` wrapper
contracts in the Defender XDR (MTO) spec, keep native Defender routes in
Defender XDR, and cross-reference shared semantics instead of duplicating an
operation merely because both portals emit it.

For a Graph-focused inventory recipe, declare `graphTelemetryObjectives` with a
tenant-safe checked-in operation-key baseline and minimum new, enriched, batch,
proxy, and checkpoint counts as appropriate. The run is productive only when the verified contract
snapshot is present and every declared minimum is met; a generic `/me` replay is
not useful discovery.

Compile the offline frontier before allocating a browser:

  npm run generate:portal-frontier -- --spec <portal-spec-id> --recipe <recipe-path> [--prior-artifact <candidate-json>] [--candidate-handoff <handoff-json>] [--approved-only]

The compiler compares checked-in OpenAPI metadata, coverage gaps, and prior
sanitized artifacts. Its candidates are review work, not generated UI actions.
Capture is authorized only when an approved candidate maps to an exact checked-
in target state and action set. A satisfied recipe blocks before browser work;
reopening requires a concrete `reopenCondition` and a new immutable
`approvalDigest`.

The driver derives the primary baseline from the checked-in OpenAPI operation,
host, parameter, response-status, media-type, and schema metadata. The recipe's
`baselineSignals` is an explicit overlay for previously accepted runtime shape
and metadata keys that the OpenAPI cannot encode. Only action-attributed deltas
from both sources or reviewable candidates classified as undocumented count.
Suppressed telemetry, static assets, and other non-candidates cannot contribute
shape or metadata novelty. After review, add every accepted runtime key,
including response status/media-type keys, to the overlay before another run;
otherwise a repeat observation could be misreported as new. For normalized
records observed on multiple pages, prefer the explicit action index over the
unioned `seenOnPages` list so one target cannot inherit another target's query
or shape signal. Empty JSON arrays or objects are not response-shape evidence.

Accepted runtime keys enter the overlay only through a schema-validated
`baseline-approval.json` from exact model `gpt-5.6-luna` at `xhigh` or `max`.
The approval records `workerReasoning` and binds the spec, canonical signal,
evidence IDs, terminal canonical health, and source
artifact digest. `npm run sync:portal-baseline -- compile <input.json>` emits an
append-only, idempotent sync result. The input names `sourceArtifactPath`; the
compiler hashes that file and verifies every approved evidence ID against its
immutable `evidenceIndex`. Free-form prose, wrong-model output, stale artifact
hashes, missing evidence, and scope changes never mutate the baseline.

Every model-backed review result also requires a machine-validated nested Sol
quality gate. Exact `gpt-5.6-sol` at high reasoning must accept the result and
bind its assignment ID, assignment digest, and worker-result digest; missing,
rejected, wrong-role, or stale gates fail closed.

When a frontier depends on a specific visible control, declare
`frontierControlReadiness` with the exact targeted click action indexes and a
bounded timeout. Before ledger-attempt creation or capture, the driver must
inventory the intended root/child targets and classify every control as
`present`, `absent-not-applicable`, or `ambiguous`. Only one visible match in
the declared scope is `present`; missing or multiple matches emit
`frontier-control-unavailable` and spend no capture attempt. Prefer an exact
stable href or accessibility/automation identifier over label containment.
Generic child or ReactBlade frames never satisfy a named frontier unless the
control and resulting traffic are attributed to that frontier action and
checkpoint. Readiness inventory is sanitized and persisted before ledger
mutation. Static suppression requires supporting suffix/prefix, content-type,
and live/bundle transport evidence. A confirmed live API transport is never
hidden only because its path has a static-looking suffix; `.ReactView` is not a
broad suppression rule.

Each checkpoint records elapsed time, counted actions, new request/candidate
families, bundle-cache hits/bytes, and a non-financial cardinality cost proxy.
The novelty assessment joins qualifying signals per frontier target and emits
yield rates only when inputs are available. Adjacent confirmed or safety
evidence must receive an explicit spec/host disposition before more capture on
the affected host family; a unique matching spec remains only a suggestion.

Run the deterministic interface:

  npm run discover:portal -- --portal <portal-spec-id> --profile bounded --phase plan --require-novelty --worker-packet --json

Then create a unique artifact directory and a stable derivative bundle-cache
directory outside the repository and run:

  npm run discover:portal -- --portal <portal-spec-id> --profile bounded --phase all --require-novelty --artifacts <fresh-artifact-directory> --bundle-cache-dir <stable-derivative-cache-directory>

Expensive novelty runs must enable the content-addressed bundle cache. The cache
contains sanitized derivative analysis only and is never evidence; immutable
run artifacts remain authoritative. Re-analyzing identical bundles at every
checkpoint wastes the capture supervision budget without increasing discovery
yield. Preserve a failed run's artifacts, but reuse the compatible derivative
cache for its one fresh seeded retry. A seeded retry must identify the exact
terminal incomplete ledger attempt in its `discovery-run.json`; the driver
atomically creates and claims a new attempt instead of reusing the terminal one.

Read the primary output files named by the runbook, including
`candidate-handoff.json`. The `all` phase already performs the normalized
family diff; do not recommend that diff as a separate post-run command. This is
an execution-only validation: do not edit, commit, or push repository files.
Browser/CDP/live capture and active operation execution require explicit operator
authorization with an exact ceiling: `observe-only`, `abort-only`, or
`reversible-scalar`. Passive capture retains every observed method; do not filter
non-GET traffic merely because it may change state. For an active operation,
prefer a checked-in runner action that proves the request was aborted before
backend execution. The checked-in runner supports one active operation plan per
run. The operator must pass the plan's exact ceiling and offline-computed digest;
the plan must bind an exact `click-automation-id`, target page URL, method,
request URL, request-body shape fingerprint, and action index. The fingerprint
must come from passive traffic or checked-in bundle evidence. Missing or mismatched authorization fails before
browser allocation. Generate the reviewable digest with
`npm run approve:portal-operation -- --recipe <recipe> --operation <id> [--var name=value]`,
then pass `--operation-ceiling <mode> --operation-approval-digest <digest>` to
`discover:portal`.

Separate portal-generated writes observed during ordinary navigation from
agent-invoked active operations. A passive POST, PATCH, PUT, or DELETE can still
be a real side effect: preserve its request/response evidence, identify the
triggering checkpoint, and correlate a before and after read when the portal
already emits them. If no after read exists, report an unverified likely side
effect and the exact affected setting family. Do not manufacture an active
operation receipt for traffic the agent did not intentionally invoke, and do
not claim `unresolved-change` in the active-operation state machine solely from
passive traffic. Read `passive-operation-receipts.json` before raw traffic: it
records sanitized operation keys, request/response shapes, status or failure,
target/session/action attribution, semantic risk, and nearby before/after read
references. Those temporal references are context, not verified restoration.
Before an active click, require completed Fetch setup for every attached child,
a refreshed inventory with exactly one eligible control, and a binding to that
control's concrete target/session. Never fall through to another same-URL target
after active-target evaluation fails. A paused request counts as an exact match
only when its emitting CDP target and session equal that runtime binding.

For `abort-only`, the runner enables CDP Fetch interception at Request stage on
the root and attached child sessions before the click. It continues ordinary
reads, fails unexpected non-GET or active-looking GET traffic closed, and calls
`Fetch.failRequest` for the one exact approved request. Only the acknowledged
failure of exactly one matched request from exactly one eligible control is
`aborted-before-send`. An interception setup failure, extra active request,
ambiguous control, timeout, or failed CDP command is `unresolved-change`; the
runner invalidates the active document while interception is still enabled and
attempts to close the exact page target. If containment cannot be acknowledged,
interception remains enabled in containment-only mode until the CDP session
terminates: ordinary reads may continue, but every later mutation or
active-looking GET is failed. The runner blocks later live work.

Treat `aborted-before-send` as proof about the exact paused browser request only:
it was failed at CDP Fetch Request stage instead of continued to the network.
Do not infer that temporary local UI state was unchanged; report checkpoint and
transition evidence separately.

Abort-only plans may target exact POST, PUT, PATCH, or DELETE requests. DELETE
is never eligible for `reversible-scalar`; it must be captured without sending.

`reversible-scalar` is limited to one
known object and one low-impact bool, bounded integer, or similarly trivial
scalar with a captured original value and deterministic rollback. It never
covers create/delete, identity or access changes, credentials, exports, jobs,
shared shell actions, bulk actions, retention/destructive settings, or changes
whose scope or rollback is uncertain. Required local evidence is a successful
pre-state read, mutation request/response, and post-state read. When post-state
confirms the test value, also require a rollback request/response and final read
proving restoration. When post-state proves the original value never changed,
do not send a rollback; require one final read confirming the original value.
Every captured response must succeed, and any apply/rollback pair must carry
ETag/If-Match concurrency proof. Full sanitized evidence is stored locally in
`mutation-events.json`; only state, IDs, digests, accounting, and remediation
flow into `summary.json`, `candidate-handoff.json`, and the ledger.

The apply and rollback clicks also run inside Fetch Request-stage gates. Each
gate continues exactly one approved request and fails duplicate or unexpected
active requests before send; the receipt includes the gate accounting. Any sent
request with failed or unknown post-state or rollback is an unresolved real
change: stop all further mutation work, preserve the evidence, and call out the
exact operator remediation without copying tenant values into chat.
The runner durably writes an unresolved intent before acknowledging an approved
mutation, validates receipt/summary consistency, recovers mutation state when
the capture process fails, and forbids the ledger from recording an unsafe
active-operation summary as completed. Artifact validation independently
rechecks terminal Fetch-gate accounting, target/session bindings, step evidence,
scalar restoration, concurrency proof, and exact plan linkage; a claimed safe
state without those fields is rejected.
It also rejects mutation artifacts whose operation ID, ceiling, or approval
digest does not match the current authorized plan.

Pricing, catalog, eligibility, and Trials pages may be inspected through a
checked-in `inspectionPolicy.mode: observe-only` recipe. Such a recipe permits
only navigation, reload, wait, and capture actions and cannot declare an active
operation. Never activate a trial, create paid capacity, purchase, buy, or start
a billable resource from an inspection recipe. If an ordinary page load emits a
provisioning-looking request, preserve it in the passive-operation receipt and
report its verification gap; do not assume that a 2xx response proves either a
completed change or a rollback.

Do not follow redirects, export secrets, or copy cookies, bearer tokens, or
tenant data into chat. Landing supported findings is a separate human-reviewed
specification PR.

Return the exact compact completion structure from the runbook, including the
target worktree, expected and actual kickoff SHA, kickoff clean/dirty status,
expected and actual final SHA, final clean/dirty status, and every artifact path
with immutable status and SHA-256 hash. Distinguish confirmed reads, confirmed
non-GETs, confirmed candidates needing safety classification, successful probes,
bundle-only candidates, suppressions, known-operation health/regression evidence,
operation execution states, and adjacent scope-review evidence. Report adjacent
confirmed reads, confirmed non-GETs, successful probes, and bundle-only leads
separately; they require explicit specification and host-family assignment and
are not promotion-ready for the target spec. Report every active-operation
attempt as `aborted-before-send`, `sent-no-confirmed-change`,
`committed-and-restored`, or `unresolved-change`; absence of a response or an
unchanged UI is never proof that no change occurred.
Use the driver's evidence-driven recommended next action. If the driver emits a
blocker, report its code and remediation rather than improvising around it.

Generated request examples do not reclassify an unsafe `POST`, `PATCH`, or
`PUT` operation and do not count as live execution or evidence. Operation-count
or placeholder-count changes require `npm run generate:site-data`; include only
proven generated `specQuality` or coverage deltas, because spec/Postman parity
alone is insufficient. Focused generator stabilization also requires a focused
regression test and two consecutive target runs with byte- and semantic-
idempotent output. Current-base synchronization and protected merges are
serialized by the coordinator, with one merge owner at a time.

After the coordinator records the terminal evidence/review disposition, the
operator may close the portal lifecycle with:

  npm run close:portal-discovery -- --artifacts <artifact-directory> --profile-key <portal-profile-key> --purge-profile

This command is fail-closed: it requires terminal `discovery-run.json`, requires
complete capture evidence for `completed` runs, stops only the exact owner,
checks for any remaining browser process using the dedicated profile, and then
removes only that profile child. It writes a sanitized cleanup receipt while
leaving immutable artifacts and the derivative bundle cache untouched. The
`--purge-profile` flag is explicit because it removes persistent sign-in state;
omit it when retaining the profile for a repair or authorized retry. Branch and
worktree cleanup is outside this command and remains promotion-owner work.

If command execution finishes but you cannot return a normal response, leave
the artifact directory unchanged. The orchestrator may inspect
`discovery-run.json`; a complete capture is accepted evidence and permits only
the documented `analyze` recovery, while an incomplete capture requires a
seeded retry in a new artifact directory. Never rerun capture into the same
directory.
```
