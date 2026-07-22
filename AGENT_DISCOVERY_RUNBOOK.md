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

## Browser prerequisite

The deterministic pipeline attaches to an already authenticated browser. The
agent must not assume that an ordinary Edge process is a CDP endpoint. Before
starting the capture phase, the operator must launch a dedicated Edge profile
with remote debugging enabled, sign in to the portal, and verify the endpoint:

```powershell
$edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
$profileDir = Join-Path $env:TEMP "nodoc-edge-cdp-m365-admin"
Start-Process $edge -ArgumentList @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  "--user-data-dir=$profileDir",
  "--no-first-run",
  "--no-default-browser-check",
  "https://admin.cloud.microsoft"
)
Invoke-RestMethod http://127.0.0.1:9222/json/version
```

The response must include `webSocketDebuggerUrl`. If the endpoint is refused,
the browser was not started with the debugging flag; if it responds but capture
ends at Microsoft sign-in, authenticate that profile and use a new artifact
directory for the retry. Do not close or replace the user's normal browser
profile.

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
   npm run discover:portal -- --portal m365-admin --profile bounded --phase all --artifacts $artifacts
   ```

4. Read only these outputs first:

   - `discovery-run.json`
   - `summary.json`
   - `candidate-handoff.json`
   - `candidate-queue.json`
   - `probe-results.json`
   - `bundle-candidates.json`
   - `stream-records.json`

5. Consult `page-states.json`, `action-results.json`, or raw request artifacts
   only when the primary outputs do not explain a candidate or blocker.

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
