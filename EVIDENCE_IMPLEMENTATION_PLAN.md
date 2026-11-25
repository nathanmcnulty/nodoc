# Offline evidence review integration

## Baseline and intent

This is the final layer of the split from original evidence work based at `e05acb32c439f70f41973f32e3b5886eca8569d1`. The verified integration parent is #236 at `be22ce4b7324cc1c298b6b231b0e86ae1314bc12`; #235 (`b63e4d5a8c261f325177a52cde47ac04568b8114`) supplies the operation contract, behavioral evidence, and ledger foundation. The pinned original source ref is `refs/pr-stack/source/225` at `f145adb1e49d00b97d99c7b110549750a467f3ca`.

The original implementation and review fixes were authored by Nathan McNulty in `5d77dc9bbe05a2196b182430da81b515fc2eafd4`, `bb9b2248b116652f6aff06523cf7d39d18d008ab`, and related commits through the pinned source tip. This integration adapts only the offline review and provenance portions to the current #235/#236 parent; it does not replace current files wholesale.

The goal is to compare already-supplied sanitized observations with checked-in operation contracts, preserve explicit uncertainty, bind reviews to their source evidence, and produce report-only promotion advice. No live portal acceptance, probing, replay, new collection, credential use, or automatic spec change is part of this layer.

## Source-path disposition

| Source path | Disposition |
|---|---|
| `tools/cdp-deep-capture.mjs` | Added pure normalization over existing records: operation/request-media identity, bounded shape completeness, explicit capture state, observation references, and bounded sample provenance. Existing CDP subscriptions, response retrieval, interaction, and capture lifecycle are unchanged. |
| `tools/discovery-candidate-handoff.mjs` | Carries canonical contract observations and opaque origin-binding hashes through offline handoff identity; raw origins are not added to the published handoff. |
| `tools/discovery-derivative-families.mjs` | Bumped family/index schema to v2; origin and complete typed contracts participate in identity. Reuse is withheld for missing, partial, null, overflowed, or legacy contract evidence and for absent health/analyzer/provenance metadata. |
| `tools/discovery-review-assignments.mjs` | Binds each assignment and plan to the digest of the complete grouped handoff. Validation rejects mismatched bindings. |
| `tools/generate-crawl-candidates.mjs` | Normalizes only supplied artifact records into typed contracts, host-safe origin hashes, and existing route candidates. It does not add route extraction, probing, or candidate-discovery logic. |
| `tools/mine-javascript-bundles.mjs` | Adds content hashes to the provenance of already-discovered bundle records so same-basename/different-content inputs are not conflated. The analyzer and its route enumeration are unchanged. |
| `tools/portal-discovery-controller.mjs` | Replaces the broad string-only privacy rejection with the shared typed evidence gate; controller output remains report-only. |
| `tools/portal-discovery-promotion-planner.mjs` | Compares observed status, media, request/response shapes, host/origin bindings, and route templates against existing inventory. Incomplete or ambiguous evidence blocks promotion; worker approval must bind the current handoff and review assignment. No spec writer or live action is added. |
| `tools/tests/evidence-pipeline.test.mjs` | Adds synthetic offline integration across record normalization, candidate/handoff, review, promotion, typed privacy, benchmark evidence-source tags, recorder export, and the pinned Postman converter. The converter test runs only when `NODOC_POSTMAN_PIPELINE=1`. |
| `tools/tests/discovery-derivative-families.test.mjs` | Covers v2 identity, origin/contract-sensitive reuse, observation-reference stability, and fail-closed legacy/incomplete evidence. |
| `tools/tests/portal-discovery-layer4.test.mjs` | Covers typed contract vocabulary through the integrated report-only controller and verifies that untrusted evidence is rejected. |
| `tools/tests/portal-discovery-promotion-planner.test.mjs` | Existing approval fixtures now carry the source handoff digest; result validation rejects missing evidence binding. |
| `tools/tests/cdp-deep-capture-source.test.mjs` | Normalizes source-text line endings in its source assertion; no CDP live-capture behavior changed. |
| `tools/tests/capture-evidence.test.mjs` | The original source's live-capture helper tests are deliberately not imported. They exercise new request/response body capture and decoding behavior outside this layer's offline-only boundary. |
| `package.json`, `.github/workflows/ci.yml` | Adds a scoped `test:evidence` script and CI invocation with `NODOC_POSTMAN_PIPELINE=1`. Existing CI path filters are preserved. |
| `CONTRIBUTING.md` | Retains the #235 behavior/ledger guidance and documents the scoped offline suite and its synthetic-only boundary. |

## Deliberately deferred source hunks

- The original source's `captureRequestBody`, `decodeResponseCapture`, and `applyResponseCapture` helpers and associated CDP `Network.*` event/body-limit changes are deferred. They would alter the established #226/#230 capture pipeline; this layer only normalizes records already supplied to it.
- No new route or candidate discovery, bundle extraction, guessed-method probing, replay, or live operation logic is imported.
- The original source's generated Exchange/SharePoint collection edits are not imported. The repository's current 22 collections are validated through repeat generation/checks instead.
- PR #234 is an independent draft, not a parent. This branch carries the small `evidenceSource` distinction (`fixture-self-check` versus `caller-supplied-result`) and tests it, but does not include #234's measured benchmark mode or claim it is available. If both land, preserve the measured-mode calculations and this source label in the shared benchmark result/tests when resolving the overlap.

## Milestones and acceptance boundaries

- [x] M1 — Preserve sanitized observation identity and uncertainty through offline review.
- [x] M2 — Compare existing operation contracts without inferring support or cause from missing, empty, partial, or error-only evidence.
- [x] M3 — Bind derivative reuse, assignments, and worker approvals to current source evidence.
- [x] M4 — Keep controller and promotion output report-only and apply a typed privacy gate to canonical contract evidence.
- [x] M5 — Exercise scoped synthetic production transformations, including the pinned Postman converter.
- [ ] M6 — Desktop live acceptance remains **OPEN**. It requires a separate coordinated exercise in an already-approved desktop session; no live capture or acceptance is claimed here.

## Verification record

### Historical source-branch results (not this layer's validation)

The original source plan recorded a 342-test offline discovery run, a 116-test evidence acceptance run including the pinned converter, checks across 22 published specs/collections, and a passing site build/typecheck. Those are historical results from the original source branch, not evidence that this split layer or current main has passed them.

### Current integration results

- `NODOC_POSTMAN_PIPELINE=1 npm run test:evidence`: **124 passed, 0 failed**, including the synthetic pinned-converter test.
- Ran `npm run generate:postman` twice: **all 22 current collection files remained byte-for-byte unchanged on both runs**.
- These offline checks do not close M6 or establish live portal behavior.
