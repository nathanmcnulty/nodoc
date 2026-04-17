# Agent Discovery Playbook

This is a living guide for researching undocumented portal APIs in a way that is repeatable, safe, and useful to future agents.

The goal is to turn real portal behavior into high-quality specs and generated artifacts while preserving tenant safety and recording what did and did not work.

## Outcomes to aim for

- Confirmed API paths from live portal traffic
- Better request and response shapes from capture data and bundle analysis
- Clearly labeled bundle-discovered surfaces that were not fully exercised
- Checked-in specs, regenerated Postman collections, and metadata updates
- A clean diff with scratch artifacts kept outside the repository

## Publishing standards for specs and site quality

When promoting discoveries into the repository, aim for more than just path coverage:

- Keep root spec metadata complete: `info.contact`, `info.license`, `servers[].description`, and `externalDocs`.
- Organize navigation with meaningful `x-tagGroups`; avoid one-section-per-tag layouts and avoid raw backend hosts as group names.
- Add `x-displayName` when tag identifiers are technical or awkward in Scalar navigation.
- Preserve evidence provenance in descriptions. If something is bundle-only or only safe-probed, say so explicitly instead of overstating confidence.
- Leave placeholders visible only when evidence is genuinely missing; otherwise replace `pending` text with observed request, response, auth, or routing details.
- Regenerate derived artifacts after spec changes so the website, quality data, and Postman collections stay aligned.

## Core principles

1. **Traffic first.** Start with real browser traffic before relying on bundle mining.
2. **Use the signed-in browser session.** Reuse the real Edge profile whenever possible so portal-only auth and context are preserved.
3. **Prefer safe reads.** GETs first, then safe POST-backed reads, then intercepted write-shape capture, then reversible writes only if necessary.
4. **Keep evidence.** Record whether an endpoint is confirmed by live traffic, safe probe, or bundle discovery.
5. **Separate confidence levels.** Do not present bundle-only discoveries as if they were fully confirmed.
6. **Scratch stays out of repo.** Scripts, network logs, bundle downloads, screenshots, and raw notes belong in workspace artifacts, not in the repository.

## Coverage expansion model

Do **not** rely on any single technique to discover the full surface area.

The most effective pattern is a layered pipeline:

1. **Portal traffic crawl**
   - Ground truth for real requests, response shapes, auth requirements, and page context.
2. **DOM and HTML route extraction**
   - Good for nav anchors, hidden menu items, tab links, action links, and page-local routes.
3. **JavaScript bundle mining**
   - Good for hidden endpoints, alternate hosts, route templates, parameter names, enums, and write-capable flows.
4. **Seeded deep-link traversal**
   - Use identifiers captured from traffic to open entity/detail pages directly: device IDs, user IDs, SHA256s, URLs, IPs, case IDs, incident IDs, and similar.
5. **Safe probe queue**
   - Exercise high-confidence read candidates with the authenticated browser context to distinguish live endpoints from dead or parameter-dependent ones.
6. **Intercepted write-shape capture**
   - Observe state-changing flows without persisting changes whenever possible.

### Why not just spider everything blindly?

Blind spidering is useful for **candidate discovery**, but it is not enough on its own:

- many bundle strings are not actually routable without page-specific parameters
- some links point to adjacent products or external hosts
- many useful routes are parameterized and need real IDs from prior traffic
- some POST routes are read-like, but some are true writes
- auth, routing, and tenant context often matter more than the raw path

Treat spidering as a **candidate generator plus prioritization aid**, not as the only validation step.

### Recommended spidering rules

- same-origin first
- GET first
- dedupe by normalized path
- keep a request budget and bounded concurrency
- preserve page attribution
- prefer parameters harvested from observed traffic or bundle defaults over empty probes
- queue entity pages separately from nav pages
- never promote write-capable candidates without concrete evidence

### Classify the portal before choosing the next pass

Before scheduling another browser run, put the target surface into one of these buckets:

1. **Diff-first**
  - Use this when the portal already has a broad nav pass or deep interaction baseline.
  - Compare the current spec against `api-records.json`, `page-states.json`, `probe-results.json`, and bundle candidates before opening the browser again.
2. **Full layered crawl**
  - Use this when the current spec is still small, the portal surface is thin, or only one shallow recipe exists.
  - Start with nav and landing coverage, then move to entity/detail replay, interaction-state deltas, bundle mining, and safe probing.
3. **Tenant-blocked or feature-gated**
  - Use this when the page loads but the backend does not wake, or the current tenant lacks objects, permissions, or feature flags.
  - Focus on recording the blocker state, harvesting same-origin links and child targets, and identifying the exact prerequisites for a later pass.
4. **Write-shape follow-up**
  - Use this when the remaining gaps are mostly save, submit, create, or export-start flows.
  - Capture request shape through interception before deciding whether a reversible live write is justified.

The goal is to avoid treating every portal as if it needs the same kind of crawl.

## Recommended workflow

### 1. Review the current repo baseline

- Inspect the existing spec family, README coverage table, `src/data/siteData.ts`, and Postman generation script.
- Identify the current file layout so new endpoints land in coherent sibling YAML files.
- Run the repo validation commands early to understand the baseline:
  - `npm run generate:site-data`
  - `npm run generate:postman`
  - `npm run typecheck`
  - `npm run build`
- When the shell wrapper is noisy or unreliable on long runs, wrap those commands with a stopwatch and redirect output to an artifacts log so you can distinguish a real hang from delayed streaming.

### 2. Attach to the authenticated browser

Preferred flow:

1. Use the real signed-in Edge profile.
2. Attach automation over CDP, usually on `http://127.0.0.1:9222`.
3. If multiple profiles exist, verify the active one is the current signed-in work profile before doing anything else.

Practical notes:

- Prefer `playwright-core` plus `chromium.connectOverCDP(...)`.
- Best-known flow: start or reuse the signed-in Edge Work profile with `--remote-debugging-port=9222`, then attach over CDP instead of launching an automation-owned browser.
- Avoid cloning the user profile unless CDP attach is impossible; copied profiles can lose auth or drift from the live browser state.
- If you must fall back to a copied profile, make a **fresh copy for each run**. Reusing an older copied profile later in the session redirected back to Microsoft login even though a fresh copy still worked.
- If browser-level `connectOverCDP(...)` starts timing out after the websocket connects, keep the live browser open and fall back to a fresh same-origin tab opened through the CDP HTTP `/json/new?...` endpoint, then drive that page target directly over its `webSocketDebuggerUrl` with raw CDP.
- Prefer the checked-in page-target fallback runner (`npm run capture:deep-crawl -- --portal <name> --url <seed-url> --out <artifact-dir> ...`) before inventing another scratch harness; it already handles child-target attach, SPA/hash fallback, checkpointed artifact writes, scoped request filtering, checked-in recipe loading (`--recipe`), and recipe variables (`--var name=value`).
- Prefer one fresh investigation tab per portal family when using the raw page-target fallback. Stale same-origin tabs can poison browser-level attach or leave you attached to the wrong target.
- Once the page is live, capture at least one real backend request from the target feature family and preserve its auth + portal headers. That header set is often enough to power later safe probes without reopening the UI for every candidate.
- Do **not** close the user’s browser when the script ends; open a fresh page or tab for the investigation, close only that page, and disconnect by exiting the script.
- If you still need a scratch `.mjs` experiment, keep it in the artifacts directory and promote only the pieces that generalize back into the checked-in runner.

### 3. Inventory the navigation surface

- Start from the current portal section and enumerate navigation items before trying to infer endpoints.
- Prefer stable automation attributes over dynamic container IDs.
- Record:
  - page title
  - URL
  - menu item text
  - button text, title, and `aria-label` when the nav is button-driven
  - `data-id`
  - `data-automation-id`
  - href
  - whether an optional expander such as `Show all` was required to reveal deeper items

Rule of thumb:

- Treat IDs like `nav-762` as runtime details.
- Prefer selectors like `a[data-automation-id^="scc-nav-exposure-"]` over hard-coded `div#nav-*`.
- Some admin portals expose left-nav items as buttons with no useful `href`. In those cases, inventory
  the stable button labels first and use exact text/title/ARIA matching rather than fuzzy substring
  matching; otherwise generic labels like "Teams" can accidentally match dashboard copy or unrelated
  shell text.
- Wait for the base nav controls to exist before interacting with optional expanders. If a `Show all`
  button is present, treat it as a secondary reveal step instead of the primary readiness signal.

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
- Write artifacts after each page or interaction checkpoint instead of only at the very end of a crawl phase.
- Keep the browser capture script focused on traffic collection; do bundle download in a separate step.
- For broad portal passes, use bounded parallel tabs only if you can still attribute requests back to the originating page.
- If CDP `Page.navigate` stalls on a same-origin SPA hash route, retry that surface in a fresh single tab and fall back to setting `location.href`; do not assume the route itself is invalid just because the first navigation primitive hung.
- If a page exposes a very large set of safe same-origin detail links, split the work into phases:
  nav/list discovery first, then a direct-link or entity replay pass sourced from the recorded page-state
  artifacts. This is often faster and more reliable than serial row-click replay on the live grid.
- The checked-in runner supports this directly with `--seed-artifacts <artifact-dir>` plus `--action replay-seeded-links=<page-selector>` and optional `--seed-page` / `--seed-link-contains` filters.
- When the first pass already exposed stable entity IDs in request URLs or same-origin page links, prefer `--action replay-seeded-routes=<group-name>` from a checked-in recipe so detail pages can be revisited without rebuilding the click flow by hand.
- For same-origin admin portals, left-nav coverage is only the floor: open every reachable same-origin route, drill into visible list rows/items so detail blades load, click every visible read-only tab or pivot, and follow safe same-origin content links.
- Canonicalize equivalent routes before queueing them. Portals often expose the same surface through aliases or parallel route trees, and unnormalized queue keys will waste time replaying the same detail page.
- When a list/detail family fans out into many nearly identical row routes, fully exercise one representative detail page first, then treat sibling detail pages as first-paint verification unless they reveal new tabs, links, or request shapes.
- When list/detail drill-ins are button-driven rather than anchor-driven, restore the base page after each visit
  and reacquire the next control by stable label, automation ID, or other deterministic selector instead of
  holding stale DOM handles across navigations.
- For report or dashboard blades, do two passes: initial-load traffic first, then a second pass that changes one safe control at a time.
- During the interaction pass, prefer safe state changes such as filters, date range, grouping, row drill-ins, tabs, sort, paging, and export preflight so each new request can be tied back to the triggering UI state.
- Record a page-state checklist alongside each request set: selected tab, filter chips, date range, business group or release selection, tenant scope, and any report-mode toggles.
- If a report blade uses virtualization, shadow DOM, or a delayed/hidden grid, do not block on the DOM becoming rich. Traffic is the primary evidence; DOM and accessibility snapshots are still useful for control attribution and UI-state labeling.
- If you need to resume a long crawl, seed from previously visited routes plus crawl-phase page states rather than every interaction snapshot; replaying interaction-state links can explode the queue with duplicate detail routes.
- Some entity and detail blades need materially longer settle windows than nav or landing pages. If a page is still stuck on a generic loading state, extend the settle interval before concluding the route is empty or broken; many device, file, and report-detail pivots do not hydrate on the shorter nav timing budget.

#### Exhaustive portal crawl depth

- A portal crawl is **not complete** when it only visits left-nav or landing routes.
- Treat every list surface as a potential feeder into richer entity/detail APIs:
  - open visible object rows where it is safe to do so
  - if row clicks are unreliable, use IDs captured from traffic to open detail routes directly
  - queue same-origin detail blades separately from nav pages
- On each entity/detail page or blade, click every visible read-only tab or pivot before moving on.
- Prefer safe drill-ins such as display-name links, row detail blades, tabs, paging, filters, and same-origin content links over arbitrary action buttons.
- Record which surfaces could **not** be reached because of missing tenant data, permissions, or feature flags so future agents do not mistake those gaps for completed coverage.
- Keep those unreachable labels conservative: generic shell banners, dark-mode notices, or marketing copy are not strong evidence of a feature gate on their own.

Rule of thumb:

- “Exhaustive discovery” means:
  1. enumerate the nav surface
  2. traverse list pages
  3. open representative object/detail pages
  4. exercise visible tabs and safe pivots on those pages
  5. only then decide which APIs are truly part of the portal-specific surface

### 4a. Add a deliberate second-pass interaction matrix

Many portals expose their most useful reads only after the first page paint. After the initial capture, rerun the same feature family with one safe control change per checkpoint:

- tabs and pivots
- first representative row drill-in
- sort and paging changes
- filter chips, scope selectors, and date ranges
- `Show all`, `View details`, and similar read-only expanders
- export preflight or report-setup steps that stop before a real job is launched

Guidelines:

- Keep the changes isolated so each new request can be attributed to one UI state transition.
- Label every checkpoint clearly in `page-states.json` so the request inventory can be explained later.
- If a route repeats with the same method and path but a materially different query or body, preserve the alternate shape instead of treating it as duplicate noise.

### 4b. Treat iframe and child-target blades as first-class surfaces

Several Microsoft admin portals render the real feature surface inside child targets rather than the top-level shell.

- Open the surface from the root shell first, then target the blade content explicitly with iframe-scoped actions such as `click-label-iframe` or `click-contains-iframe` when the runner supports it.
- Capture page states from both the root page and the child target so shell-only readiness is not mistaken for full feature coverage.
- If a route appears visually loaded but no backend family wakes, inspect the attached child targets before concluding that the portal section is idle.
- When future follow-up depends on stable blade routes, prefer seeded replay from prior artifacts over fragile re-clicking through shell chrome.

### 4c. Turn one successful pass into reusable seeded route groups

Do not stop at ad hoc seeded links when a portal exposes stable detail families.

- Promote repeatable entity/detail patterns into checked-in `seedRouteGroups` with explicit `routeTemplates` and `idSources`.
- Seed values can come from `page-states.json`, `raw-requests.json`, `action-results.json`, or `session-snapshots.json` depending on where the IDs first appeared.
- Sample a few routes per normalized family instead of replaying every discovered object.
- Add per-family quotas so high-volume entities do not crowd out lower-frequency but richer surfaces.

This is the fastest way to turn one broad crawl into a repeatable detail-phase recipe.

### 4d. Capture blocked, empty, and dormant states intentionally

A page that looks blocked or empty can still provide useful evidence.

- Record the blocker message, page URL, visible tabs, visible controls, same-origin links, and script URLs even when no backend API family wakes.
- Preserve empty-array and null-payload responses; they still confirm route existence and response envelope.
- Separate “tenant blocked”, “feature gated”, “empty data”, and “UI loaded but backend quiet” in your notes so later agents know what kind of follow-up is actually needed.
- Use blocker-state captures to identify the missing prerequisite: tenant permission, seed object, license, feature flag, or selected workspace.

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
- route candidates for a later safe-probe queue
- If you have sibling pages in the same feature family, diff their `script-urls.json` sets early so page-specific bundles stand out before you mine generic shell chunks.
- Prioritize unique or near-unique bundles first; these are often where request factories, enum values, hidden sibling routes, and request-body defaults live.

### 5a. Build a candidate queue

After traffic, DOM extraction, and bundle mining, build a queue of follow-up candidates with fields like:

- candidate path or route
- candidate type: nav route, entity page, API endpoint, external host
- evidence source: traffic, DOM, bundle, probe
- required identifiers or parameters
- safe method to test
- feature family
- confidence score

This makes it much easier to prioritize what to crawl next instead of rediscovering the same leads repeatedly.

### 5b. Safe-probe hidden reads

When bundle mining exposes likely read routes that the UI did not call directly:

1. Capture one real request to the same backend family and preserve a sanitized header set:
   - `authorization`
   - `origin`
   - `referer`
   - `accept` / `accept-language`
   - `x-requested-with`
   - relevant `x-ms-*` portal headers
2. Reuse identifiers from live captures instead of inventing them:
   - business group IDs from summary grids
   - release or phase IDs from report summaries
   - tenant-scoped enums already seen in live request/response samples
3. Probe idempotent reads first:
   - summary child routes
   - detail grids
   - distinct-column helpers
   - alternate OData/URS reads
4. Match bundle defaults exactly. Empty strings, `includeHistoricalValue`, plan names, and sort-key maps can matter; a guessed summary sort key produced `422` on a live feature-details route until the bundle default was used.
5. Record the request shape and the outcome for each probe so later spec work can distinguish confirmed routes from stale bundle strings.

### 5c. Diff route families, host families, and recipe coverage together

Before widening a crawl, compare three things side by side:

- the checked-in spec hosts and path prefixes
- the observed hosts and normalized candidate families from the latest artifacts
- the current recipe coverage: root clicks, iframe clicks, seeded links, seeded routes, and second-pass interactions

This helps answer the real question:

- Is the gap caused by missing browser coverage?
- Is the gap caused by weak seeded replay or missing IDs?
- Is the gap caused by an unmodeled host family that should become its own spec?
- Or is the gap already narrow enough to solve directly from existing artifacts?

If the answer is “one unresolved family and one thin recipe”, update the recipe before running another broad crawl.

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

Interpret probe results carefully:

- `200` / `204` with an empty array still confirms that the route exists and gives you the real response envelope.
- `400` / `422` often means the route is live but the body or query shape is wrong; recover the exact defaults from request factories before you discard the endpoint.
- `404` on both the canonical and trailing-slash variants is strong negative evidence that the bundle string is stale or gated away; keep it out of confirmed coverage unless newer evidence appears.

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

Treat export-start routes as writes or job starters even if they look report-like. Capture the export request shape and the follow-up status poller separately, and avoid triggering the export unless you explicitly need the job lifecycle.

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
- If the site route slug should not follow automatic title kebab-casing (for example `m365-admin`
  instead of `m-365-admin`), set `info.x-nodoc-route` in the spec and keep README/site links aligned.

### 9. Regenerate artifacts and validate

After spec changes:

1. `npm run generate:postman`
2. `npm run typecheck`
3. `npm run build`

Before finishing:

- remove unrelated generated churn
- make sure checked-in Postman collections were not hand-edited
- update README/site metadata counts if the operation count changed
- if only one surface changed, use a targeted Postman regeneration pass (for example `NODOC_COLLECTIONS=purview,purview-portal npm run generate:postman`) before the final full validation sweep so unrelated collections stay stable during iteration
- if you added a brand-new portal family, make sure the diff includes both `specifications/nodoc-{portal}/specification/openapi.yml` and `postman/collections/{portal}.collection.json`; new tracked files are easier to miss than modified ones
- in the change summary or PR, call out the scope decision explicitly: which portal-specific same-origin or `/beta` host families were documented, and which shared shell, support, or telemetry traffic was intentionally excluded
- if confirmed endpoints returned empty collections or null payloads in the current tenant, say so directly so reviewers know those routes are still real portal endpoints and not dead captures

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

When the filtered `api-records.json` output appears to miss a route family, cross-check
`page-states.json` before assuming the route is absent. The page-state request inventory
often preserves exact methods and path variants (for example, extra segments like
`/radius/api/radius/identities/...`) even when the normalized API export only captured a
subset of those requests or omitted the body shape.

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

### 2026-04-03 — Multi-layer discovery strategy

Idea:

- Combine DOM extraction, bundle mining, entity-page seeding, and safe probing instead of relying on one crawl type.

What was learned:

- Nav crawling exposed broad portal families.
- Deep-link entity pages exposed richer page-specific APIs that nav crawling missed.
- Bundle mining exposed additional candidate endpoints, but many required page-specific parameters or state.

Current takeaway:

- The best practical strategy is:
  1. crawl nav routes
  2. open seeded entity pages
  3. mine JS bundles
  4. build a candidate queue
  5. safe-probe high-confidence reads
  6. intercept writes to capture shapes

- “Scrape HTML and JS and spider outward” is worth doing, but only as one stage in this larger pipeline.

### 2026-04-03 — Entity pivot extraction

Idea:

- Treat each entity/detail page as a graph node and extract additional safe traversal edges from the page itself.

What was tried:

- On representative Defender entity pages, extracted:
  - visible `role="tab"` items
  - same-origin internal links outside the left nav
  - visible buttons, then classified them heuristically as risky or non-risky

Representative results:

- **Device page**: 7 tabs, 4 internal links
- **User page**: 9 tabs, 1 internal link
- **File page**: 7 tabs, 5 internal links
- **URL page**: 6 tabs, 4 internal links
- **IP page**: 4 tabs, 2 internal links
- **Threat policies**: 0 tabs, 3 internal links

What helped:

- Tabs are the cleanest next traversal edge because they are usually read-only context switches within the same entity surface.
- Internal same-origin links exposed pivots like device inventory, related devices, and other entity pages.

What did not generalize well:

- Raw visible-button extraction was too noisy because it includes shell controls, chrome, and action menus.
- Text-only “risky button” filtering is not enough to decide what is safe to click.

Current takeaway:

- A deeper safe crawler should prioritize:
  1. **entity tabs**
  2. **same-origin internal links in the content area**
  3. **explicit allowlisted “View …” style pivots**

- It should **not** click arbitrary buttons by default.

### 2026-04-03 — Depth-limited entity graph crawl

Idea:

- Start from a small set of confirmed deep-link entities and spider outward by tabs first, then content links, while keeping strict same-origin, depth, and page-count limits.

What was tried:

- Seeded the crawler with:
  - `threatpolicy`
  - `machines/v2/{id}/overview`
  - `user?...`
  - `file/{sha256}/overview`
  - `url/overview?url=...`
  - `ip/{address}/overview`
- Used a same-origin crawler that:
  - visited the default page state
  - clicked visible tabs
  - queued same-origin content links outside the left nav
  - excluded arbitrary button clicks
- Run parameters:
  - `maxDepth: 2`
  - `maxPages: 24`

Results:

- **24** pages visited from **6** seeds before hitting the page cap
- **267** same-origin XHR/fetch API records captured
- **134** discovered same-origin links
- **116** queued-but-unvisited links remained
- **24** request failures, dominated by `net::ERR_ABORTED` on timeline/event requests during tab or page transitions
- **215** method+path pairs were new relative to the earlier left-nav crawl
- Highest-yield visited surfaces were:
  - machine overview/timeline pages: **50+** API records each
  - user page: **49**
  - URL, incident, file, and domain pages: roughly **29-33** each
- Highest-yield newly surfaced families included:
  - `mtp/tvm`: **38**
  - `mtp/cloudPivot`: **22**
  - `mtp/mdeTimelineExperience`: **13**
  - `mtp/ndr`: **12**
  - `radius`: **9**
  - `mdi`: **8**

What helped:

- Tabs remained the safest high-signal traversal edge; they unlocked much richer API activity than simply opening the default entity page.
- Timeline, incident, and entity-detail pivots exposed families that the left-nav crawl missed or only sampled lightly.
- A hard page cap kept the first entity graph run bounded while still producing enough signal to tune the crawler.

What did not generalize well:

- The queue skewed heavily toward more machine pages; **72** queued URLs matched `/machines/{id}`, which reduces surface diversity quickly.
- Shared settings pivots like `securitysettings/defender/alert_suppression` were reachable from multiple entity types and produced repeated capture with limited new value.
- End-of-run-only artifact writes made long crawls hard to monitor while they were still in flight.

Current takeaway:

- Keep the crawler **same-origin** and **tabs-first**, but add **per-route-family quotas** so `/machines/{id}` and `/machines/v2/{id}` do not dominate future runs.
- Demote or denylist shared global settings pivots when the goal is breadth across entity surfaces rather than settings-specific research.
- Treat `net::ERR_ABORTED` timeline fetches during transitions as crawl artifacts, not as evidence that the route family is invalid.
- Add incremental checkpoint writes or progress logging to make long entity crawls observable without stopping them.

### 2026-04-03 — Intune Autopatch report blades

Idea:

- Treat sibling report blades as a paired capture + bundle-diff target so live traffic identifies the real host family first, then a second interaction pass exposes better request shapes.

What was tried:

- Captured authenticated initial loads for:
  - `https://intune.microsoft.com/#view/Microsoft_Intune_Enrollment/ReportingMenu/~/windowsQualityUpdatesReactView`
  - `https://intune.microsoft.com/#view/Microsoft_Intune_Enrollment/ReportingMenu/~/windowsFeatureUpdatesReactView`
- Compared the observed API families to separate blade-specific traffic from generic portal/bootstrap calls.

What helped:

- The quality updates blade primarily used `services.autopatch.microsoft.com` report routes under:
  - `/reporting/reports/v2/deviceAccounting/wqu/summary/businessgroups`
  - `/reporting/reports/v2/deviceAccounting/wqu/summaryMetrics`
  - `/reporting/reports/v2/deviceAccounting/wqu/trending`
- The feature updates blade primarily used:
  - `/reporting/reports/v2/windowsFeatureUpdates/summary/releases`
  - `/reporting/reports/v2/windowsFeatureUpdates/summaryMetrics`
  - `/reporting/reports/v2/windowsFeatureUpdates/trending`
  - `/unified-reporting/odata/1.0/WindowsFeatureUpdatesTrending`
- Generic Graph `deviceManagement` requests and same-origin Intune settings/telemetry calls were mostly shell/bootstrap noise, not the blade-specific feature surface.
- Sibling report blades are good script-diff targets because the shared shell code cancels out quickly and the unique feature chunks become clear mining candidates.
- Initial page load surfaced only baseline summary/trending families; deeper safe interactions are needed to reveal richer POST body shapes, sibling routes, and parameter defaults.
- Safe probes were necessary after bundle mining: they confirmed hidden read routes like `wqu/summary/deploymentgroups`, `windowsFeatureUpdates/completion/releases`, `windowsFeatureUpdates/summary/phases`, details grids, distinct-column helpers, and alternate `WindowsFeatureUpdates*` URS resources.
- Safe probes also filtered out stale bundle strings: `POST /reporting/reports/v2/deviceAccounting/wqu/completion/businessgroups` returned `404` with both slash variants and should not be treated as a confirmed live route without newer evidence.
- Reusing the header set from one live report request was enough to safely confirm several hidden sibling reads without reopening the full UI each time.
- Empty-array probe responses were still useful because they confirmed the real response envelopes for details and distinct-column helpers.
- `POST /reporting/reports/v2/windowsFeatureUpdates/details` returned `422` when probed with a guessed summary sort key; the bundle-default empty `sortKey` and the bundle's field map were accepted.
- Feature update bundles exposed an alternate URS/OData surface behind a feature gate, so both the POST report family and `WindowsFeatureUpdates*` OData reads need to be modeled separately when they appear.

Current takeaway:

- Attach over CDP to the live signed-in Edge Work profile and keep the browser open; use artifact-scoped scratch scripts and raw captures.
- For report blades, capture first paint and then a second pass with one safe interaction at a time: filters, date range changes, grouping, row drill-ins, tab switches, sorting, paging, and export-preflight actions.
- Label every captured request with the exact UI state that triggered it so later safe probes and spec descriptions can explain when each route appears.
- After traffic capture, diff the page-specific script sets between sibling blades and mine only the unique bundles for hidden sibling routes, default query/body fields, enum values, and request-factory defaults.
- Treat bundle-recovered report routes as a probe queue, not as confirmed coverage. Hidden siblings can be real and probeable, but stale strings also exist and need to be pruned with token-backed reads before they reach the spec.
- Before another browser run, diff the normalized captured families against existing specs plus `api-records.json` and `page-states.json` so follow-up crawling only targets unresolved gaps.

Idea:

- Before launching another broad crawl, diff the already-documented routes against the
  confirmed request inventory and only chase the remaining high-confidence families.

What was tried:

- Normalized current documented Defender routes against the captured request inventories by:
  - removing the `/apiproxy` prefix
  - trimming trailing slashes
  - collapsing literal IDs into parameterized route shapes
- Cross-checked both `api-records.json` and `page-states.json` instead of trusting only one artifact.
- Extracted request and response samples only for the remaining route families instead of
  re-reading the entire corpus.

What helped:

- This quickly separated real remaining families from false positives caused by literal IDs
  and already-modeled parameterized routes.
- `page-states.json` caught exact tails that the normalized API export could miss, such as
  trailing-slash variants and smaller helper routes.
- When diffing live captures against checked-in OpenAPI YAML, prefer a real parser or a
  line-based path-key extraction that tolerates quoted YAML keys. Naive regexes can miss
  routes with quoted paths or OData-style parameter syntax.
- Targeted family diffs were enough to close the remaining high-signal gaps for policy
  inventory, AI inventory, unified connectors, SIAM helpers, and ISPM report routes
  without another expensive full crawl.

Current takeaway:

- After a broad nav + entity crawl, do a **normalized family diff** before starting another
  browser run.
- Only launch another crawl when the remaining gaps are still broad or ambiguous; if the
  tail is already concentrated into a few confirmed families, extract exact shapes directly
  from the existing artifacts first.
- If the remaining tail collapses into one large feature family, prefer a focused active
  pass on the implicated pages before relying on passive recorder captures alone. Passive
  gathering is useful for ambient confirmation, but it is weaker for dormant detail routes,
  deliberate row/tab drill-ins, and exact UI-state attribution.

### 2026-04-03 — Purview portal split and generation hygiene

Idea:

- Treat the Purview same-origin portal root separately from the shared proxy layer and tighten the generation loop so validation is easier to trust.

What was tried:

- Captured both `https://purview.microsoft.com/api/*` and `https://purview.microsoft.com/apiproxy/*` traffic during the same signed-in crawl.
- Split the new same-origin `/api/*` endpoints into a dedicated `Purview Portal` spec instead of folding them into the existing proxy-focused Purview spec.
- Benchmarked collection generation with stopwatch-wrapped commands and artifact logs rather than relying on interactive shell streaming alone.
- Updated the Postman generator to support targeted runs and to preserve checked-in collection metadata so unrelated collections do not churn on every regeneration.

What helped:

- Modeling `/api/*` and `/apiproxy/*` as separate surfaces matched the real portal architecture and avoided awkward path-prefix collisions.
- Stopwatch + log-file execution made it obvious that healthy generation was finishing in minutes, while shell wrappers could still look hung or replay stale output.
- Targeted collection generation was faster for iteration and kept random Postman IDs and synthetic examples from dirtying unrelated files.
- Giving sibling specs from the same portal a shared `info.x-nodoc-category` kept the Scalar navbar grouped under one parent instead of creating duplicate top-level entries.

Current takeaway:

- Treat same-origin portal routes and proxy routes as separate spec candidates when both exist in one product.
- For build and generation benchmarking, trust logged elapsed time over interactive shell behavior.
- Prefer targeted regeneration while iterating, then run the full validation set before merging.
- When one portal is split into multiple specs, set the same `x-nodoc-category` on each sibling spec so they stay grouped under a single navbar parent.

## Ideas backlog

Add new ideas here before trying them, then move the result into the experiment log.

- Build a reusable artifact schema and helper script that tags each endpoint as `confirmed`, `probed`, or `bundle-discovered`.
- Extract request factory defaults from bundles so probes can include the same query params the UI would send.
- Capture write payloads by intercepting save requests and returning a synthetic client-safe response after aborting the backend call.
- Diff the script set between navigation items to identify the most relevant bundles for each page.
- Record a feature-to-bundle index so future runs can skip generic shell bundles and focus on feature chunks first.
- Add a repeatable checklist for page-specific state, such as selected tab, filters, and tenant scope, before probing.
- Build a reusable same-origin spider that consumes DOM routes, bundle-derived routes, and entity seeds from prior traffic, then prioritizes them through a safe-probe queue.
- Add per-route-family quotas and sampling so the entity queue does not get overwhelmed by repeated machine-page pivots.
- Add a denylist or lower priority for shared settings routes that are reachable from many entities but rarely add new API families.
- Flush crawl checkpoints incrementally so long browser-based discovery runs can be monitored safely in real time.
- Add a recipe audit that scores each portal on root coverage, iframe coverage, seeded link replay, seeded route replay, and second-pass interaction coverage.
- Add reusable interaction-matrix templates for report blades, list/detail portals, and settings-heavy portals so shallow recipes can be expanded consistently.
- Add a route-family diversity report that highlights when one entity type or path family is dominating the crawl and suppressing breadth.

## PR-ready checklist

- Specs updated with clear evidence labels
- New endpoints placed in coherent sibling files
- New spec and collection files included when a portal was split or added, especially `specifications/nodoc-{portal}/specification/openapi.yml` and `postman/collections/{portal}.collection.json`
- Checked-in Postman collections regenerated
- README/site metadata updated when counts or highlights changed
- If a new or renamed spec should use a cleaner site slug, `info.x-nodoc-route`, homepage links, and README browse links were updated together
- Single-spec nav categories render as direct links rather than one-item dropdowns
- Tenant-specific examples, domains, and email addresses sanitized to neutral placeholders such as `contoso` before merge
- Validation commands completed
- Unrelated churn removed
- PR summary explains the scope decision clearly, including which portal-specific host/path family is documented and which shared shell, support, auth, or telemetry traffic was intentionally excluded
- PR summary calls out confirmed tenant-specific empty or null responses so reviewers do not mistake them for dead endpoints
- Follow-up opportunities recorded, especially risky writes, hidden hosts, feature-gated surfaces, and any largest remaining unmatched families intentionally deferred
