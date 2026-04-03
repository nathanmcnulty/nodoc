# Agent Discovery Playbook

This is a living guide for researching undocumented portal APIs in a way that is repeatable, safe, and useful to future agents.

The goal is to turn real portal behavior into high-quality specs and generated artifacts while preserving tenant safety and recording what did and did not work.

## Outcomes to aim for

- Confirmed API paths from live portal traffic
- Better request and response shapes from capture data and bundle analysis
- Clearly labeled bundle-discovered surfaces that were not fully exercised
- Checked-in specs, regenerated Postman collections, and metadata updates
- A clean diff with scratch artifacts kept outside the repository

## Core principles

1. **Traffic first.** Start with real browser traffic before relying on bundle mining.
2. **Use the signed-in browser session.** Reuse the real Edge profile whenever possible so portal-only auth and context are preserved.
3. **Prefer safe reads.** GETs first, then safe POST-backed reads, then intercepted write-shape capture, then reversible writes only if necessary.
4. **Keep evidence.** Record whether an endpoint is confirmed by live traffic, safe probe, or bundle discovery.
5. **Separate confidence levels.** Do not present bundle-only discoveries as if they were fully confirmed.
6. **Scratch stays out of repo.** Scripts, network logs, bundle downloads, screenshots, and raw notes belong in workspace artifacts, not in the repository.

## Recommended workflow

### 1. Review the current repo baseline

- Inspect the existing spec family, README coverage table, `src/data/siteData.ts`, and Postman generation script.
- Identify the current file layout so new endpoints land in coherent sibling YAML files.
- Run the repo validation commands early to understand the baseline:
  - `npm run generate:postman`
  - `npm run typecheck`
  - `npm run build`

### 2. Attach to the authenticated browser

Preferred flow:

1. Use the real signed-in Edge profile.
2. Attach automation over CDP, usually on `http://127.0.0.1:9222`.
3. If multiple profiles exist, verify the active one is the current signed-in work profile before doing anything else.

Practical notes:

- Prefer `playwright-core` plus `chromium.connectOverCDP(...)`.
- Do **not** close the user’s browser when the script ends; close only the page you opened and disconnect by exiting the script.
- If direct inline one-liners get messy, move the logic into a scratch `.mjs` file in the artifacts directory.

### 3. Inventory the navigation surface

- Start from the current portal section and enumerate navigation items before trying to infer endpoints.
- Prefer stable automation attributes over dynamic container IDs.
- Record:
  - page title
  - URL
  - menu item text
  - `data-id`
  - `data-automation-id`
  - href

Rule of thumb:

- Treat IDs like `nav-762` as runtime details.
- Prefer selectors like `a[data-automation-id^="scc-nav-exposure-"]` over hard-coded `div#nav-*`.

### 4. Capture live traffic page-by-page

- Visit each navigation item deliberately.
- Capture XHR/fetch requests and responses, not just the rendered UI.
- Record for each API:
  - method
  - full URL
  - normalized path
  - query samples
  - request body samples
  - response content type
  - response body sample
  - page(s) where it was seen

Recommended pattern:

- Capture page states and API records separately.
- Write artifacts after each crawl phase instead of only at the very end.
- Keep the browser capture script focused on traffic collection; do bundle download in a separate step.

### 5. Download and mine the loaded JavaScript

- Save the script URLs loaded by the visited pages.
- Download the bundle corpus to the artifacts directory.
- Search bundles for:
  - concrete API paths
  - alternate hosts or proxy prefixes
  - query parameter names
  - request body field names
  - enum values
  - write method names
  - feature gates
  - page-specific request factories

What to extract:

- sibling endpoints under the same feature area
- path templates with `{id}` style placeholders
- pagination/sorting/filter parameter names
- likely write surfaces that need careful handling

### 6. Promote discoveries carefully

Confidence ladder:

1. **Confirmed traffic**: observed in live portal traffic
2. **Safe probe**: recovered from bundles and exercised with a safe read
3. **Bundle discovery**: present in code with strong evidence, but not fully exercised

Bundle-only endpoints should say so directly in descriptions.

If a safe probe returns a contextual error like a portal-side `500` without page-specific parameters:

- record that result
- keep the endpoint labeled as bundle-discovered or partially confirmed
- do not overstate supportability

### 7. Capture write shapes without persisting changes

Default policy:

- Treat every `POST`, `PUT`, `PATCH`, and `DELETE` as a real write unless proven otherwise.

Preferred write-shape workflow:

1. Open the real UI flow that would issue the write.
2. Intercept the request with Playwright/CDP routing or equivalent.
3. Capture the request path, headers, and body.
4. Abort the request before it reaches the backend if the UI allows that safely.

Only if interception is insufficient:

1. Use a reversible lab-safe value.
2. Record the original value.
3. Apply the change.
4. Confirm the request shape.
5. Revert immediately.

Do **not** use shared shell, webshell, or similarly broad-impact flows unless they are clearly portal-specific and safely isolated.

### 8. Author specs with evidence labels

- Put endpoints in the sibling YAML file that matches the user-visible surface, not just the backend prefix.
- Reuse existing schema components where possible.
- When a shape is only partially known, say so explicitly with descriptions like:
  - `Exact schema pending.`
  - `Bundle-discovered endpoint; direct probing returned a contextual 500 without page-specific parameters.`

For each added endpoint, preserve:

- why the endpoint exists
- what page or workflow uses it
- whether it was live-captured, probed, or bundle-discovered

### 9. Regenerate artifacts and validate

After spec changes:

1. `npm run generate:postman`
2. `npm run typecheck`
3. `npm run build`

Before finishing:

- remove unrelated generated churn
- make sure checked-in Postman collections were not hand-edited
- update README/site metadata counts if the operation count changed

## Data model for research artifacts

For scratch JSON files, capture at least:

```json
{
  "method": "GET",
  "url": "https://security.microsoft.com/apiproxy/mtp/posture/oversight/metrics?...",
  "path": "/apiproxy/mtp/posture/oversight/metrics",
  "querySamples": ["?..."],
  "requestBodySamples": [],
  "responseBodySample": "{...}",
  "seenOnPages": ["exposure-overview"],
  "confidence": "confirmed-traffic"
}
```

Useful companion artifacts:

- `page-states.json`
- `api-records.json`
- `script-urls.json`
- `bundle-downloads.json`
- `probe-results.json`
- per-feature analysis notes

## Process patterns that worked well

### Effective

- Attaching Playwright to the already-authenticated Edge session over CDP
- Splitting the workflow into:
  1. page crawl
  2. bundle download
  3. bundle analysis
  4. safe probing
- Using a general-purpose analysis pass over downloaded bundles to map endpoints to feature files
- Comparing captured paths against the current OpenAPI entrypoint before editing specs

### Less effective

- Hard-coding runtime navigation container IDs
- Combining page crawl, response-body harvesting, and bundle downloading into one long script
- Treating bundle-only routes as ready for full spec modeling without either traffic or safe probe evidence

## Experiment log

### 2026-04-03 — Defender Exposure Management

What worked:

- CDP attach to the signed-in Edge Work profile preserved tenant auth.
- Navigation discovery worked reliably via `data-automation-id` selectors.
- Live crawl of Exposure pages produced confirmed missing endpoints and query/body samples.
- Downloading the bundle list separately from the page crawl avoided capture deadlocks.

What changed during execution:

- The runtime nav container was not the originally targeted `nav-762`; it resolved to a different `nav-*` ID in-session.
- Safe GET probes against many bundle-discovered endpoints returned contextual `500` responses, which is still useful evidence that those routes likely require page-specific parameters or state.

Current takeaways:

- Dynamic selector strategy should be the default.
- Probe failures should be recorded, not discarded.
- Splitting long-running research scripts into smaller single-purpose scripts makes debugging much easier.

### 2026-04-03 — Bundle diffing by page

Idea:

- Compare the loaded script sets between navigation items to identify feature-specific bundles before mining all JavaScript equally.

What was tried:

- Diffed `pageScriptUrls` between the four captured Exposure pages.

What helped:

- `exposure-overview` surfaced unique feature bundles like `xspm-asm/.../graph.js`, `msec-identities/.../main.js`, and `wicd-detection/.../device-page.js`.
- `exposure-secure-scores` isolated the `wicd-secure-score/.../main.js` family immediately.
- `exposure-recommendations` only introduced a small delta (`wicd-tvm/.../threat.js`), which is a useful prioritization hint.
- `exposure-initiatives` had no unique bundles relative to the other captured pages, suggesting it reuses already-loaded posture code.

Current takeaway:

- Bundle-set diffing is worth doing early because it quickly separates page-specific feature chunks from generic shell noise.

### 2026-04-03 — Full Defender left-nav bounded crawl

Idea:

- Use a bounded multi-tab crawl to traverse the entire Defender left navigation instead of working one submenu at a time.

What was tried:

- Inspected the live nav DOM from the signed-in Defender session.
- Found **87** `scc-nav-*` anchor elements already present in the DOM, even though only a small subset was visibly expanded.
- Crawled the same-origin internal nav targets with **3 parallel tabs** while keeping request attribution page-scoped.

Results:

- **86/86** same-origin internal nav items traversed successfully
- **1** item skipped intentionally: `Exchange message trace` because it links to `admin.exchange.microsoft.com`
- **248** same-origin XHR/fetch API records captured
- **692** script URLs captured
- **0** page failures
- **0** request failures

What helped:

- Hidden nav anchors already existed in the DOM, so explicit group expansion was not required for traversal.
- Bounded parallelism was fast without losing page attribution because each worker tab maintained its own request labeling.
- Same-origin scoping prevented the crawl from drifting into adjacent admin portals that happen to be linked from Defender.

Current takeaway:

- For full Defender navigation coverage, a **bounded worker pool (3 tabs was effective here)** is better than a purely sequential crawl.
- Enumerating `scc-nav-*` anchors from the DOM is more reliable than trying to model the visible expand/collapse state of the left nav.

### 2026-04-03 — Deep-link entity page phase

Idea:

- After a left-nav crawl, follow up with a separate pass over high-value entity/detail pages that are not reachable from the nav inventory alone.

What was tried:

- Safely loaded deep-link GET pages for:
  - `threatpolicy`
  - `machines/v2/{id}/overview`
  - `user?...`
  - `file/{sha256}/overview`
  - `url/overview?url=...`
  - `ip/{address}/overview`

Results:

- All 6 target pages loaded successfully in the signed-in tenant.
- They exposed materially different API surfaces from the left-nav crawl:
  - Device page: **36** same-origin API paths
  - User page: **30**
  - File page: **28**
  - URL page: **27**
  - IP page: **21**
  - Threat policies page: **12**

What helped:

- Entity/detail pages surfaced page-specific APIs that do not naturally appear in a nav-only crawl.
- The device, user, file, URL, and IP pages were especially rich and are strong candidates for a dedicated entity-page discovery pass.

Current takeaway:

- Treat **entity/detail pages as a distinct discovery phase** after nav traversal.
- A “full Defender crawl” is not complete if it only covers left-nav routes; deep links can reveal high-value entity APIs, live-response helpers, threat-intel endpoints, and page-specific POST-backed read actions.

## Ideas backlog

Add new ideas here before trying them, then move the result into the experiment log.

- Build a reusable artifact schema and helper script that tags each endpoint as `confirmed`, `probed`, or `bundle-discovered`.
- Extract request factory defaults from bundles so probes can include the same query params the UI would send.
- Capture write payloads by intercepting save requests and returning a synthetic client-safe response after aborting the backend call.
- Diff the script set between navigation items to identify the most relevant bundles for each page.
- Record a feature-to-bundle index so future runs can skip generic shell bundles and focus on feature chunks first.
- Add a repeatable checklist for page-specific state, such as selected tab, filters, and tenant scope, before probing.

## PR-ready checklist

- Specs updated with clear evidence labels
- New endpoints placed in coherent sibling files
- Checked-in Postman collections regenerated
- README/site metadata updated when counts or highlights changed
- Validation commands completed
- Unrelated churn removed
- Follow-up opportunities recorded, especially risky writes, hidden hosts, and feature-gated surfaces
