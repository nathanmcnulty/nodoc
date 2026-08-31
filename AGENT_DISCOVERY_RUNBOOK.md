# Portal Discovery Agent Runbook

Use this runbook for execution. Use `AGENT_DISCOVERY_PLAYBOOK.md` only when a
blocker requires deeper background.

## Agent handoff

### Layer 1 controller commands

### Final report-first controller (Layer 4)

The final controller is offline and report-only. It composes the validated portfolio plan, review assignments, promotion plan, retrospective, benchmark scorecard, and unresolved frontier without opening a browser, mutating the runtime ledger, editing specifications, or creating GitHub actions.

The deterministic controller program has no model identity. The model-backed
orchestrating session uses exact `gpt-5.6-sol` at high reasoning and owns worker
assignment, output acceptance, and the final quality gate. Live CDP capture uses
exact `gpt-5.6-luna` at low reasoning. Offline evidence, safety, scope, and
promotion review uses exact `gpt-5.6-luna` at `xhigh` by default; `max` is
allowed when the Sol orchestrator records that the review is unusually ambiguous
or high risk. Sol reviews the Luna result but does not replace the required Luna
review artifact. Wrong-model or wrong-reasoning output fails closed.

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
npm run control:portal-discovery -- compile-plan --summary --json
npm run control:portal-discovery -- status --ledger .portal-discovery-ledger.jsonl --json
```

To enqueue the capture assignments from the compiled plan, supply both the
ledger and the explicit apply opt-in. The command returns an `applied` receipt
with each enqueued assignment and attempt; without `--apply` it remains
report-only.

```powershell
npm run control:portal-discovery -- compile-plan --summary --ledger .portal-discovery-ledger.jsonl --apply --json
```

Portfolio status selects the newest assignment for each specification and reports
its `captureComplete`, `captureStatus`, and `blockerCode` separately from the
assignment state. A terminal `completed` assignment with an interrupted or
incomplete capture is not complete evidence and must not outrank an older usable
artifact during review.

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
assignment to its legal queued state. Model-backed results must report the exact
model and reasoning assigned by the policy above; wrong-role output is rejected.

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
manual review, while suppressed work is blocked. `cheap` remains a legacy
complexity/routing label, not a different model: imported review entries use
Luna at `xhigh` or `max`. Manual and blocked entries remain visible but
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
PR. Deterministic tooling may classify known reason codes only; Luna at `xhigh`
or `max` plus the Sol quality gate is required for safety, scope, thresholds,
and model disagreement. Retries,
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

## Engagement outcomes and iteration order

Each portal engagement must produce evidence for three separate questions:

1. Which operations are new to the repository? Compare normalized method, path,
   host family, and GraphQL/RPC/stream identity against every checked-in spec,
   not only the assigned entrypoint.
2. Which known operations now error, no longer emit from their declared state,
   or may have been removed? Record the observed status or absence and separate
   auth, feature, tenant-data, parameter, and transient-service failures from a
   `removed-candidate`. One failed request or one quiet page is not proof of
   removal.
3. Which known operations remain incomplete? Target missing parameters, request
   body fields, response statuses, media types, schemas, auth/routing context,
   descriptions, examples, and evidence provenance.

Retain all observed methods. Reads, POST-backed reads, mutations, GraphQL/RPC,
streaming, and job-style transports receive separate safety and execution-state
labels; no non-GET is discarded merely because it is not promotion-ready.

Also inventory automatic portal side effects separately from agent-invoked
operations. For each passive non-GET, retain its action/checkpoint attribution,
status, request shape, response shape, and any naturally emitted before/after
reads. When only a before read and successful write are visible, report a
likely real but unverified side effect; do not relabel it as an active-operation
`unresolved-change` because no approved operation was invoked. The runner writes
this reviewer projection to `passive-operation-receipts.json`; use its evidence
IDs to open the corresponding `raw-requests.json` records only when body-level
review is necessary.

For a multi-spec session, use one spec as a process-calibration unit at a time.
Prefer the oldest material specification update that has a valid frontier and
usable authenticated surface, unless risk, dependency, or expected information
gain justifies another order. After each spec, complete evidence review,
known-operation health disposition, qualified promotion/PR disposition, and a
short retrospective. Apply and validate an accepted prompt, recipe, analyzer,
or schema improvement before starting the next live lifecycle. Never use a
documentation-only commit or generated-file refresh as proof that a spec was
recently rediscovered.

For portfolio-wide refresh work, close the loop with
`npm run validate:spec-evaluations`. The audit accepts exactly three terminal
dispositions: a satisfied checked-in novelty frontier, a blocked prerequisite
that names the deterministic evidence needed to reopen capture, or a derived
research surface such as Microsoft Graph Research that is refreshed through
its owning portal captures. An active or missing frontier keeps the portfolio
open; file modification time alone never satisfies the gate.

## Required input

The task must name one portal by title or spec ID, for example `M365 Admin` or
`m365-admin`. Unless the task says otherwise:

- do not edit OpenAPI specifications
- use the `observe-only` operation-authorization ceiling; do not submit forms or
  intentionally invoke state-changing operations
- do not export secrets from the browser
- keep artifacts outside the repository
- stop after the checked-in recipe, candidate analysis, and handoff generation complete

An assignment that intentionally exercises an operation must name one exact
ceiling: `abort-only` or `reversible-scalar`. Broad language such as "writes are
allowed" is not sufficient. The assignment must also name the checked-in action
and approval digest, target method and normalized route, operation budget, and
required abort or rollback evidence. Missing fields revert to `observe-only`.

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
exists after null output, retry the exact `gpt-5.6-luna` low-reasoning capture
assignment exactly once with a compact report-first request. If that retry also
returns null, the Sol orchestrator inspects the artifacts and either issues one
fresh bounded Luna-low assignment or records a structured blocker; Sol never
becomes the capture worker. Preserve every materialized failed-worker artifact
and record its hash; retain useful artifacts for recovery.
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
   when the entry is HTTPS, same-origin, and constrained by an explicit clean
   host/path `pageTarget`; fragments are never matching or capture criteria.
   Entry queries require an exact non-secret
   `pageTarget.allowedEntryQueryParameters` allowlist. Unknown keys,
   credential-like keys, and checked-in tenant values fail closed; query values
   remain run variables and never become page-target or capture criteria.
   For an expensive discovery assignment, also pass `--require-novelty` and
   require a non-empty `noveltyPlan`. Each frontier target must be tied to exact
   checked-in action indexes and declare its UI state, expected host/route,
   expected request/response-shape or metadata class, evidence level, safe
   action, and acceptance key. A plan containing only known replay is blocked
   before owner allocation.
   The plan must derive its primary baseline from the checked-in OpenAPI and
   merge the recipe's `baselineSignals` overlay for accepted runtime-only route,
   query, request-shape, response-shape, and response-metadata keys. Empty
   overlay arrays mean no additional runtime signals have been accepted; they
   never disable the derived OpenAPI comparison. Shape or metadata from an
   undocumented route counts only when the normalized method/path survives
   suppression into a reviewable candidate bucket; telemetry sinks, static
   assets, and other suppressed traffic cannot manufacture novelty.
   Before planning, run the offline frontier compiler against the checked-in
   OpenAPI, generated coverage ledger, and available sanitized prior artifacts.
   Do not allocate a browser for `satisfied-prebrowser-block`,
   `blocked-no-exact-frontier`, or `blocked-adjacent-ownership`. An active
   frontier requires a concrete `reopenCondition`, immutable approval digest,
   and exact state/action mapping. Click-driven targets additionally require
   readiness metadata covering every targeted click.
4. Require `npm run browser:cdp:status -- --profile-key <key>` to report the
   manifest-owned browser as healthy, then run the portal driver against that
   exact loopback endpoint. Its recipe-gated preflight verifies browser metadata,
   expected product, exactly one matching page, harmless Runtime.evaluate,
   authentication, and stable identity. If the feature target is absent, a
   checked-in `pageTarget.bootstrap` may authorize one exact-target GET to the
   recipe's first navigation URL, followed by strict preflight bound to the same
   target ID.
   If the selected novelty recipe declares `frontierControlReadiness`, the
   driver then inventories the declared root/child target scopes before
   creating a ledger attempt or starting capture. Every referenced control
   must have exactly one visible match. Zero matches are
   `absent-not-applicable`; multiple matches or unavailable frame inventory are
   `ambiguous`. Either state emits `frontier-control-unavailable`; do not
   bypass it, guess a direct route, or treat generic ReactBlade frames as named
   frontier progress. Use exact stable href or accessibility/automation
   identifiers when label containment would match an ancestor and a control.
5. Confirm the selected recipe exists and choose a fresh artifact directory.

Do not spend a worker allocation on a missing dependency, invalid portal ID,
missing recipe, unavailable CDP listener, or unauthenticated target. Report and
repair those prerequisites at the orchestrator layer first.

Do not spend a worker allocation merely to reconfirm checked-in operation keys.
Classify old or absent live-ledger evidence as `capture-freshness-gap`; it is not
API novelty by itself. A generic response schema can justify targeted enrichment
only when a sanitized immutable response proves a non-empty shape and maps to an
exact deterministic UI state. When detail operations require tenant row IDs but
no immutable row/control provenance exists, record
`missing-immutable-state-provenance` and stop before browser allocation.
Do not equate endpoint yield with route yield. The offline frontier also
inventories operation context, parameter/request/response examples, error
behavior, permissions, and pagination. An approved target may use
`expectedDocumentationObjectives` to collect a sanitized request, response,
error, or pagination example from a known route. The objective must be backed by
the compatible request-shape, response-shape, response-metadata, or
query-metadata class and by the exact action that emitted it. Promote only
tenant-safe representative examples; record troubleshooting meaning and
remediation separately from the raw error payload.
Known routes may establish baseline context, but every costly assignment must
target at least one unvisited state, unmodeled host/route family, or known
schema/metadata gap. Large recipes require materialized signals across at least
two frontier targets. The driver writes `novelty-assessment.json`; treat
`no-novelty` as a recipe/frontier revision outcome, not discovery success, and
never rerun the same plan unchanged. A run with zero records matching every
expected frontier route is `no-target-signal`; artifact completeness does not
make that a completed novelty attempt, and the frontier remains open. When a
passive bootstrap target is already at its canonical URL, require the explicit
same-origin `reload=<checkpoint>` recipe action and a completed load event so a
same-URL navigation cannot become an expensive no-op.
During coordinator review, update `baselineSignals` with accepted signal keys
before scheduling any follow-up so the same evidence cannot count twice.
Evidence must be attributed to the exact frontier action page that emitted it;
bootstrap traffic, failed actions, raw prefix collisions, and records from a
different target state do not count. When a normalized record aggregates
observations from multiple pages, its explicit `attribution.actionIndex` owns
the signal; `seenOnPages` is only a legacy fallback and must not spread unioned
query or shape metadata across targets. Empty JSON arrays or objects do not
establish a promotable response shape.
Known localization `.resjson` resources are static portal assets and remain in
the suppressed evidence bucket even when their path falls under an in-scope API
prefix.

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

# Only when status reports owner-identity-changed after a verified launcher handoff:
npm run browser:cdp:rebind -- --profile-key m365-admin --port 9222

# Rebind restores lifecycle identity only. Run authenticated preflight again:
npm run preflight:browser-cdp -- --endpoint http://127.0.0.1:9222 `
  --expected-product Edge --match-host admin.cloud.microsoft

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
inspect target authentication. A new launch uses an explicit new window and
must expose at least one CDP page target before it can report owner-ready; a
version-only listener with an empty `/json/list` fails closed. Leave exactly one intended portal page open,
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
match; it never kills by process name. If the recorded PID disappears while one
exact token/profile candidate remains, retain the manifest and stop nothing.
The operator may run explicit `rebind` only when exactly one process still
matches the manifest's binary, token, fixed port, and dedicated profile and the
CDP product still matches; zero or multiple candidates and product mismatch
leave the manifest unchanged. A live listener without that one exact candidate
remains an identity/orphan blocker. Remove a stale manifest only after the
recorded PID and exact candidates are absent and the endpoint is confirmed free.
Never rebind an occupied listener without a manifest, after unknown process
inspection, with zero or multiple candidates, or after a CDP product mismatch.
Successful rebind restores lifecycle identity only; authenticated preflight is
required again before ledger allocation or capture.

### Closing a portal discovery run

Closing a portal is an explicit operator step after the run has reached a
terminal state and the evidence/review decision is recorded. Use the checked-in
cleanup command instead of deleting profile directories by hand:

```powershell
npm run close:portal-discovery -- --artifacts $artifacts `
  --profile-key m365-admin --port 9222 --purge-profile
```

The command fails closed unless `discovery-run.json` is terminal (`completed`,
`blocked`, or `failed`). A `completed` run must also report
`capture.captureComplete: true` and contain both `summary.json` and
`candidate-handoff.json`. It stops only the exact manifest-owned browser,
verifies that no Edge/Chrome process still references the dedicated profile,
and removes only the single validated child beneath
`%LOCALAPPDATA%\nodoc-cdp\profiles`. The command writes a sanitized receipt to
`%LOCALAPPDATA%\nodoc-cdp\cleanup-receipts` and leaves immutable capture
artifacts and the shared derivative `bundle-cache` untouched.

`--purge-profile` is intentionally explicit because it removes the persistent
portal sign-in state; omit it when the operator needs to retain the profile for
an authorized repair or retry. A blocked or failed run may be closed only when
the operator has decided that no live repair is pending. Profile cleanup does
not manage Git branches or worktrees; those remain the promotion/merge owner's
responsibility.

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

1. Generate the machine-bound capture worker packet:

   ```powershell
   npm run discover:portal -- --portal m365-admin --profile bounded --phase plan --require-novelty --worker-packet --json
   ```

   When the capture came from the control plane, pass its exact
   `--assignment-id` and `--assignment-digest` while generating the packet.
   Both values are then bound into the packet hash, executable driver arguments,
   and terminal `discovery-run.json` receipt. Use `compile-plan --summary` for
   routine selection; request the full plan only for application or detailed
   review.

   The coordinator hands the capture worker only the returned packet, not the
   entire prompt, runbook, playbook, or `noveltyPlan`. In the target checkout,
   rerun the packet's `execution.verificationArgs` and require the same
   `packetSha256` before browser work. The packet is sufficient for routine
   deterministic execution; read the bound policy files in full if the digest
   differs or any listed escalation trigger occurs.
   `measurements` compares UTF-8 bytes only and intentionally does not claim an
   exact tokenizer saving.

2. Choose a unique, fresh artifact directory outside the repository for every
   execution, including reruns after authentication:

   ```powershell
   $artifacts = Join-Path $env:TEMP ("nodoc-m365-admin-discovery-" + [guid]::NewGuid())
   $bundleCache = Join-Path $env:LOCALAPPDATA "nodoc-cdp\bundle-cache"
   ```

3. Run the deterministic pipeline:

   ```powershell
   npm run discover:portal -- --portal m365-admin --profile bounded --phase all --require-novelty --endpoint https://admin.cloud.microsoft --artifacts $artifacts --ledger-path $ledgerPath --bundle-cache-dir $bundleCache
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
       npm run discover:portal -- --portal m365-admin --profile bounded --phase all --require-novelty --endpoint https://admin.cloud.microsoft --artifacts $retryArtifacts --seed-artifacts $artifacts --bundle-cache-dir $bundleCache
       ```

    This recovery path is distinct from the delegated null-output contract: it
    recovers a materialized capture, not a missing worker response, and each
    seeded retry uses a new attempt and fresh artifact directory. Never resume
    `capture` or `all` into a non-empty directory, merge artifact
    directories, or use `analyze` as a substitute for an incomplete capture.
    The seeded run validates that `discovery-run.json` names the exact latest
    terminal incomplete ledger attempt, then atomically creates and claims the
    next attempt. A mismatched seed, completed capture, changed recipe/endpoint,
    or competing state fails before CDP execution.
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

### Microsoft Graph telemetry and contract deltas

Fetch a pinned official Graph contract snapshot outside the repository before
any cross-portal Graph discovery series:

```powershell
$graphContract = Join-Path $env:LOCALAPPDATA "nodoc-cdp\graph-contract"
npm run sync:graph-contract -- --output-dir $graphContract
```

The sync records the exact `microsoftgraph/msgraph-metadata` commit, hashes the
v1.0 and beta OpenAPI sources, and emits hashed compact operation indexes. The
runner verifies the manifest and indexes from that default directory during
`all` and `analyze`; pass `--graph-contract-dir <dir>` for another cache. A
missing cache retains Graph observations as
`official-contract-not-supplied`, never as undocumented. A corrupt or partial
cache fails closed. `--no-graph-contract` is only for explicitly offline capture
where contract classification is intentionally deferred.

`graph-telemetry.json` includes direct calls, exact allowlisted Defender/Purview
and M365 Admin Graph proxies, plus parseable `/$batch` members,
normalizes identifiers and equivalent Graph route spellings, records statuses,
query parameter names, action/checkpoint and portal provenance, safe header-name
profiles, and request/response shape digests and type-only summaries, and binds
the comparison snapshot. Sanitized batch diagnostics also
retain wrapper errors, member-status sets, parse failures, and unsupported or
malformed member counts even when no member operation can be promoted. It never
includes raw body values.
`graph-research-queue.json` is the bounded agent-facing derivative: it separates
official-contract deltas, errored operations, batch issues, and documented
operations with usable shape evidence, and binds them to the source telemetry
digest. The candidate handoff carries only its counts and digest.
Use documented calls to enrich the portal workflow and examples without copying
the public Graph operation into a portal-owned specification. Treat
`undocumented-candidate` as a separate ownership/research queue requiring review
against the pinned source; it is not automatically promotion-active.

Promote a delta only into `specifications/nodoc-graph-research` after
`npm run validate:graph-research` accepts it. Admission requires two complete,
healthy corroborating captures, a successful response, structured shape evidence,
an exact pinned-contract absence, sanitized immutable provenance, and a reviewed
safety class. Never promote `/$batch`, a portal proxy URL, a request-only member,
or an error-only observation. Keep proxy routes in their owning portal specs.

Graph-focused recipes use `graphTelemetryObjectives`. Check in the normalized
operation keys from prior accepted telemetry as `baselineOperationKeys`, then
set proportional minimums for operations, operations new to that baseline,
batch members, proxy operations where applicable, shape-enriched operations, and action checkpoints. The runner
emits `graph-telemetry-assessment.json` and blocks `contract-unavailable`,
`no-graph-signal`, and `objective-incomplete` outcomes. This makes documented
Graph workflow enrichment measurable without mislabeling repeated `/me` or
bootstrap calls as discovery.

### Bundle analysis cache

Bundle analysis caching remains disabled by default for legacy execution, but
it is required for expensive `--require-novelty` capture assignments. Pass
`--bundle-cache-dir <directory>` to `run-portal-discovery.mjs`; use a stable
directory outside the repository and artifact directories. It is a local
derivative cache and must not be used as evidence storage. Entries are keyed by SHA-256 bundle content,
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
- Use exact `gpt-5.6-luna` at low reasoning for bounded live capture and exact
  Luna at `xhigh` for offline review; the Sol orchestrator may select `max` for
  an unusually ambiguous or high-risk review. Complete captures use analyze-only
  recovery; incomplete captures use a seeded retry in a new directory. A null
  capture response receives one compact Luna-low retry and then returns to the
  Sol orchestrator for acceptance or a fresh bounded assignment. Model routing
  never relaxes safety or evidence rules.
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
  directory. Apply the null-output Luna-low retry only when no accepted artifact
  or report exists.

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
- passive capture and classification of every method emitted by normal portal UI
- an exact active-operation action only when its assignment, checked-in recipe,
  approval digest, tooling, budget, and evidence contract all satisfy the
  operation-authorization policy below

Forbidden:

- generic POST, PUT, PATCH, DELETE, or GraphQL mutation probes
- following probe redirects
- active operations under an `observe-only` assignment
- active operations when abort or rollback evidence tooling is unavailable
- create/delete, sign-out, export, execute, start-job, trigger, identity/access,
  credential, bulk, shared-shell, retention/destructive, or uncertain-scope actions
- editing specifications during discovery
- copying bearer tokens, cookies, or tenant data into chat or committed files

Pricing, catalog, eligibility, and Trials surfaces are safe to inspect only
through a checked-in observe-only inspection recipe. Do not activate a trial,
create paid capacity, purchase, buy, or start a billable resource. An
`inspectionPolicy.mode: observe-only` recipe is mechanically limited to
navigation, reload, wait, and capture actions and cannot contain an active
operation plan.

### Active-operation authorization and evidence

The authorization ceiling is one of:

- `observe-only`: record naturally emitted operations of every method; invoke no
  state-changing operation intentionally. This is the default.
- `abort-only`: open the real UI flow and use a checked-in CDP Fetch-domain
  action to capture the exact request and prove it was failed before backend
  execution. `Network.requestWillBeSent`, a canceled dialog, or an unchanged UI
  is not proof of abort.
- `reversible-scalar`: only after abort capture is insufficient, change one
  known object and one low-impact bool, bounded integer, or similarly trivial
  scalar whose original value and deterministic rollback are known.

The checked-in runner supports one active operation plan per run. The plan and
runtime authorization must agree on the exact ceiling and SHA-256 approval
digest. Generate the digest offline with:

```text
npm run approve:portal-operation -- --recipe <recipe> --operation <operation-id> [--var name=value]
```

Then add `--operation-ceiling <abort-only|reversible-scalar>` and
`--operation-approval-digest <digest>` to `discover:portal`. A mutation step must
reference one exact `click-automation-id` action and bind its action index,
target page URL, HTTP method, request URL, and required request-body shape
fingerprint. Derive that fingerprint from previously observed passive traffic or
checked-in bundle evidence; an active operation cannot be the first source of
its own payload authorization.
The target host must be listed exactly in `matchHosts`. Generic label/contains
clicks cannot authorize an active operation.
Abort-only accepts exact POST, PUT, PATCH, and DELETE requests. DELETE is not a
reversible scalar operation and must never be continued to the backend.
Immediately before an active click, the runner waits for every attached child
target to finish Fetch setup, refreshes the control inventory, and binds the one
eligible control to its concrete CDP target ID and session ID. Evaluation
failure on that target does not fall through to another same-URL target. The
paused request must carry the same target ID and session ID to count as the
approved request.

Minimal abort plan shape:

```json
{
  "actions": [
    { "type": "click-automation-id", "value": "SaveSetting", "scope": "root", "required": true }
  ],
  "activeOperations": [
    {
      "operationId": "capture-setting-update",
      "mode": "abort-only",
      "steps": {
        "invoke": {
          "actionIndex": 0,
          "method": "PATCH",
          "requestBodyShapeFingerprint": "<lowercase-sha256-of-canonical-body-shape>",
          "targetUrl": "https://portal.example.test/settings",
          "url": "https://api.example.test/settings/one"
        }
      }
    }
  ]
}
```

A reversible plan uses five strictly increasing action indexes:
`preState` (`probe-get`), `apply` (`click-automation-id`), `postState`
(`probe-get`), `rollback` (`click-automation-id`), and `finalState`
(`probe-get`). It also declares `concurrency: { "mode": "etag" }` and
`scalar: { "type": "boolean", "jsonPointer": "/enabled", "testValue": true }`.
An integer scalar additionally declares safe-integer `minimum` and `maximum`.
Apply and rollback must bind the same exact method and URL; all three reads bind
the same exact URL. Recipe variables are expanded before the digest is computed.

For `abort-only`, the runner enables CDP Fetch Request-stage interception on
the root and every attached child target before activating the control. It
continues ordinary reads, fails unexpected non-GET and active-looking GET
requests closed, and issues `Fetch.failRequest` for the exact approved request.
Only an acknowledged failure of exactly one request from one uniquely eligible
control is `aborted-before-send`. Setup gaps, duplicate matches, extra active
requests, timeouts, and CDP failures remain unproven; the runner invalidates the
active document and attempts to close the exact page target while interception
is still enabled. If containment cannot be acknowledged, it leaves interception
enabled in containment-only mode until the CDP session terminates. That mode
continues ordinary reads but fails every later mutation and active-looking GET,
including a late copy of the otherwise approved request. The runner records
`mutation-abort-unproven`, and blocks later live work.

`aborted-before-send` proves only that the exact paused browser request was
failed at CDP Fetch Request stage instead of being continued to the network. It
does not prove that temporary local UI state was unchanged; checkpoint and
transition evidence describe that client-side state separately.

A reversible attempt must persist local evidence for the pre-state read,
mutation request/response, and post-state read. If post-state confirms the test
value, it must also persist the rollback request/response and a final read
proving restoration. If post-state proves the original value never changed, the
runner skips rollback and requires a final read confirming that original value.
Every captured response must succeed and any exact apply/rollback pair must
prove optimistic concurrency through ETag/If-Match. Boolean values
must be typed; integer values must be safe integers inside declared bounds.
Apply and rollback execute inside Fetch Request-stage gates that continue exactly
one approved request and fail duplicate or unexpected active requests closed.
The allowed request's emitting target and session must equal the bound control's
target and session; presence of IDs alone is not sufficient.
Before acknowledging `Fetch.continueRequest`, the runner durably writes an
unresolved operation intent. A setup failure also writes an unresolved receipt.
The receipt reconciles each gate's allowed, duplicate-aborted, unexpected-aborted,
and setup counts before it can be terminal. Record exact action/evidence IDs and
hashes while keeping
raw values out of tenant-safe handoffs. Classify each attempt as
`aborted-before-send`, `sent-no-confirmed-change`, `committed-and-restored`, or
`unresolved-change`. Any sent request with failed or unknown post-state or
rollback stops all further mutation work and all later live lifecycles until the
operator receives an explicit remediation record. Missing evidence is unknown,
not success.

The full sanitized active-operation receipt is written locally to
`mutation-events.json`. Naturally emitted non-GET traffic is written separately
to `passive-operation-receipts.json`, with action/session/target attribution,
semantic-risk classification, response evidence, and nearby read references.
The latter does not claim verified before/after correlation or restoration.
`summary.json`, `candidate-handoff.json` (including grouped shared metadata),
`discovery-run.json`, and the ledger carry only sanitized operation IDs,
approval digests, execution states, accounting, unresolved IDs, and remediation.
Before those artifacts can clear the lifecycle, validation independently
rechecks terminal Fetch-gate accounting and bindings, before/after/rollback
evidence, scalar restoration, ETag/If-Match proof, and exact linkage to the
approved plan. A terminal label with missing or inconsistent evidence fails
closed even if its summary counters claim success.
Terminal completion and healthy saturation are forbidden while an unresolved
operation exists. The driver revalidates the receipt schema, every execution
state, summary counts, and the `summary.json`/`mutation-events.json` match. It
loads that state even when the capture subprocess fails, and the ledger itself
coerces any success status with `safeToContinue: false` to `blocked`. Grouped
handoffs hash their shared active-operation metadata.
The driver also binds `mutation-events.json` authorization and every receipt to
the current operation ID, ceiling, and approval digest; a self-consistent stale
receipt from another plan becomes unresolved rather than accepted.

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
| `mutation-authorization-required` | The assignment did not grant an exact active-operation ceiling |
| `mutation-interception-unavailable` | Abort-before-send was requested but the checked-in runner cannot prove it |
| `mutation-receipt-unavailable` | Reversible execution was requested but the checked-in runner cannot produce the required receipt |
| `mutation-abort-unproven` | The exact request was not uniquely paused and successfully failed before send |
| `mutation-rollback-unresolved` | A sent operation has failed or unknown post-state or rollback and needs operator remediation |
| `recipe-actions-incomplete` | A required navigation or selector in the checked-in recipe failed |
| `interaction-health-accounting-inconsistent` | Immutable action results disagree with the reported interaction-health counters |
| `pipeline-failed` | A deterministic command failed |

Route selector repair, scope classification, operation safety, and blocked-flow
decisions to Luna at `xhigh` or `max`, then require the Sol orchestrator quality
gate. Do not increase capture-worker reasoning for routine command execution or
artifact summarization.

A review worker result is not accepted without a nested `qualityGate` record
from exact `gpt-5.6-sol` at high reasoning. The gate binds the assignment ID and
digest plus the SHA-256 digest of the worker result with `qualityGate` omitted,
records `decision: "accept"` and an ISO `reviewedAt`, and is validated by the
control plane. A pending, rejected, wrong-model, wrong-reasoning, stale, or
digest-mismatched gate fails closed.

## Completion response

Return this compact structure:

```text
Portal:
Assignment ID:
Assignment digest:
Assignment type:
Worker model:
Worker reasoning:
Sol quality-gate status: pending | accepted | rejected
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
Confirmed non-GET operations observed:
Confirmed safety-classification candidates:
Successful probe candidates:
Bundle-only validation candidates:
Suppressed candidates:
Known-operation health: healthy | erroring | not-observed | removed-candidate | unavailable
Incomplete operation metadata filled or still missing:
Active-operation authorization: observe-only | abort-only | reversible-scalar
Active-operation attempts and execution states:
Unresolved real changes and operator remediation:
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
the candidate queue and tenant-safe handoff were generated, known-operation
health and active-operation accounting are complete or explicitly unavailable,
and remaining gaps were reported. Specification promotion remains a separate
review task.
