# Portal Discovery Agent Runbook

Use this runbook for execution. Use `AGENT_DISCOVERY_PLAYBOOK.md` only when a
blocker requires deeper background.

## Required input

The task must name one portal by title or spec ID, for example `M365 Admin` or
`m365-admin`. Unless the task says otherwise:

- do not edit OpenAPI specifications
- do not submit forms or invoke writes
- do not export secrets from the browser
- keep artifacts outside the repository
- stop after the checked-in recipe and candidate analysis complete

## Execution

1. Read the machine-generated portal brief:

   ```powershell
   npm run discover:portal -- --portal m365-admin --phase plan --json
   ```

2. Choose a unique, fresh artifact directory outside the repository for every
   execution, including reruns after authentication:

   ```powershell
   $artifacts = Join-Path $env:TEMP ("nodoc-m365-admin-discovery-" + [guid]::NewGuid())
   ```

3. Run the deterministic pipeline:

   ```powershell
   npm run discover:portal -- --portal m365-admin --phase all --artifacts $artifacts
   ```

4. Read only these outputs first:

   - `discovery-run.json`
   - `summary.json`
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
Confirmed candidates:
Successful probes:
Bundle-only candidates:
GraphQL/RPC operations:
Passive streaming endpoints:
Coverage gaps:
Blocker code:
Recommended next pass:
```

Do not claim exhaustive coverage. Completion means the bounded recipe finished,
the candidate queue was generated, and remaining gaps were reported.
