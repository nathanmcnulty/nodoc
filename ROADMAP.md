# Roadmap: monthly portal documentation

nodoc documents what Microsoft admin portals actually call so people can build
CLIs, browser extensions and applications on top of those internal APIs. The
goal is a monthly cycle, runnable by a lower-cost model under review, that maps
each portal, revalidates known operations, discovers new ones and records as
much of each contract as the evidence supports.

This roadmap extends the existing refresh controller instead of adding another
crawler. One capture can answer three separate questions: was a known operation
observed, can its documented contract be improved, and does an unfamiliar
request belong in a specification? Count the capture once and report those
outcomes separately. A blocked or no-change cycle is still a useful result.

## Principles

- **Observed, documented and complete are different claims.** Freshness, latest
  health, schema gaps and example gaps are reported independently. An
  unobserved operation or an HTTP 404 never establishes removal.
- **Never fill an unknown with zero.** Missing measurements stay `null` or
  `unknown` all the way to the website.
- **Public artifacts are allowlisted aggregates.** Raw captures, tenant data,
  routes from private runs and cost data stay private.
- **Lower-cost workers get bounded packets, and independent review stays.**
  Cheaper execution must be measured against real outputs, not fixture answers.
- **Schedules are a separate decision.** Nothing in this roadmap enables a
  recurring run on its own.

## Baseline

At the [November 6 assessment](REFRESH_STATUS.md), 245 of 2,027 modeled
operations across 22 specifications were observed within the 30-day window,
1,782 were not observed, 12 had an error as their latest observation and 184
had a complete response body verified. Summed per specification, 1,764
operations had an authored schema gap and 1,707 an example gap; those sets
overlap. The reconciled snapshot is
[`src/data/coverageSnapshots/2026-11-06.json`](src/data/coverageSnapshots/2026-11-06.json)
and is published on the site's [coverage page](https://nodoc.nathanmcnulty.com/coverage).

## Stages

| # | Stage | Acceptance criterion | Status |
| --- | --- | --- | --- |
| 1 | **Recover the drafts.** Reconcile each open draft with current main, its checks and its review threads. Recover source and private evidence independently. | A keep, split or supersede recommendation tied to the exact head. No historical receipt is reconstructed. | Done for #223 and #225; see [Draft recovery](#draft-recovery). |
| 2 | **Define the portfolio.** Extend the portfolio, coverage ledger and frontier to include unpublished portals, native workflows, UI states and distinct API owners. Record role, license and feature limits as observed or unknown. | Every in-scope portal has a spec/recipe mapping or an explicit gap. Unassessed or unavailable never counts as complete. | Mapping delivered in [#239](https://github.com/nathanmcnulty/nodoc/pull/239): 16 partial surfaces cover all 22 specifications, and 10 surfaces without a specification are explicit `unassessed` gaps. Workflows are unassessed leads and every role, license and feature limit is `unknown`; both enter the report-only frontier. Assessing them needs signed-in sessions. |
| 3 | **Measure lower-cost review.** Reuse exact inputs and cached analyses; give the worker a bounded evidence packet only where judgment is needed. Separate fixture self-checks from real worker answers. | Identical inputs produce identical plans. A missing answer cannot pass a measured benchmark. Report accepted operations and enrichments, review time, rejections and actual usage; unavailable cost stays unknown. | Two offline Luna pilots (M365 Admin contract and Graph flighting historical evidence) are recorded in [#245](https://github.com/nathanmcnulty/nodoc/pull/245), not live tenant cycles. Recovered historical model-level usage was reconciled privately; per-worker costs and USD remain unknown. [#241](https://github.com/nathanmcnulty/nodoc/pull/241) blocks failed/missing benchmark answers; [#246](https://github.com/nathanmcnulty/nodoc/pull/246) preserves current-run private accounting before accepting a review, including rejected answers. Cost per accepted change still needs a live capture cycle. |
| 4 | **Make contracts usable.** Start from a real client workflow. Document observed parameters, body variants, auth context, status and media types, errors, pagination, concurrency and asynchronous steps. | A developer can implement a representative read-only task from the published contract and synthetic examples. Unobserved variants stay explicit. | Offline acceptance delivered in [#242](https://github.com/nathanmcnulty/nodoc/pull/242): a GET-only Defender incident client built from the published contract and synthetic examples, with unobserved behavior reported as `unknown`. Live acceptance against a signed-in tenant is pending. |
| 5 | **Make the site useful to people and tools.** Show dated coverage next to authored quality, then add cross-portal operation search, stable operation links, machine-readable context and versioned bundled OpenAPI downloads. | Readers can find an operation by task and see what is documented versus observed. Building the site never renews observation dates. | Delivered: the coverage page, then [#243](https://github.com/nathanmcnulty/nodoc/pull/243) added the operation index, deep links, bundled OpenAPI downloads, `operations.json` and `llms.txt`. Each download is listed with its spec version and SHA-256; earlier versions are in git history rather than archived on the site. |
| 6 | **Qualify recurrence.** Pilot on separately authorized representative surfaces. Exercise a lost runner, unavailable auth, rate limiting, an exhausted budget and interrupted output. Test restoration from access-controlled backups. | Two cycles finish with a reviewed change, no-change result or blocker per item. Recovery does not duplicate work. | Recovery software is implemented: a containerized adapter to the existing capture driver, verified private Blob archives/restore, phase-boundary checkpoints and a separately approved coverage publisher. Synthetic recurrence/failure tests are not live acceptance. Two authorized live cycles, browser hosting and M6 remain blocked on owner prerequisites. |

## Delivered

- **Public coverage snapshots.** `tools/public-coverage.mjs` projects a private
  `inventory.json` or `refresh-report.json` into an allowlisted, reconciled
  snapshot. It rejects unknown fields, unknown specification IDs, count
  mismatches and missing measures. See
  [Publishing public coverage](REFRESH_WORKFLOW.md#publishing-public-coverage).
- **Coverage page.** `/coverage` shows the latest snapshot per specification,
  with observation measures from the snapshot and gap measures recomputed from
  current source, so later improvements are visible without renewing dates.
  In the November build, the Viva Engage row shows all 5 operations observed
  (100%) alongside 5 schema gaps and 1 example gap. Observation alone is not a
  completeness score.
- **Measured benchmark mode.** `npm run benchmark:portal-discovery -- --measured --inputs <file>`
  scores only supplied worker outputs. See the
  [runbook](AGENT_DISCOVERY_RUNBOOK.md).
- **Portfolio map.** `npm run show:portal-surfaces` maps every in-scope surface
  to its specifications, API servers, recipes and referenced approvals, or
  records an explicit gap. Referenced approvals are not a claim that they are
  current.
- **Benchmark regressions in the frontier.** Every non-passing scenario,
  including a missing measured answer, becomes a blocked frontier item. The
  controller still blocks on any failure.
- **Offline client acceptance.** [`tools/clients/defender-incident-readonly/`](tools/clients/defender-incident-readonly/README.md)
  fetches an incident and its alerts from a loopback mock using only the
  published contract. Synthetic replay is not observation evidence.
- **Developer surface.** [`/operations`](https://nodoc.nathanmcnulty.com/operations)
  searches all 2,027 operations and links to their Scalar sections. The
  [OpenAPI catalog](https://nodoc.nathanmcnulty.com/openapi/index.json),
  `operations.json` and `llms.txt` give tools bundled specs with digests. The
  navbar groups the APIs by portal.
- **Azure capture host template.** [`infra/azure-capture`](infra/azure-capture/README.md)
  defines a manual Container Apps Job, private blob storage, Key Vault and a
  scoped identity. The buildable runtime, private uploader/restore path and
  reviewed coverage publisher are now implemented. It is not deployed; the
  authenticated Chromium session is not provisioned and storage is
  authenticated but not network isolated.

## Monthly cycle

Each step reuses existing tooling. Steps marked *owner* need a person.

1. *Owner:* open authenticated portal sessions for the planned recipes.
2. `npm run control:portal-discovery -- compile-plan --summary --json` to plan,
   then capture per the [runbook](AGENT_DISCOVERY_RUNBOOK.md).
3. `npm run refresh:portfolio -- <private-config>` to inventory freshness and
   reuse retained evidence; see the [refresh workflow](REFRESH_WORKFLOW.md).
4. Worker model: review bounded packets and draft focused proposals. Score the
   worker with the measured benchmark before trusting a new model.
5. Independent review, then *owner* approval of proposals and the refresh report.
6. `npm run project:coverage -- --input <private inventory.json> --base-revision <sha>`,
   commit the new snapshot and update `REFRESH_STATUS.md`.

### VM-independent monthly scheduling

The local automation proposal is superseded by the
[VM-independent runner and cloud design](MONTHLY_AUTOMATION.md).
GitHub Actions can run public-source triage manually without a personal VM,
or on the first of the month at 18:17 UTC once enabled. It can push a reviewed
report candidate to a monthly branch, never directly to main. Optional Luna
selection needs a dedicated credential and private accounting storage; the
deterministic mode requires neither. It does not sign in, call portals or
renew observation dates.

The one-off [public-only run 45745032203](https://github.com/nathanmcnulty/nodoc/actions/runs/45745032203)
successfully prepared a deterministic report and pushed its monthly review
branch. This is an offline operational acceptance, not schedule activation,
model accounting acceptance or a real tenant cycle. The
[#246 accounting fix](https://github.com/nathanmcnulty/nodoc/pull/246) retains
bounded private receipts after failed/rejected reviews and gates public
publication on successful review and private upload. Scheduled activation
and two real tenant cycles remain pending; the private capture stage is separate.

Keep fresh observations separate from this reporting job. An operator can
provide a separately reviewed, sanitized assessment; preserve its actual
date and window. Missing evidence or expired approvals are blockers, not
synthetic observations. In particular, sign-in cannot renew a recipe approval.

Each run should return the per-portal outcomes, reviewed proposals, coverage
counts and private usage accounting. Preserve actual worker identities, token
or credit measurements and their provenance. App billing multipliers are not
USD; dollar costs remain unknown unless authoritative pricing/accounting is
available. Raw captures and tenant data are never committed or published.
Proposals and public snapshots still require review; scheduling does not
authorize automatic merging, new portal mutations or expanded access.

No local schedule was saved. The CI schedule is disabled by its repository
variable until activation is approved. Azure Container Apps Jobs with Chromium
are the preferred future private capture host; Kitesurf needs compatibility
qualification before use with persistent authenticated portal sessions.

## Draft recovery

Initial assessment was against `origin/main` at `4b298c5` (#232); recovery status
was updated on November 25, 2026.

- **[#223, Scalar route data](https://github.com/nathanmcnulty/nodoc/pull/223)** (`perf/scalar-route-data`). Moves Scalar
  configuration into per-route data modules with a recoverable error boundary.
  It was behind main and had an open CodeQL alert about interpolating metadata
  into generated JavaScript. Updated to current main with the metadata emitted
  as data instead of code. The owner authorized merging after review and
  verification. Reviewed head `505eeb5` passed its checks, the CodeQL thread was
  resolved, and it merged as `67d5b2c` on November 25. It trades a smaller transfer
  for slower first navigation from the home page to large specifications; the
  historical measurements remain in the PR rather than claiming universal
  latency improvement.
- **[#225, evidence and behavioral contracts](https://github.com/nathanmcnulty/nodoc/pull/225#issuecomment-7175123670)**
  (`f145adb`) was recovered into native stack 238, merged November 25:
  1. [#235](https://github.com/nathanmcnulty/nodoc/pull/235) recovers the
     operation contract and behavior modules, automation evidence ledger,
     inventory integration and offline tests. It targets `main`.
  2. [#236](https://github.com/nathanmcnulty/nodoc/pull/236) adds recorder
     redaction and binds Postman examples to the matching operation and
     origin. Regenerating Exchange and SharePoint from current public specs
     produced no tracked changes. Live recorder acceptance (M6) remains open.
  3. [#237](https://github.com/nathanmcnulty/nodoc/pull/237) compares supplied
     observations against documented contracts, binds reviews to their evidence
     and produces recommendations without writing specs. It does not change
     live CDP body retrieval. Its implementation plan records the deferred work.

  All 32 original paths are accounted for: 29 appear in the replacement diff,
  two generated collections were unchanged, and one test file for the deferred
  capture helpers was deliberately not imported. The roadmap branch was
  reconciled with the merged stack, preserving evidence tests, public coverage
  generation/validation and measured-mode scoring.
  The superseded draft was then closed without merging duplicate code; its
  source branch remains available for the documented deferred capture work.

## Next increments

The remaining live acceptance steps need signed-in sessions or owner decisions;
the capture/transfer/publication software can be exercised offline.

1. Qualify a cloud-hosted private capture exercise. Deploy `infra/azure-capture`
   only after approval, publish the reviewed capture image and qualify its
   authenticated browser connection and private storage permissions. Exercise
   the implemented uploader, interrupted-run handling, restore and publisher
   with real approved evidence. Manual recorder acceptance (M6) stays separate
   from the synthetic software tests.
2. Run the Defender incident client against a signed-in tenant and record the
   observed auth, status and media types, errors and pagination as typed
   evidence.
3. Assess the 10 unassessed surfaces and the listed workflows from live
   sessions. Mark a role, license or feature limit observed only with an
   evidence reference.
4. Measure Luna's cost per accepted change on a live capture cycle, scored
   with the measured benchmark. The first live authenticated M365 Admin
   known-operation refresh qualified on November 26 under a renewed owner
   approval: the target operation was observed with a complete 200 response,
   health was `healthy-observed`, and the passive capture queued 86 candidates
   (71 documented, 15 undocumented) privately. The publication resolves those
   15 entries into 10 relevant operations: four product URLs become one
   parameterized billing route, and two support-log routes remain excluded
   telemetry. Four operations have complete response-sidecar schemas, including
   the observed billing 404; both POSTs have observed request structures. Six
   support operations publish transport/query evidence with explicit response
   schema gaps because their retained bodies were incomplete. This does not
   renew portfolio coverage or measure Luna cost per accepted change. The run also fixed two
   runtime defects: frozen (sleeping) reused tabs and same-URL first actions
   being attributed to the seed navigation.
5. Extend the offline pilot only with evidence that can answer an open
   contract question. For M365 Admin, the first pilot found that the public
   `DarkModePreference` schema describes `IsDarkModeOn` as a boolean. The
   synthetic example does not establish requiredness or minimum roles. No spec
   change was justified, no endpoint was reverified, and the November 6 count
   remains 48 of 320 for its original window.

## Owner decisions and remaining prerequisites

- Real-data Luna runs and cost recording were approved on November 25.
- #223 was authorized and merged after review; splitting #225 was approved.
- The owner can sign in when a specific capture needs an authenticated session.
  Sign-in alone does not repair missing or expired capture approvals.
- The monthly runner now uses GitHub Actions rather than the retiring VM.
  The first-of-month 18:17 UTC schedule was enabled on November 26 with
  `NODOC_MONTHLY_REVIEWER=none`; it publishes deterministic public-source review
  branches, not live capture or automatic merges. Optional AI credentials and
  private storage remain owner-controlled.
- Still needed from the owner:
  - a tenant choice and a sign-in/MFA session for each live capture;
  - renewed recipe approvals where they have expired (M365 Admin renewed
    through December 3, 2026);
  - an Azure subscription, resource group, region, budget and network
    decision before anything in `infra/azure-capture` is deployed;
  - the `NODOC_COPILOT_TOKEN` secret and private accounting storage before
    switching the already-enabled schedule to optional Luna review;
  - confirming the receiver-side SHA-256 of the November 25 pilot evidence
    archive sent to paseo.
