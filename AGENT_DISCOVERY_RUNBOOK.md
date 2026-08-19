# Portal Discovery Agent Runbook

Use this runbook for execution. Use `AGENT_DISCOVERY_PLAYBOOK.md` only when a
blocker requires deeper background.

## Agent handoff

### Layer 1 controller commands

### Final report-first controller (Layer 4)

The final controller is offline and report-only. It composes the validated portfolio plan, review assignments, promotion plan, retrospective, benchmark scorecard, and unresolved frontier without opening a browser, mutating the runtime ledger, editing specifications, or creating GitHub actions.

```powershell
node tools/portal-discovery-controller.mjs .\layer4-input.json
```

Use sanitized checked-in stage inputs and the synthetic benchmark corpus only. The report contains stable execution IDs/digests, capture recommendations, budgets, route assignments, blockers, frontier priorities, and terminal state. `capture-recommended`, `blocked`, and `offline-ready` require human review; `saturated-complete` is valid only when canonical health and saturation gates pass and no critical frontier item remains. Applying or enqueueing work is a separate explicit opt-in through the existing control-plane interfaces.

Benchmark drift, schema mismatch, digest tampering, privacy leakage, incomplete health, unknown saturation, and budget exhaustion fail closed. Re-running the command with identical inputs is idempotent and resumable because stage IDs and serialized output are deterministic.

The authorization ceiling applies to every counted browser action, including
implicit seed/bootstrap/navigation and replay expansion. Plan and surface the
category totals before preflight and ledger-attempt consumption; reject
over-budget runs with a structured blocker and remediation, never truncation.

The checked-in portfolio is validated and materialized from existing spec,
recipe, crawl, and coverage metadata. These commands are offline and report-only
unless `--apply` is explicitly supplied:

```powershell
npm run control:portal-discovery -- validate-portfolio --json
npm run control:portal-discovery -- compile-plan --json
npm run control:portal-discovery -- status --json
```

The plan has stable IDs and SHA-256 digests. Offline per-spec reconciliation and
review assignments may run concurrently when their artifacts and destination
files do not conflict. All live browser-owner/CDP work is one global serialized
lifecycle across every spec and host: owner, preflight, alignment, ledger attempt,
capture, finalization, and shutdown. The next lifecycle is blocked until terminal
owner shutdown, artifact/ledger accounting, evidence review, qualified spec/Postman
PR disposition, and process-improvement disposition are recorded. A fresh artifact
directory is a runtime precondition and is never created in committed data.
`--apply` is required before enqueueing and enqueue is idempotent through the
existing ledger lock. Corrupt or incompatible manifests, plans, ledgers, and worker
results fail closed; retry only after repairing the input or returning the
assignment to its legal queued state. Review/controller results must report exact
runtime model `gpt-5.6-luna`; wrong-model output is rejected.

Endpoint lease identity is canonicalized as lowercase `host:port`: HTTPS URLs and
bare hosts use port `443`, HTTP URLs use port `80`, and an explicit port is
preserved. Only an HTTP(S) origin is valid; paths, credentials, queries, hashes,
different profiles or workers, and expired leases never qualify for running-attempt
reuse.

Validated grouped handoffs may be converted offline with
`tools/discovery-review-assignments.mjs`. The schema-versioned plan creates one
deterministic assignment per partition and contains only digests, counts,
destination metadata, blockers, capabilities, and routing. `cheap` is reserved
for unblocked read-only partitions; safety, adjacent ownership, scope/host
ambiguity, incomplete capture/health, and unknown eligibility route to Luna or
manual review, while suppressed work is blocked. Only cheap and Luna entries
may be imported into the ledger; manual and blocked entries remain visible but
non-reviewable. Import is idempotent and uses the existing ledger lock without
changing capture endpoint/profile leases.

Give the agent this repository-relative instruction:

> Read `PORTAL_DISCOVERY_AGENT_PROMPT.md` and follow it exactly for the named
> portal. Do not improvise browser automation, edit specifications, or expose
> captured credentials or tenant data.

The prompt is intentionally separate from this runbook so it can be pasted into
a new agent session without copying the full playbook.

## Promotion preparation (Layer 2)

Promotion preparation is an offline, deterministic compiler. It consumes only
validated grouped handoffs, canonical health, validated review results, derivative
recommendations, and checked-in spec inventory. It never calls a model and never
edits a specification or creates a PR implicitly.

```powershell
node tools/portal-discovery-promotion-planner.mjs compile .\promotion-input.json
```

The input must contain tenant-safe candidate/evidence IDs, exact worker approval,
and explicit budgets. The compiler fails closed for incomplete health, adjacent,
suppressed, bundle-only, ambiguous, conflicting, or unassigned candidates. It
emits stable plan/change-group IDs, digests, exact candidate/evidence traceability,
focused destination-spec PR boundaries, validation commands, measurements, and
next actions. Applying repository edits is a separate human-controlled boundary
after review; this command is report-only.

## Deterministic retrospectives and accounting (Layer 3)

Compile a sanitized, offline retrospective from structured plan, health,
assignment/result, promotion, derivative, ledger/process, CI/PR, and operator
annotation summaries:

```powershell
npm run retrospect:portal-discovery -- compile .\retrospective-input.json --write .\discovery-retrospective.json
```

The compiler is report-only and uses an atomic write only when `--write` is
explicitly supplied. Inputs carry source IDs and digests; raw URLs, tenant or
credential data, absolute paths, and prompt text are rejected. Missing values
are `null`/unavailable, never zero. Runtime actual usage requires trusted
structured telemetry; tokenizer byte/token estimates are separate records and
are never presented as actual usage. Cost remains unavailable without an
explicit versioned pricing input.

Improvement proposals are stable, evidence-linked, and default to `observe`
until the configured support threshold is met. Critical deterministic
invariants may become `proposed`, but no proposal edits code/docs or opens a
PR. Cheap workers may classify known reason codes only; Luna/manual approval is
required for safety, scope, thresholds, and model disagreement. Retries,
timeouts, recovery, escalation, invalid results, and CI/PR outcomes must be
reported as structured counts and reason codes.

## Reconciliation, publication, and merge gates

Treat converter and generator availability as part of reconciliation health. If
either is unavailable, raw OpenAPI or Postman gaps remain candidate deficits;
they are not confirmed true deficits and must not change a coverage claim.

Before interpreting any raw count, normalize every observation and spec
operation to an uppercase method, path template, and canonical alias key. Keep
the raw/source reconciliation categories mutually exclusive and record exact
integer counts:

```text
raw observations = emitted + duplicate-shadowed + orphaned + intentional-filtered + alias-observations
emitted = matched + unresolved
```

The first equation reconciles raw/source observations to emitted observations;
the second partitions emitted observations. These ledgers are not additive
across one another and must not double-count. For the separate candidate-review
inventory, use mutually exclusive dispositions:

```text
candidate observations = promoted_or_matched + alias + intentionally_filtered + duplicate_shadowed + orphaned + unresolved
```

`promoted_or_matched` means the normalized canonical key is either already
promoted or exactly matches a checked-in specification operation; `unresolved`
means it matches neither. Alias observations map to one canonical key and are
counted only in `alias`.
Maintain separate inspected-surface lists (nav/routes, entity/detail states,
interaction states, child targets, host families) and evidence-partition lists
(confirmed traffic, safe probes, bundle-only leads, suppressed candidates, and
adjacent/scope-review candidates). Missing evidence is unavailable, not zero.
Offline completeness and runtime completeness are separate; `live-evidence-blocked`
is a valid terminal disposition. Declaration parity is not specification
completeness, and no-change is not a completeness claim.

Canonical operation-count or placeholder-count changes require
`npm run generate:site-data` before publication. Include only proven generated
`specQuality` or coverage deltas in the change; spec/Postman parity alone is
insufficient. A focused generator stabilization change additionally requires a
focused regression test and two consecutive target runs whose outputs are byte-
and semantically idempotent.

Current-base synchronization and protected merges are serialized separately from
offline reconciliation. One merge owner refreshes the current base, performs
the protected merge, and reruns exact-head and relevant validation checks before
another merge owner may proceed. Concurrent merge attempts are not a recovery
strategy for stale exact-head checks.

Generated request examples are documentation fixtures only. They do not
reclassify unsafe `POST`, `PATCH`, or `PUT` operations and do not constitute live
execution or evidence.

## Required input

The task must name one portal by title or spec ID, for example `M365 Admin` or
`m365-admin`. Unless the task says otherwise:

- do not edit OpenAPI specifications
- do not submit forms or invoke writes
- do not export secrets from the browser
- keep artifacts outside the repository
- stop after the checked-in recipe, candidate analysis, and handoff generation complete

The worker assignment must also include one explicit artifact directory or
instruct the worker to create one fresh directory. A worker owns exactly one
portal, one recipe, one CDP endpoint, and one artifact directory.

### Delegated worktree and acceptance gate

The first delegated action must switch to the named target worktree, or use
absolute `git -C <target-worktree>` paths for every Git command. Before any
other work, record the target path, expected kickoff SHA, actual kickoff SHA,
and clean/dirty status; reject the assignment if the target SHA does not match
the orchestrator baseline. The final report must repeat the target path,
expected final SHA, actual final SHA, and clean/dirty status.

Idle, completed, and success states are not acceptance. Accept only materialized
non-null assistant output, an explicit cross-session report, an immutable
artifact with a recorded hash, or a commit. Apply recovery in this order: a
complete immutable capture artifact is accepted evidence; analyze it once and
reconstruct the report instead of retrying the worker. An incomplete capture is
not accepted evidence; preserve it, record its hash, and use the seeded retry in
a new artifact directory. Only when no materialized usable capture or report
exists after null output, a low-capability capture execution uses exactly
`gpt-5.3-codex-spark`, retries exactly once with a compact read-only report-first
request, then escalates exactly from Spark to exactly `gpt-5.6-luna` if that
retry remains null. Assignments already routed to Luna or manual review keep
that route. Preserve every materialized failed-worker artifact and record its
hash; retain useful artifacts for recovery.
Do not launch a broad wave until a representative probe has materialized
accepted output. A no-change result is
not evidence of completeness.

## Orchestrator preflight

Run these checks before allocating a capture worker. They are coordinator work,
not discovery work:

1. Confirm the repository remote is the intended fork and never the upstream
   project.
2. Restore the repository's locked dependencies when `node_modules` is absent;
   workers must not install or update packages.
3. Run the portal plan command and require `status: planned`. The plan must
   validate the selected recipe target metadata before any browser or ledger
   work. Treat explicit `pageTarget` host/path values as UI criteria and
   top-level `matchHosts`/`matchPathPrefixes` as network-capture filters; never
   substitute the latter for the former. A legacy SPA fragment is valid only
   when the entry is HTTPS, same-origin, query-free, and constrained by an
   explicit clean host/path `pageTarget`; fragments are never matching or
   capture criteria.
   For an expensive discovery assignment, also pass `--require-novelty` and
   require a non-empty `noveltyPlan`. Each frontier target must be tied to exact
   checked-in action indexes and declare its UI state, expected host/route,
   expected request/response-shape or metadata class, evidence level, safe
   action, and acceptance key. A plan containing only known replay is blocked
   before owner allocation.
   The plan must derive its primary baseline from the checked-in OpenAPI and
   merge the recipe's `baselineSignals` overlay for accepted runtime-only route,
   query, request-shape, and response-shape keys. Empty overlay arrays mean no
   additional runtime signals have been accepted; they never disable the
   derived OpenAPI comparison.
4. Require `npm run browser:cdp:status -- --profile-key <key>` to report the
   manifest-owned browser as healthy, then run the portal driver against that
   exact loopback endpoint. Its recipe-gated preflight verifies browser metadata,
   expected product, exactly one matching page, harmless Runtime.evaluate,
   authentication, and stable identity. If the feature target is absent, a
   checked-in `pageTarget.bootstrap` may authorize one exact-target GET to the
   recipe's first navigation URL, followed by strict preflight bound to the same
   target ID.
5. Confirm the selected recipe exists and choose a fresh artifact directory.

Do not spend a worker allocation on a missing dependency, invalid portal ID,
missing recipe, unavailable CDP listener, or unauthenticated target. Report and
repair those prerequisites at the orchestrator layer first.

Do not spend a worker allocation merely to reconfirm checked-in operation keys.
Known routes may establish baseline context, but every costly assignment must
target at least one unvisited state, unmodeled host/route family, or known
schema/metadata gap. Large recipes require materialized signals across at least
two frontier targets. The driver writes `novelty-assessment.json`; treat
`no-novelty` as a recipe/frontier revision outcome, not discovery success, and
never rerun the same plan unchanged.
During coordinator review, update `baselineSignals` with accepted signal keys
before scheduling any follow-up so the same evidence cannot count twice.
Evidence must be attributed to the exact frontier action page that emitted it;
bootstrap traffic, failed actions, raw prefix collisions, and records from a
different target state do not count.

### Protected PR transport troubleshooting

The app-injected default Git transport may use a different credential than the
`gh` keyring token. If `gh auth status` reports the `workflow` scope but a push
that includes a workflow file is rejected, first use a process-scoped push
override without changing user or global configuration:

```powershell
git -c credential.helper= -c 'credential.https://github.com.helper=!gh auth git-credential' push
```

Verify only the reported `gh auth status` scopes and helper origins; never print
credential values. `gh auth setup-git` is the persistent opt-in alternative.
Broad helper resets are last-resort diagnosis only, not the default fix.

## Optional deterministic saturation analysis

Legacy discovery remains full-traversal by default. An orchestrator may opt in
to offline saturation reporting with `--saturation`; add
`--apply-saturation-stop` only when the caller wants a healthy decision marked
as applied. The flag does not alter the checked-in capture recipe or live
action execution. The evaluator uses immutable action results, canonical
summary health, capture completeness, and candidate/request-family novelty.

A healthy stop requires a complete capture, available and consistent canonical
health, known eligibility, no required failures, no high-value eligible work,
no scope-review ambiguity, a minimum evidence window, and the configured
consecutive zero/low-gain windows. The result records the schema version,
thresholds, exact reason, evaluated windows, category gains, remaining work,
blockers, and whether the result was merely recommended or applied. Missing
summaries, interrupted captures, health mismatches, interaction failures, and
unknown eligibility are unavailable/blocking states; they must never be
interpreted as healthy saturation.

## Browser prerequisite

The deterministic pipeline attaches to an already authenticated browser. A
capture agent must not launch, close, navigate, or repair that browser. The
operator controls its lifecycle only through `browser-cdp-owner.mjs`: one
independent Edge root, one explicit loopback endpoint and fixed port (normally
`http://127.0.0.1:9222`), one stable portal-specific profile key, and one
long-lived portal target. The default resolver checks deterministic Edge paths
before Chrome; use `--browser edge` to prohibit fallback.

Chrome 136 stopped honoring `--remote-debugging-port` and
`--remote-debugging-pipe` for the default data directory unless a nonstandard
`--user-data-dir` is supplied; see the first-party
[Chrome for Developers announcement](https://developer.chrome.com/blog/remote-debugging-port).
Treat this Chromium 136+ restriction as a hard gate for this Edge-oriented
workflow too. The owner always uses a dedicated persistent directory beneath
`%LOCALAPPDATA%\nodoc-cdp\profiles\<profile-key>` (or the platform-equivalent
state root), never a normal browser profile. This both creates an independent
browser root and preserves portal sign-in across capture retries.

Browser/CDP/live capture and any write execution require explicit operator
authorization. Only the operator invokes these lifecycle commands:

```powershell
$portalUrl = "https://admin.cloud.microsoft"
npm run browser:cdp:status -- --profile-key m365-admin
npm run browser:cdp:start -- --profile-key m365-admin `
  --portal-url $portalUrl --browser edge --port 9222

# Complete sign-in in that dedicated window and leave exactly one portal page open.
npm run preflight:browser-cdp -- --endpoint http://127.0.0.1:9222 `
  --expected-product Edge --match-host admin.cloud.microsoft

# When operator-owned capture work is finished:
npm run browser:cdp:stop -- --profile-key m365-admin --port 9222
```

`--expected-product Edge` matches the Edge product family, including the real
CDP `Browser` token form `Edg/<version>`. Chrome remains a distinct family and
must not satisfy an Edge preflight.

`start` is idempotent only for a healthy exact manifest owner. A successful
launch or reuse returns `code: preflight-required`, `lifecycleStatus:
owner-ready`, and `authenticationStatus: unverified`; owner startup does not
inspect target authentication. Leave exactly one intended portal page open,
complete sign-in only if the browser UI requires it, then **always** run the
read-only authenticated preflight. Only preflight and later capture barrier
detection may report `authentication-required`. The sanitized manifest is
stored beneath `%LOCALAPPDATA%\nodoc-cdp\manifests`, outside Git, and contains
only lifecycle identity needed to prove ownership. After launch, the owner
resolves exactly one long-lived process matching the browser binary, fixed
port, dedicated profile, and random owner token, then persists that PID instead
of assuming the short-lived launcher PID remains authoritative. Zero or
multiple exact candidates fail closed. `status` and `start` fail
closed for malformed or stale manifests, a product mismatch, an unknown
listener, or an occupied port. `stop` terminates only the exact manifest PID
whose executable, fixed port, dedicated profile, and random owner token all
match; it never kills by process name. If the recorded PID disappears while an
exact token/profile candidate or live listener remains, retain the manifest,
stop nothing, and report an identity/orphan blocker. Remove a stale manifest
only after the recorded PID and exact candidates are absent and the endpoint is
confirmed free.

The required order is: owner ready -> strict feature preflight; only when the
validated recipe declares it and the feature target is absent, one
authenticated same-portal bootstrap preflight and exact-target GET alignment ->
bounded same-ID navigation readiness -> strict same-ID feature preflight ->
mutate the ledger. Readiness may tolerate only the target's transient
post-navigation publication state; it must end in the checked-in entry URL or
fail with an explicit readiness timeout. Multiple targets, wrong hosts, login
barriers, malformed metadata, redirects, and arbitrary operator URLs fail
closed. The capture worker still receives only the exact target ID and does not
launch, close, or navigate the browser.

For a portal-specific page check, retain the same endpoint and narrow the
authenticated preflight further:

```powershell
npm run preflight:browser-cdp -- --endpoint http://127.0.0.1:9222 `
  --expected-product Edge --match-host config.office.com `
  --match-path-prefix /officeSettings/inventory
```

Before handing off to an agent, the coordinator must confirm that the
recipe-gated preflight passed for the intended portal and is past sign-in. If
alignment reports no bootstrap target or an authentication barrier, keep the
owner alive while manual sign-in or page repair could fix it; do not
automatically stop or restart it.
Use owner `status` and `stop` only for an explicit safe shutdown or when no
manual repair opportunity remains, then start the same stable profile key if
needed. Never close the user's normal browser, copy a normal browser profile,
use Playwright/browser canvas, or run any second controller against the owner
browser, profile, target, or port. A failed preflight does not prepare or mutate
the discovery ledger.

Every retry after browser recovery uses a new empty artifact directory. A
healthy completed capture may be analyzed again without reopening the browser.

## Execution

1. Read the machine-generated portal brief:

   ```powershell
   npm run discover:portal -- --portal m365-admin --profile bounded --phase plan --require-novelty --json
   ```

2. Choose a unique, fresh artifact directory outside the repository for every
   execution, including reruns after authentication:

   ```powershell
   $artifacts = Join-Path $env:TEMP ("nodoc-m365-admin-discovery-" + [guid]::NewGuid())
   ```

3. Run the deterministic pipeline:

   ```powershell
   npm run discover:portal -- --portal m365-admin --profile bounded --phase all --require-novelty --endpoint https://admin.cloud.microsoft --artifacts $artifacts --ledger-path $ledgerPath
   ```

   Capture and analysis automatically enqueue and claim a deterministic ledger
   assignment when `--endpoint` is supplied. Use `--assignment-id` to target a
   precreated assignment. For explicitly legacy, non-ledger analysis, pass
   `--no-ledger`; do not use that mode for production capture.

4. If execution is interrupted, choose exactly one recovery path:

    - If capture completed and primary capture artifacts exist, rerun analysis
       against the same directory without touching the browser:

       ```powershell
       npm run discover:portal -- --portal m365-admin --profile bounded --phase analyze --artifacts $artifacts
       ```

    - If capture did not complete, preserve the partial directory as immutable
       evidence and start a new run seeded from its checkpointed page states:

       ```powershell
       $retryArtifacts = Join-Path $env:TEMP ("nodoc-m365-admin-retry-" + [guid]::NewGuid())
       npm run discover:portal -- --portal m365-admin --profile bounded --phase all --artifacts $retryArtifacts --seed-artifacts $artifacts
       ```

    This recovery path is distinct from the delegated null-output contract: it
    recovers a materialized capture, not a missing worker response, and each
    seeded retry uses a new attempt and fresh artifact directory. Never resume
    `capture` or `all` into a non-empty directory, merge artifact
    directories, or use `analyze` as a substitute for an incomplete capture.
    Body draining, script/bundle processing, and artifact finalization are bounded
    by `--supervision-timeout-ms`. Productive capture has a separate total
    `--capture-supervision-timeout-ms` failsafe. The production ledger lease is
    derived from that failsafe plus finalization margin, and long-running workers
    may renew it only with an atomic assignment, attempt, and owner match. An
    expired running lease is reclaimed as `stale`; a renewal from any other owner
    is rejected and cannot extend the lease.
    `--capture-supervision-timeout-ms` (15 minutes by default), so a legitimate
    recipe is not killed by the finalization budget. If the parent
    failsafe expires, the parent writes `capture-failure.json` with phase
    `parent-supervision`, preserves already-written artifacts, and leaves the run
    interrupted; retry in a new seeded directory.

5. Read only these outputs first, in order:

   - `discovery-run.json`
   - `summary.json`
   - `candidate-handoff.json`

   For captures, `summary.json`, `discovery-run.json`, and
   `candidate-handoff.json` carry the same sanitized `interactionHealth` signal.
   Its `counts` are derived once from `action-results.json`: controls found in
   the pre-action target/frame inventory are eligible attempts, while absent or
   feature-gated controls are `absentNotApplicable` rather than selector
   misses. Treat `accounting.consistent: false` as a deterministic blocker.
   Escalation is recommended only when repeated eligible misses also show
   unchanged state, no transition, and no new request family; a single absent
   control is not an escalation.

   `summary.json` is the minimum proof of a complete capture. If it is absent but
   checkpointed capture artifacts exist, analysis may still finish and emit
   candidate outputs, but `discovery-run.json` and `candidate-handoff.json` must
   report `capture.captureStatus: interrupted`, `capture.captureComplete: false`,
   and `interactionHealthStatus.reason: summary-missing`. Treat the capture as
   incomplete and follow the recovery recommendation; never infer canonical
   health or recipe completion from partial action results. Invalid JSON or an
   invalid minimum summary is `corrupted-minimum-artifacts`; an authentication
   barrier is `authentication-blocked`. A trusted orchestrator may run the
   documented `analyze` recovery against immutable artifacts, including an
   interrupted directory, but promotion-shaped guidance is withheld until a
   complete capture is available. Complete captures analyzed offline are marked
   as `recovery.status: recovered-analysis` while preserving top-level
   `status: completed` for compatibility.

6. Read the following structured evidence only when the handoff requires a
   specific candidate, probe, bundle, or streaming detail:

   - `candidate-queue.json`
   - `probe-results.json`
   - `bundle-candidates.json`
   - `stream-records.json`

### Optional grouped worker handoff

The compatibility monolithic `candidate-handoff.json` is emitted by default.
For offline scheduling, pass `--grouped-handoff <fresh-directory>` to `all` or
`analyze`. The directory contains `manifest.json`, `shared-metadata.json`, and
one deterministic partition file per destination spec/host family/review class.
Adjacent partitions are never promotion-active: they carry an explicit
assignment blocker. Workers must use the manifest's model/reasoning policy and
blockers, then reassemble candidate IDs exactly once before review. Partition
digests and byte counts are manifest metadata; mutation invalidates the stated
digest. The grouped output contains only normalized, tenant-safe fields and is
an additive derivative of the monolithic handoff.

### Optional derivative-family deduplication

Offline schedulers may opt in to `tools/discovery-derivative-families.mjs` after
grouped handoff validation. It emits a schema-versioned, SHA-256 content-addressed
family index from normalized method, host family, route/query shape, response-shape
fingerprint, GraphQL metadata, review class, and safety/scope flags. Tenant IDs,
raw URLs/values, auth, paths, timestamps, and run-local IDs are excluded from keys.
The index preserves every candidate and evidence reference and is therefore a
review-input compaction derivative, never an evidence replacement. Stable ordering,
digests, and Windows-safe temporary-file rename persistence make updates atomic and
idempotent. Missing indexes are misses; corrupt or incompatible indexes are misses
unless the safety context requires a blocker.

Reuse is only a recommendation: prior approved families must match destination,
host ownership, safety class, capture/health fingerprint, analyzer/schema versions,
and required provenance. Changed shape, adjacent or ambiguous scope, incomplete
health/capture, blocked work, and version/provenance mismatches remain review work
with explicit reason codes; no assignment is silently skipped. The deterministic
measurement reports baseline and compacted serialized bytes, unique/repeated family
counts, eligible reuse recommendations, maximum worker payload, and preserved
candidate/evidence cardinality. It makes no token, CPU, latency, or quality claim.

7. Consult `page-states.json`, `action-results.json`, or raw request artifacts
   only when the structured outputs do not explain a candidate or blocker, and
   escalate that inspection to a trusted review worker.

### Attribution and artifact compatibility

Capture artifacts written by `cdp-deep-capture.mjs` use schema version `2` on
records that carry capture evidence. Network, script, stream, and probe records
are attributed from the CDP session, target, and frame that emitted the event;
they do not use the current action label as a global fallback. `raw-requests.json`
and `session-snapshots.json` include the page/checkpoint label plus target and
frame relationship metadata, including worker and service-worker targets. The
opaque `evidenceId` and `probeId` values are stable hashes of the action,
checkpoint, normalized URL, target/session/frame, and attempt context, so late
event delivery does not change deduplication keys. Existing array artifact files
remain readable by older consumers because the schema field is additive.

The JavaScript analyzer adds bounded v2 metadata to `bundle-candidates.json`:
`confidence`, `provenance`, `discoveryKind`, and (when applicable) `hostname`.
`candidatePath` remains a normalized path for compatibility. Absolute URL hosts
are retained separately for scope classification; no bundle code is executed.
GraphQL entries include operation type/name and a persisted-query hash only when
the hash is statically present. Parse failures are counted and preserved as
diagnostics rather than treated as successful extraction.

### Bundle analysis cache

Bundle analysis caching is disabled by default, preserving legacy execution. To
opt in for repeated runs, pass `--bundle-cache-dir <directory>` to
`run-portal-discovery.mjs`; the directory is a local derivative cache and must
not be used as evidence storage. Entries are keyed by SHA-256 bundle content,
analyzer version, cache schema version, result schema version, and normalized
path-prefix options. URL, local path, and modification time are never keys.

Within a run, duplicate bytes share one analyzer execution. Persistent entries
are reused only when all key metadata matches. Missing, malformed, partial,
corrupt, or version/options-mismatched entries are explicit misses and are
atomically replaced with a Windows-safe temporary-file rename. Cache metadata
contains no absolute paths or raw bundle bodies; cached results use the same
sanitized analyzer schema as `bundle-candidates.json`. Immutable bundle files
and run artifacts remain the source evidence and are never replaced by cache
reads. `bundle-candidates.json` and `summary.json` expose deterministic cache
metrics: requested bundles, unique content hashes, memory/persistent hits,
misses, invalid entries, bytes avoided, and analyzer executions.

Remove the cache directory, or change analyzer/schema/options versions, to force
invalidation. Do not share a cache across incompatible analyzer implementations.

The synthetic benchmark fixture in
`tools/tests/mine-javascript-bundles.test.mjs` uses three files with identical
bytes: legacy mode performs three analyzer executions, while the cache-enabled
run performs one and preserves candidate cardinality. Run it with
`node --test tools/tests/mine-javascript-bundles.test.mjs`; this measures analyzer
CPU reduction only and does not claim downstream token savings.

## Swarm execution contract

- One coordinator runs `plan`, assigns one portal and checked-in recipe per
   capture worker, and records the artifact directory for each assignment.
- One capture worker owns port `9222`, its page target, and its artifact
   directory at a time. Never let workers share or append to those resources.
- Parallel capture requires separate machines or isolated browser/CDP
   endpoints. On one machine, serialize capture workers; parallelize only
   offline review of completed immutable artifacts.
- Lower-capability workers execute the runbook and return the completion
   structure. They do not invent selectors, change recipes, classify unsafe
   actions, inspect raw secrets, or edit specifications.
- Escalate only failed required recipe actions, ambiguous safety or scope, and
   recipe changes. After review, rerun the complete checked-in recipe in a new
   artifact directory rather than patching a live run interactively.
- Treat `candidate-handoff.json` and the driver's `recommendedNextAction` as the
   work queue. Do not create a second speculative mapping from raw bundle output.
- Prefer the cheapest supported worker model that can execute tools reliably,
  currently `gpt-5.3-codex-spark` at low reasoning. Use `gpt-5.6-luna` only
  after the null-output recovery gate: no materialized usable capture or report
  exists and the compact read-only retry remains null. Complete captures use
  analyze-only recovery; incomplete captures use a seeded retry in a new
  directory. Model fallback does not relax safety or evidence rules.
- On a single CDP endpoint, the maximum live capture concurrency is one. The
  orchestrator may queue additional portals, but must not start their capture
  workers until the current owner has released the endpoint. Offline analysis
  and promotion review may run concurrently over different immutable artifact
  directories.
- Treat a worker that returns no message separately from a failed pipeline.
  Inspect the assigned directory for `discovery-run.json`. If capture artifacts
  are complete, they are accepted immutable evidence: run `analyze` once
  against that directory and reconstruct the completion response from the
  primary outputs; do not perform the null-output retry. If capture is
  incomplete, preserve it and use the documented seeded retry in a new
  directory. Apply the null-output retry and Spark-to-Luna escalation only
  when no accepted artifact or report exists.

## Review and landing gates

Discovery, promotion, and merge are separate stages:

1. **Discovery worker:** executes this runbook and produces immutable local
   artifacts plus the tenant-safe handoff. It never edits the repository.
2. **Promotion worker:** receives only the target spec, relevant sanitized
   handoff entries, and explicit scope assignments. It creates one focused
   branch/PR, regenerates derived artifacts, and validates the changed surface.
3. **Review worker or orchestrator:** verifies evidence labels, host/spec scope,
   tenant-data sanitization, generated-file consistency, and validation results.
4. **Merge:** occurs only after required checks and review pass. Follow-up gaps
   become new assignments or PRs; they are not silently folded into an unrelated
   promotion PR.

The orchestrator records for each assignment: portal/spec ID, worker model,
recipe, artifact directory, status or blocker code, handoff counts,
recommended next action, promotion PR, review result, and merge result. This is
the durable queue; chat history is not the system of record.

## Safety boundary

Allowed:

- checked-in navigation, capture, and seeded-replay recipe actions
- bounded same-origin link crawling
- same-origin GET probes that pass the runner deny rules
- local parsing of captured JavaScript
- candidate generation and evidence classification

Forbidden:

- POST, PUT, PATCH, or DELETE probes
- GraphQL mutations
- following probe redirects
- sign-out, export, execute, start-job, trigger, or similar action routes
- editing specifications during discovery
- copying bearer tokens, cookies, or tenant data into chat or committed files

The runner may use raw browser headers in memory during capture, but it does not
persist raw authorization or cookie values. Persisted request and response
bodies redact token-bearing keys and token-like strings; persisted headers are
reduced to names, auth-presence signals, and selected non-secret metadata.
Capture artifacts can still contain tenant identifiers and content, so keep
them local. Only `candidate-handoff.json` is designed as the tenant-safe sharing
surface.

## Evidence labels

- `confirmed`: observed from normal portal UI traffic
- `probed`: returned successfully from an explicit safe probe
- `bundle-discovered`: found only in JavaScript or source metadata

Never promote blocked or failed probes to positive evidence. Never model a
bundle-only request or response schema as confirmed.

## Analysis and promotion handoff

The `all` and `analyze` phases normalize captured route families and diff them
against the checked-in specification before generating `candidate-queue.json`.
That is the normalized family diff; do not report
`normalized-family-diff` as a separate post-run command.

`candidate-handoff.json` is the tenant-safe output for follow-up work. It
contains normalized paths and evidence labels only, separated into confirmed
GET candidates ready for human specification review, confirmed non-GET or
method-ambiguous candidates requiring safety classification, successful
probes, bundle-only candidates requiring targeted UI validation, and
intentionally suppressed candidates. It also preserves adjacent confirmed
GETs, adjacent confirmed non-GETs, adjacent successful probes, and adjacent
bundle-only leads in separate scope-review categories. Those entries include
only sanitized host-family routing context and trusted matching spec IDs; they
require explicit specification assignment and cannot be promoted into the
target spec automatically. The handoff does not contain raw hostnames, URLs,
IDs, request bodies, headers, tokens, cookies, raw paths, page labels, artifact
paths, timestamps, or tenant-specific values.

Group adjacent candidates by target host family and specification family. Known
static portal assets under `/entracopilot/Content/`, `/Content/Dynamic/`,
`/AzureHubs/Content/`, `/iam/Content/`, and `/erm/Content/` are analyzer noise:
they remain in suppressed evidence and aggregate counts but are excluded from
actionable scope-review queues. Do not suppress the entire `/entracopilot`
prefix; nearby meaningful routes remain actionable. Split follow-up PRs by
target specification and host family.

Discovery execution ends when these artifacts are generated. Reviewing and
landing supported findings is a separate specification PR; the discovery agent
must not edit specifications automatically.

## Stop and escalation

Do not improvise alternate browser automation after one of these blockers.
Return the blocker code and remediation:

| Code | Meaning |
| --- | --- |
| `browser-cdp-unavailable` | The CDP endpoint is unavailable or lacks required browser metadata |
| `authentication-required` | Preflight or capture detected a sign-in redirect or authentication barrier |
| `artifacts-not-empty` | The capture directory contains evidence from an earlier run |
| `recipe-missing` | No checked-in deterministic recipe exists |
| `feature-gated` | The tenant, role, license, or feature flag blocks the surface |
| `unsafe-action-required` | Further discovery requires a write or potentially active GET |
| `recipe-actions-incomplete` | A required navigation or selector in the checked-in recipe failed |
| `interaction-health-accounting-inconsistent` | Immutable action results disagree with the reported interaction-health counters |
| `pipeline-failed` | A deterministic command failed |

Escalate to a stronger model only for selector repair, scope classification,
or deciding whether a blocked workflow can be observed safely. Do not escalate
routine command execution or artifact summarization.

## Completion response

Return this compact structure:

```text
Portal:
Assignment ID:
Assignment digest:
Assignment type:
Target worktree:
Expected kickoff SHA:
Actual kickoff SHA:
Kickoff status: clean | dirty
Status: completed | blocked | failed
Decision:
Reason codes:
Blockers:
Metrics:
Artifacts (path, immutable status, SHA-256 hash):
Confirmed reads ready for review:
Confirmed safety-classification candidates:
Successful probe candidates:
Bundle-only validation candidates:
Suppressed candidates:
Adjacent confirmed reads requiring scope assignment:
Adjacent confirmed safety-classification candidates:
Adjacent successful probes requiring scope assignment:
Adjacent bundle-only leads requiring scope assignment:
GraphQL/RPC operations:
Passive streaming endpoints:
Coverage gaps:
Blocker code:
Recommended next action:
Reusable lessons:
Lifecycle accounting:
Process-improvement disposition:
Expected final SHA:
Actual final SHA:
Final status: clean | dirty
```

Do not claim exhaustive coverage. Completion means the bounded recipe finished,
the candidate queue and tenant-safe handoff were generated, and remaining gaps
were reported. Specification promotion remains a separate review task.
