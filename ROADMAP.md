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
| 2 | **Define the portfolio.** Extend the portfolio, coverage ledger and frontier to include unpublished portals, native workflows, UI states and distinct API owners. Record role, license and feature limits as observed or unknown. | Every in-scope portal has a spec/recipe mapping or an explicit gap. Unassessed or unavailable never counts as complete. | Not started. |
| 3 | **Measure lower-cost review.** Reuse exact inputs and cached analyses; give the worker a bounded evidence packet only where judgment is needed. Separate fixture self-checks from real worker answers. | Identical inputs produce identical plans. A missing answer cannot pass a measured benchmark. Report accepted operations and enrichments, review time, rejections and actual usage; unavailable cost stays unknown. | Measured benchmark mode delivered. Real-data Luna trials and usage accounting approved on November 25; first pilot in preparation. |
| 4 | **Make contracts usable.** Start from a real client workflow. Document observed parameters, body variants, auth context, status and media types, errors, pagination, concurrency and asynchronous steps. | A developer can implement a representative read-only task from the published contract and synthetic examples. Unobserved variants stay explicit. | Partly covered by #225's contract and behavior modules, which need to be split out. |
| 5 | **Make the site useful to people and tools.** Show dated coverage next to authored quality, then add cross-portal operation search, stable operation links, machine-readable context and versioned bundled OpenAPI downloads. | Readers can find an operation by task and see what is documented versus observed. Building the site never renews observation dates. | Coverage page delivered. Search, links and downloads are next. |
| 6 | **Qualify recurrence.** Pilot on separately authorized representative surfaces. Exercise a lost runner, unavailable auth, rate limiting, an exhausted budget and interrupted output. Test restoration from access-controlled backups. | Two cycles finish with a reviewed change, no-change result or blocker per item. Recovery does not duplicate work. | Not started; needs signed-in capture sessions. |

## Delivered

- **Public coverage snapshots.** `tools/public-coverage.mjs` projects a private
  `inventory.json` or `refresh-report.json` into an allowlisted, reconciled
  snapshot. It rejects unknown fields, unknown specification IDs, count
  mismatches and missing measures. See
  [Publishing public coverage](REFRESH_WORKFLOW.md#publishing-public-coverage).
- **Coverage page.** `/coverage` shows the latest snapshot per specification,
  with observation measures from the snapshot and gap measures recomputed from
  current source, so later improvements are visible without renewing dates.
- **Measured benchmark mode.** `npm run benchmark:portal-discovery -- --measured --inputs <file>`
  scores only supplied worker outputs. See the
  [runbook](AGENT_DISCOVERY_RUNBOOK.md).

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

### Proposed monthly scheduling

Start with one local Copilot automation, not separate schedules for every
portal. The proposed first job is an **offline documentation review**, on the
first of the month at 09:00 local time. Luna reads the public specifications
and latest published assessment in a fresh worktree and returns up to three
source-cited improvements in a private session report. It does not sign in,
call APIs, publish changes or renew observation dates. The computer and app
must be available; a local schedule does not guarantee catch-up after downtime.

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

The initial local schedule was prepared in the automation review dialog, not
saved or enabled. Saving and enabling it are separate decisions. An always-on
runner would be a different design, with its own availability and retention
requirements.

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
- **#225, evidence and behavioral contracts**
  (`feat/evidence-behavior-contracts-20261030`, `f145adb`). None of its new
  modules are on main. It conflicts in seven files, mostly
  `tools/cdp-deep-capture.mjs`, which #226 and #230 reworked. The owner approved
  splitting it on November 25. Recovery is proceeding in dependency order:
  1. Operation contract and behavior modules plus the automation evidence
     ledger (`operation-contract.mjs`, `operation-behavior.mjs`,
     `generate-automation-evidence-ledger.mjs`). These are new files and feed
     stage 4.
  2. Recorder evidence and export privacy (`tools/nodoc-recorder/*` and its
     tests), including downstream export compatibility. These still need the
     live recorder acceptance listed as M6 in its plan.
  3. CDP capture, crawl-candidate and promotion-planner changes, rebased onto
     the #230 capture pipeline with fresh review, plus remaining review/evidence
     integration and end-to-end tests.
  Preserve the original PR until the replacement layers account for its entire
  source diff; splitting does not establish live acceptance.
  Regenerate Postman collections rather than merging the conflicting JSON. Its
  benchmark change, labeling each result's evidence source, is already covered
  by measured mode using the same `evidenceSource` vocabulary.

## Next increments

1. Split #225 as above, starting with the contract and behavior modules.
2. Cross-portal operation search with stable per-operation links on the site.
   Group the per-specification navbar links first: at 1280 pixels the brand is
   already truncated, which is why Coverage is linked from the home page rather
   than the navbar.
3. Versioned bundled OpenAPI downloads and a machine-readable index for tools.
4. Feed failing benchmark scenarios into the discovery frontier. The frontier
   reads `benchmark.regressions`, which the scorecard does not produce today;
   the controller still blocks on any failure.
5. Offline pilot on M365 Admin (48 of 320 observed in November): pick one
   missing contract supported by retained evidence, or return no change.
6. Website acceptance on Viva Engage, where all five operations were observed
   but all five had schema gaps; the page must convey both.

## Owner decisions and remaining prerequisites

- Real-data Luna runs and cost recording were approved on November 25.
- #223 was authorized and merged after review; splitting #225 was approved.
- The owner can sign in when a specific capture needs an authenticated session.
  Sign-in alone does not repair missing or expired capture approvals.
- The monthly automation's execution host, cadence and enablement remain to be
  confirmed. No recurring schedule or automatic merging is enabled.
