# Evidence and behavioral contracts

Owner: evidence implementation task, 2026-10-30. Baseline: `e05acb32c439f70f41973f32e3b5886eca8569d1`.

Goal: preserve what was actually observed about internal APIs and expose what automation authors still need to establish. A route's existence does not establish its contract, all supported methods, or the cause of an HTTP error.

GitHub issues are disabled in this repository (verified with `gh issue list` on 2026-10-30). This committed checklist and its draft PR track the work without changing repository settings. The unrelated [Scalar PR #223](https://github.com/nathanmcnulty/nodoc/pull/223) and the desktop owner's unpublished refresh work are outside this branch.

## Ordered milestones and acceptance

- [ ] M1 — Preserve observations and protect exports. Distinct origins, statuses, media types and semantic error signatures survive recorder/CDP aggregation and bundle mining. Bounded retention reports omission rather than silently asserting completeness. JSON/YAML exports contain sanitized examples and host-correct contracts. Regressions include same-shaped errors and success followed by failure.
- [ ] M2 — Describe capture uncertainty. Null, primitive and heterogeneous JSON infer conservative order-independent schemas. Observed request bodies do not imply requiredness. Capture state distinguishes empty, unavailable, size/policy exclusions and encoding failures. Regressions include base64 and omitted bodies.
- [ ] M3 — Compare documented contracts. Real inventory and candidate/handoff pipeline compare requests, responses, statuses and media types on existing operations. New evidence produces enrichment or drift review rather than an already-documented dismissal. Incompatible observations remain available for review.
- [ ] M4 — Record behavioral explanations and readiness. Extend `x-nodoc-operation-context` with conditional outcomes, observation references, confidence, counterexamples and dates; distinguish observed method from a validated set and logical GraphQL/RPC identity. Track per-operation evidence dimensions independently of presentation maturity. Unknown is explicit and never means unsupported.
- [ ] M5 — Exercise production paths offline. Synthetic observations pass through actual normalization, aggregation, handoff/planner, OpenAPI export and Postman conversion. Verify retention, determinism and sanitization; label fixture scorecards honestly. Run focused and repository discovery checks, spec validation and generated-data checks.
- [ ] M6 — Desktop live acceptance (separate from offline implementation). Coordinate with the active refresh owner before touching its browser. Use only bounded passive observation/read-only navigation of an existing session. Validate recorder/UI integration and evidence output without publishing tenant captures. Do not infer licensing/permission causality from HTTP status alone.

## Publication and acceptance boundaries

Publish sanitized source, synthetic fixtures and test results in draft PRs; do not merge, enable auto-merge, deploy or release. Preserve existing branches/files and never publish raw captures, credentials, tenant/account identifiers or private receipts. No role/license/consent/configuration changes, guessed-method probing or unknown-effect operations are authorized. Missing live evidence stays open even if all offline tests pass.

## Progress and links

Implementation branch: `feat/evidence-behavior-contracts-20261030`. Draft PR link and exact validation results will be recorded here after implementation. No live acceptance has run in this task.
