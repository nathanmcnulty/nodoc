# Portal discovery agent prompt

Copy this prompt into a new agent session after the operator has started and
authenticated the dedicated CDP browser described in
`AGENT_DISCOVERY_RUNBOOK.md`.

```text
Perform bounded API discovery for the M365 Admin portal (`m365-admin`).

First read `AGENT_DISCOVERY_RUNBOOK.md` in this repository and follow it
exactly. It is the execution contract. Do not use the deeper
`AGENT_DISCOVERY_PLAYBOOK.md` unless the runbook says a blocker needs it.

Before capture, verify that the operator-provided authenticated browser is
reachable at http://127.0.0.1:9222/json/version and that the response contains
webSocketDebuggerUrl. If it is unavailable, stop and report
`browser-cdp-unavailable`; do not launch, close, or replace a browser and do not
invent alternate Playwright/CDP automation.

Run the deterministic interface:

  npm run discover:portal -- --portal m365-admin --profile bounded --phase plan --json

Then create a unique artifact directory outside the repository and run:

  npm run discover:portal -- --portal m365-admin --profile bounded --phase all --artifacts <fresh-artifact-directory>

Read the primary output files named by the runbook. Do not edit specifications
or repository files, submit forms, invoke writes, follow redirects, export
secrets, or copy cookies, bearer tokens, or tenant data into chat.

Return the exact compact completion structure from the runbook. Distinguish
confirmed, probed, and bundle-discovered evidence. If the driver emits a
blocker, report its code and remediation rather than improvising around it.
```
