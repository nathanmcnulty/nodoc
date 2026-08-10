# Portal discovery agent prompt

Workers receive one schema-versioned assignment from the offline controller. The
worker must return the assignment ID and digest, assignment type, terminal status,
decision, reason codes, blockers, metrics, exact candidate/evidence accounting,
and one recommended next action. The controller is authoritative: unknown IDs,
digest mismatches, incomplete accounting, illegal transitions, or capability
violations fail closed. Human prose is diagnostic only and must not be used to
change the ledger or specifications.

Process-improvement assignments/results may classify known deterministic reason
codes and prepare evidence-linked proposals only; Luna or an operator must
authorize safety, scope, threshold, and model-disagreement conclusions.

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
same-portal bootstrap-target GET alignment and then strict preflight on the
same target ID:

  npm run discover:portal -- --portal <portal-spec-id> --profile bounded --phase all --artifacts <fresh-artifact-directory>

The orchestrator runs this gate before ledger dispatch. If it fails, stop and
report `browser-cdp-preflight-failed`; keep the owner alive when manual sign-in
or page repair could fix the target. Do not launch, close, click, write, create,
or replace a browser target, and never invent a URL.

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

If command execution finishes but you cannot return a normal response, leave
the artifact directory unchanged. The orchestrator may inspect
`discovery-run.json` and run only the documented `analyze` recovery against a
completed capture. Never rerun capture into the same directory.
```
