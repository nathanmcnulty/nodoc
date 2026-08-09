# Portal Discovery Agent Runbook

Use this runbook for execution. Use `AGENT_DISCOVERY_PLAYBOOK.md` only when a
blocker requires deeper background.

## Agent handoff

Give the agent this repository-relative instruction:

> Read `PORTAL_DISCOVERY_AGENT_PROMPT.md` and follow it exactly for the named
> portal. Do not improvise browser automation, edit specifications, or expose
> captured credentials or tenant data.

The prompt is intentionally separate from this runbook so it can be pasted into
a new agent session without copying the full playbook.

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

## Orchestrator preflight

Run these checks before allocating a capture worker. They are coordinator work,
not discovery work:

1. Confirm the repository remote is the intended fork and never the upstream
   project.
2. Restore the repository's locked dependencies when `node_modules` is absent;
   workers must not install or update packages.
3. Run the portal plan command and require `status: planned`.
4. Verify CDP `/json/version` and `/json/list`, including an authenticated target
   for the intended portal.
5. Confirm the selected recipe exists and choose a fresh artifact directory.

Do not spend a worker allocation on a missing dependency, invalid portal ID,
missing recipe, unavailable CDP listener, or unauthenticated target. Report and
repair those prerequisites at the orchestrator layer first.

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

The deterministic pipeline attaches to an already authenticated browser. The
agent must not launch, close, or repair that browser. Before assigning a capture
worker, the operator must launch a dedicated Edge or Chrome profile with remote
debugging enabled, sign in to the portal, and verify both the browser endpoint
and page targets.

Use one persistent dedicated profile per browser and portal so authentication
survives retries without copying or modifying the user's normal browser profile:

```powershell
$portal = "m365-admin"
$portalUrl = "https://admin.cloud.microsoft"
$browserName = "edge" # edge or chrome
$browserCandidates = if ($browserName -eq "edge") {
   @(
      (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
      (Join-Path ${env:ProgramFiles} "Microsoft\Edge\Application\msedge.exe")
   )
} else {
   @(
      (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
   )
}
$browser = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "Could not find $browserName in a standard install path." }

$profileDir = Join-Path $env:LOCALAPPDATA "nodoc-cdp\$browserName-$portal"
$existingCdp = try {
   Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 2
} catch {
   $null
}

if (-not $existingCdp) {
   $listener = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
   if ($listener) {
      throw "Port 9222 is occupied but is not a healthy CDP endpoint. Resolve it manually; do not kill the owning process from an agent run."
   }
   Start-Process $browser -ArgumentList @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  "--user-data-dir=$profileDir",
  "--no-first-run",
  "--no-default-browser-check",
      $portalUrl
   ) | Out-Null
}

$version = Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 3
$targets = Invoke-RestMethod http://127.0.0.1:9222/json/list -TimeoutSec 3 |
   Where-Object { $_.type -eq "page" }
if (-not $version.webSocketDebuggerUrl) { throw "CDP endpoint has no browser WebSocket URL." }
$version | Select-Object Browser, webSocketDebuggerUrl
$targets | Select-Object id, title, url
```

Before handing off to an agent, the operator must confirm that the listed page
target is the intended portal and is past sign-in. If an existing endpoint is
the wrong dedicated session, has stale targets, or times out during attach, the
operator may close that dedicated debug browser and relaunch the same dedicated
profile. Never kill a listener by PID, close the user's normal browser, copy a
normal browser profile, or run two automation modes against the same session.

Every retry after browser recovery uses a new empty artifact directory. A
healthy completed capture may be analyzed again without reopening the browser.

## Execution

1. Read the machine-generated portal brief:

   ```powershell
   npm run discover:portal -- --portal m365-admin --profile bounded --phase plan --json
   ```

2. Choose a unique, fresh artifact directory outside the repository for every
   execution, including reruns after authentication:

   ```powershell
   $artifacts = Join-Path $env:TEMP ("nodoc-m365-admin-discovery-" + [guid]::NewGuid())
   ```

3. Run the deterministic pipeline:

   ```powershell
   npm run discover:portal -- --portal m365-admin --profile bounded --phase all --endpoint https://admin.cloud.microsoft --artifacts $artifacts --ledger-path $ledgerPath
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

    Never resume `capture` or `all` into a non-empty directory, merge artifact
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
  currently `gpt-5.3-codex-spark` at low reasoning. Use `gpt-5.6-luna` only when
  Spark is unavailable or repeatedly fails to execute the deterministic
  contract. Model fallback does not relax safety or evidence rules.
- On a single CDP endpoint, the maximum live capture concurrency is one. The
  orchestrator may queue additional portals, but must not start their capture
  workers until the current owner has released the endpoint. Offline analysis
  and promotion review may run concurrently over different immutable artifact
  directories.
- Treat a worker that returns no message separately from a failed pipeline.
  Inspect the assigned directory for `discovery-run.json`. If capture artifacts
  are complete, run `analyze` once against that directory and reconstruct the
  completion response from the primary outputs. If capture is incomplete,
  preserve it and use the documented seeded retry in a new directory.

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
| `browser-cdp-unavailable` | No authenticated browser is listening on port 9222 |
| `authentication-required` | The portal redirected to sign-in or returned an auth barrier |
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
Status: completed | blocked | failed
Artifacts:
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
```

Do not claim exhaustive coverage. Completion means the bounded recipe finished,
the candidate queue and tenant-safe handoff were generated, and remaining gaps
were reported. Specification promotion remains a separate review task.
