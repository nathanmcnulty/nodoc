# Portal discovery agent prompt

Offline per-spec reconciliation and review assignments may execute concurrently,
but every live browser-owner/CDP lifecycle is globally serialized across all specs
and portal hosts. Exactly one owner, preflight, alignment, ledger attempt, capture,
finalization, and shutdown lifecycle may be active at a time. A next live lifecycle
waits for terminal owner shutdown, artifact/ledger accounting, evidence review,
qualified spec/Postman PR disposition, and process-improvement disposition. Review
and controller sessions require exact runtime model `gpt-5.6-luna`; wrong-model
output is rejected.

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

Copy this prompt into a new agent session after the operator has started and
authenticated the dedicated CDP browser described in
`AGENT_DISCOVERY_RUNBOOK.md`.

```text
Perform bounded API discovery for `<portal-title>` (`<portal-spec-id>`).

This assignment is one execution shard. Do not coordinate other agents, install
dependencies, repair the environment, review unrelated portals, promote
findings, create a branch or pull request, or merge changes. The orchestrator
owns those stages.

The first action, before reading any repository documentation, is to switch to
the named target worktree, or use absolute `git -C <target-worktree>` paths.
Then read `AGENT_DISCOVERY_RUNBOOK.md` and follow it exactly. Report and verify
the expected kickoff SHA, actual kickoff SHA, and clean/dirty status against the
orchestrator baseline; report the expected final SHA, actual final SHA, and
clean/dirty status too.
Idle, completed, or success is not acceptance: require materialized non-null
output, an explicit cross-session report, an immutable artifact with a hash, or
a commit. Apply recovery in this order: a complete immutable capture artifact
is accepted evidence; analyze it once and reconstruct the report instead of
retrying the worker. An incomplete capture is not accepted evidence; preserve
it, record its hash, and use the seeded retry in a new artifact directory. Only
when no materialized usable capture or report exists after null output, a
low-capability capture assignment uses exactly `gpt-5.3-codex-spark`, retries
exactly once with a compact read-only report-first request, then escalates
exactly to `gpt-5.6-luna` if that retry remains null. Assignments already routed
to Luna or manual review keep that route. Preserve every materialized
failed-worker artifact and record its hash. Do not launch a broad wave until a
representative probe materializes accepted output.

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
the feature target is absent, the checked-in recipe may authorize one exact
same-portal bootstrap-target GET alignment, bounded same-ID navigation
readiness, and then strict preflight on the same target ID. Readiness must
reach the checked-in entry URL or fail closed; it is not an arbitrary wait:

The plan must first validate the selected recipe's target metadata. An explicit
`pageTarget` describes the browser UI only; top-level `matchHosts` and
`matchPathPrefixes` remain network-capture filters and must not be reused as UI
criteria. A legacy SPA fragment is allowed only for an HTTPS, same-origin,
query-free entry URL with an explicit clean host/path `pageTarget`; the fragment
never becomes a target criterion or capture filter. A metadata blocker is
terminal before browser allocation or ledger mutation.

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

Run the deterministic interface:

  npm run discover:portal -- --portal <portal-spec-id> --profile bounded --phase plan --json

Then create a unique artifact directory outside the repository and run:

  npm run discover:portal -- --portal <portal-spec-id> --profile bounded --phase all --artifacts <fresh-artifact-directory>

Read the primary output files named by the runbook, including
`candidate-handoff.json`. The `all` phase already performs the normalized
family diff; do not recommend that diff as a separate post-run command. This is
an execution-only validation: do not edit, commit, or push repository files.
Browser/CDP/live capture and write execution require explicit operator
authorization. Do not submit forms, invoke writes, follow redirects, export secrets, or copy
cookies, bearer tokens, or tenant data into chat. Landing supported findings is
a separate human-reviewed specification PR.

Return the exact compact completion structure from the runbook, including the
target worktree, expected and actual kickoff SHA, kickoff clean/dirty status,
expected and actual final SHA, final clean/dirty status, and every artifact path
with immutable status and SHA-256 hash. Distinguish
confirmed reads, confirmed candidates needing safety classification, successful
probes, bundle-only candidates, suppressions, and adjacent scope-review
evidence. Report adjacent confirmed reads, confirmed non-GETs, successful
probes, and bundle-only leads separately; they require explicit specification
and host-family assignment and are not promotion-ready for the target spec.
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

If command execution finishes but you cannot return a normal response, leave
the artifact directory unchanged. The orchestrator may inspect
`discovery-run.json`; a complete capture is accepted evidence and permits only
the documented `analyze` recovery, while an incomplete capture requires a
seeded retry in a new artifact directory. Never rerun capture into the same
directory.
```
