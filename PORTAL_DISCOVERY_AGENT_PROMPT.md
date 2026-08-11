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
normalize method, path template, and canonical alias, then use mutually
exclusive sets and require both equations:

```text
raw observations = emitted + duplicate-shadowed + orphaned + intentional-filtered + alias-observations
emitted = matched + unresolved
```

Aliases are counted once as alias observations, and emitted/matched/unresolved
sets contain canonical keys only. An unbalanced or unavailable reconciliation
is unknown and cannot justify a coverage claim.

Copy this prompt into a new agent session after the operator has started and
authenticated the dedicated CDP browser described in
`AGENT_DISCOVERY_RUNBOOK.md`.

```text
Perform bounded API discovery for `<portal-title>` (`<portal-spec-id>`).

First read `AGENT_DISCOVERY_RUNBOOK.md` in this repository and follow it
exactly. It is the execution contract. Do not use the deeper
`AGENT_DISCOVERY_PLAYBOOK.md` unless the runbook says a blocker needs it.

This assignment is one execution shard. Do not coordinate other agents, install
dependencies, repair the environment, review unrelated portals, promote
findings, create a branch or pull request, or merge changes. The orchestrator
owns those stages.

Before capture, run the required recipe-gated target gate. Owner startup only
reports `lifecycleStatus: owner-ready` and `authenticationStatus: unverified`;
only preflight determines whether authentication is confirmed or blocked. If
the feature target is absent, the checked-in recipe may authorize one exact
same-portal bootstrap-target GET alignment, bounded same-ID navigation
readiness, and then strict preflight on the same target ID. Readiness must
reach the checked-in entry URL or fail closed; it is not an arbitrary wait:

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
Do not submit forms, invoke writes, follow redirects, export secrets, or copy
cookies, bearer tokens, or tenant data into chat. Landing supported findings is
a separate human-reviewed specification PR.

Return the exact compact completion structure from the runbook. Distinguish
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
`discovery-run.json` and run only the documented `analyze` recovery against a
completed capture. Never rerun capture into the same directory.
```
