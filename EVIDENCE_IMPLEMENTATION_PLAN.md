# Evidence and behavioral contracts

Owner: evidence implementation task, 2026-10-30. Baseline: `e05acb32c439f70f41973f32e3b5886eca8569d1`.

Goal: preserve what was actually observed about internal APIs and expose what automation authors still need to establish. A route's existence does not establish its contract, all supported methods, or the cause of an HTTP error.

GitHub issues are disabled in this repository (verified with `gh issue list` on 2026-10-30). This committed checklist and draft PR #225 track the work without changing repository settings. The unrelated [Scalar PR #223](https://github.com/nathanmcnulty/nodoc/pull/223) and the desktop owner's unpublished refresh work are outside this branch.

## Ordered milestones and acceptance

- [x] M1 — Preserve observations and protect exports. Distinct origins, statuses, media types and semantic error signatures survive recorder/CDP aggregation and bundle mining. Bounded retention reports omission rather than silently asserting completeness. JSON/YAML exports contain sanitized examples and host-correct contracts. Regressions include same-shaped errors and success followed by failure.
- [x] M2 — Describe capture uncertainty. Null, primitive and heterogeneous JSON infer conservative order-independent schemas. Observed request bodies do not imply requiredness. Capture state distinguishes empty, unavailable, size/policy exclusions and encoding failures. Regressions include base64 and omitted bodies.
- [x] M3 — Compare documented contracts. Real inventory and candidate/handoff pipeline compare requests, responses, statuses and media types on existing operations. New evidence produces enrichment or drift review rather than an already-documented dismissal. Incompatible observations remain available for review.
- [x] M4 — Record behavioral explanations and readiness. Extend `x-nodoc-operation-context` with conditional outcomes, observation references, confidence, counterexamples and dates; distinguish observed method from a validated set and logical GraphQL/RPC identity. Track per-operation evidence dimensions independently of presentation maturity. Unknown is explicit and never means unsupported.
- [x] M5 - Exercise production paths offline. A shared synthetic corpus exercises CDP normalization/aggregation through candidate, handoff, controller and promotion planning, plus a separate recorder-to-OpenAPI-to-Postman path. No automated promotion-to-spec writer or live browser capture is claimed. Verify retention, determinism, sanitization and compatibility; label fixture scorecards honestly.
- [ ] M6 — Desktop live acceptance (separate from offline implementation). Coordinate with the active refresh owner before touching its browser. Use only bounded passive observation/read-only navigation of an existing session. Validate recorder/UI integration and evidence output without publishing tenant captures. Do not infer licensing/permission causality from HTTP status alone.

## Publication and acceptance boundaries

Publish sanitized source, synthetic fixtures and test results in draft PRs; do not merge, enable auto-merge, deploy or release. Preserve existing branches/files and never publish raw captures, credentials, tenant/account identifiers or private receipts. No role/license/consent/configuration changes, guessed-method probing or unknown-effect operations are authorized. Missing live evidence stays open even if all offline tests pass.

## Progress and links

Implementation branch: `feat/evidence-behavior-contracts-20261030`. Plan commit: `33a5902e9dd9413200f601e5e65ef2de335d386c`. Implementation commit: `5d77dc9bbe05a2196b182430da81b515fc2eafd4`.

M1–M5 are implemented. Independent review identified and resolved missing request media types, scalar/text error signatures, sanitized-host identity collisions, bounded-shape completeness, empty no-content outcomes and specific-route Postman example selection. Recorder dynamic property keys retain incompatible value shapes after redaction. No live acceptance has run in this task.

Validation on pinned Node 24.22.1:

- Full offline discovery suite after independent-review fixes: 342 passed, 0 failed, 0 skipped. Source hashes were unchanged across the run. Earlier sandbox temporary-file rename failures were resolved by validation outside the sandbox with the pinned runtime.
- Final evidence acceptance suite after all review fixes and corrected generated route bindings: 116 passed, 0 failed, 0 skipped, including actual openapi-to-postmanv2@6.0.0 conversion.
- Spec-quality validation: 22 published specs. Portal metadata validation: 22 specs and 62 recipes.
- All four checked-in site-data artifacts regenerated without content differences. TypeScript `tsc --noEmit` passed.
- Automation evidence generator exercised across 2,026 operations in 22 specs; undocumented dimensions remain explicitly unknown. The readiness artifact is generated on demand, separate from presentation scores.
- Production site build passed. Scalar dynamic-import and CSS-minifier warnings were emitted; neither blocked the build.

Publication status: after the initial automatic-review rejection, Nathan explicitly approved the sanitized public branch and draft PR. The normal non-force push succeeded and draft PR #225 is open: https://github.com/nathanmcnulty/nodoc/pull/225 . No raw captures or operational evidence were published, and no merge, auto-merge, deployment or release was performed. Current CI status is tracked in the PR checks.

M6 remains pending: the existing discovery owner was contacted twice without taking over its session. Available UI inventory exposes only empty in-app/MCP browser surfaces, with no Chrome/Edge or authenticated portal tab. The sandbox cannot access the owner checkout. No extension was installed or reloaded, no browser lease was claimed, and no live capture ran. Next action is a coordinated manual recorder exercise and bounded passive capture in an existing approved desktop session. A new unpacked installation, if needed, would request cookies/storage/clipboardWrite/webRequest and portal-host access and needs separate installation/access authorization. Do not change roles, licenses, consent or configuration to manufacture comparisons.

Evidence limitations: exports are sanitized drafts and retained field/header/query names require review; raw CDP artifacts stay private. Shape comparison does not establish requiredness, enums, ranges or composition alternatives. Service-error hashes distinguish variants but causal interpretations require reviewed private observations and comparisons. No unsupported licensing or permission conclusions were added to real specs.

## Independent-review completion

Exact local checkpoint 6c89fc2 was reviewed independently for security and production-path correctness. Verified findings were fixed in bb9b2248b116652f6aff06523cf7d39d18d008ab and re-reviewed at that exact commit with no remaining assigned blocker. Fixes cover complete POSIX cURL quoting, structural/full-value error signatures with bounded-scan fallback, strict UTF-8 errors, raw shape inference before redaction, unknown media, shared safe capture metadata, origin/scheme/port and canonical route matching, unsupported composition, typed controller privacy, and evidence-bound review reuse and worker approvals.

Derivative family/index artifacts now use schema version 2. Rebuild old indexes; legacy, incomplete or unknown evidence cannot inherit approval. Promotion and review assignments expose the full sourceHandoffDigest, which worker results must copy along with current assignment bindings. These are evidence-review assertions and remain report-only.

Independent checks included 23 security regressions and an exact-commit pipeline recheck including actual cached Postman conversion. Native Bash parsing could not run because Windows denied MSYS initialization; cURL quoting was verified using the standard POSIX construction and passing VM/parser regressions. No shell payload executed.

All 22 public-spec Postman conversions completed. A separate unchanged-baseline control reproduced existing catalog freshness debt, notably M365 Admin 224 to 320 routes and Purview 134 to 136 routes. Those unrelated catalog refreshes were preserved outside the branch. Only Exchange and SharePoint generated artifacts changed for corrected route bindings; their inputs are existing public specs, not new operational captures. Artifact commit: 0aa6aa749c522f55a41436a1f37771566bc0d09b.

Draft PR: [#225 - Preserve API evidence and behavioral contracts through tooling](https://github.com/nathanmcnulty/nodoc/pull/225). The branch targets main at e05acb32c439f70f41973f32e3b5886eca8569d1. M6 remains open; local implementation and independent-review fixes are complete.
