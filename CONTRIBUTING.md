# Contributing Guide

Thanks for checking out this guide - we really appreciate any contributions to the project. This page outlines high-level guidance for contributing to any of the nodoc project, whether that be in this repository specifically, or within the seperate API repositories.

We welcome a range of contributions including updates to:

- Specifications
- Website
- Documentation
- CI/CD

## OpenAPI

Unless otherwise specified, we use OpenAPI 3.0.1. Whilst we have plans to upgrade to 3.1.x, there are compatibility issues with some tools keeping us on this version for now.

## Root spec conventions

Root `openapi.yml` files drive both website presentation and downstream artifacts. Keep them consistent:

- Add `info.contact`, `info.license`, `servers[].description`, and `externalDocs` on every published root spec.
- Use `x-tagGroups` for user-facing sections in Scalar. Group related tags together; do **not** mirror tags 1:1 into separate sections.
- Use `x-displayName` when a tag name is technical, camel-cased, or backend-oriented and needs a cleaner label in the navigation tree.
- Keep group names user-facing. Avoid raw hostnames, internal service names, or API prefixes as section headers unless they are the actual product concept users navigate by.
- Preserve backend provenance in tag descriptions and operation descriptions rather than the navigation labels.
- Keep repo-only live-capture browsing evidence under `x-nodoc-live-capture` instead of public `description` fields so the site does not render environment-specific routes.
- Use `x-nodoc-headerProfiles` at the root spec level when a portal requires repeated non-standard header sets that are not fully captured by OpenAPI `securitySchemes` alone.
- Use `x-nodoc-authProfiles` at the root spec level when you need structured cookie shape, token-broker flow, downstream audience, claim-summary, or permission-baseline guidance without storing raw secret material.
- Use `x-nodoc-operation-context` on operations when downstream developers need structured guidance about canonical route aliases, workflow/surface placement, header-profile binding, request-shape variants, conditional availability, or provenance.
- Use `authProfile` inside `x-nodoc-operation-context` when an operation depends on a documented auth profile or emits auth-context evidence that should be tied back to a root-level auth model.
- Keep `x-nodoc-operation-context` language-agnostic. Prefer concepts like canonical paths, request content types, body/query selectors, and availability notes over client-specific implementation advice.
- Never store raw cookie values, bearer tokens, refresh tokens, or JWT signature material in committed specs. Capture normalized claim summaries and cookie attributes instead.
- Auth-profile content is validated for secret-looking JWTs, bearer strings, and cookie/header assignments during generation and `npm run validate:spec-quality`; replace raw material with normalized summaries if validation fails.

## Quality metrics

The website now surfaces generated spec-quality metadata from the checked-in OpenAPI files, and the repo also keeps a machine-readable portal coverage ledger under `src/generated/`.

- Regenerate it with `npm run generate:site-data`.
- `npm run build`, `npm run start`, and `npm run typecheck` already regenerate this data automatically.
- The generator reports navigation consistency, metadata completeness, placeholder debt, and example coverage for every published spec.
- The same pass also refreshes `src/generated/portalCoverageLedger.json`, which captures per-portal seed URLs, observed hosts, promoted discoveries, telemetry exclusions, and open gaps for agent-driven discovery work.
- It also refreshes `src/generated/operationLiveCaptureLedger.json`, which indexes repo-only `x-nodoc-live-capture` operation metadata for agents and tooling.
- It also refreshes `src/generated/operationContextLedger.json`, which indexes validated `x-nodoc-headerProfiles`, `x-nodoc-authProfiles`, and `x-nodoc-operation-context` metadata for downstream tooling.
- Treat placeholder markers such as `pending` as real debt to remove with evidence, not as acceptable final-state documentation.

## Styling

When contributing, please ensure that submissions conform to the linting configured within each corresponding repository. This is typically as follows:

| Language  | Linter     | Configuration File |
| --------- | ---------- | ------------------ |
| `yaml`    | `yamllint` | `.yamllint.yaml`   |
| `OpenAPI` | `redocly`  | `redocly.yaml`     |

## Postman collections

Checked-in Postman collections live under `postman/collections/` and are generated from the OpenAPI specs in this repository.

- Do not edit the checked-in collection JSON by hand.
- Regenerate them with `npm run generate:postman`.
- When specs change, commit the updated collections alongside the spec changes so the validation workflow stays green.
- The current 15-spec bundle-and-convert pass benchmarks at roughly **10 seconds per spec** and about **2.5 minutes total** when writing to temp outputs. A real run that also rewrites `postman/collections/` can take a bit longer, but anything that sits well past that without finishing is worth investigating as a likely hang or filesystem-write issue.
- For focused local iteration, limit generation to the affected specs with `NODOC_COLLECTIONS=purview,purview-portal npm run generate:postman` (or the PowerShell equivalent with `$env:NODOC_COLLECTIONS = 'purview,purview-portal'`).
- If long-running commands look stuck in the shell wrapper, redirect stdout/stderr to an artifact log and capture elapsed time separately before assuming the generator or site build is actually hung.

## Discovery workflow

For recurring portal research and undocumented API discovery work, use the living playbook in [AGENT_DISCOVERY_PLAYBOOK.md](./AGENT_DISCOVERY_PLAYBOOK.md).

It captures the preferred browser/auth workflow, traffic-first discovery process, JavaScript bundle mining guidance, write-shape safety practices, and an experiment log for iterating on better techniques over time.

- Start broad planning runs with `npm run generate:crawl-baseline` to see the current spec inventory, recorder support gaps, and the recommended crawl priority for each published portal.
- Run `npm run generate:recipe-audit` to see which portals still lack checked-in recipes, iframe coverage, seeded replay, or second-pass interaction checkpoints.
- Use `npm run capture:deep-crawl -- --portal <portal-name> --url <seed-url> --out <artifact-dir> ...` for checked-in raw CDP page-target capture. It supports repeated `--action type=value` steps including `click-label`, `click-contains`, `click-href`, `navigate`, `capture`, `wait-ms`, `replay-seeded-links`, and `replay-seeded-routes`.
- Prefer `--recipe tools/capture-recipes/<portal>.json` once a portal already has a checked-in flow. Recipes can still be combined with explicit `--action ...` overrides, and variable-backed recipes such as SharePoint can be filled with repeated `--var name=value` arguments.
- Pair `replay-seeded-links` or `replay-seeded-routes` with `--seed-artifacts <artifact-dir>` when you want to revisit safe same-origin detail links or replay detail routes derived from IDs already present in earlier request/page-state artifacts instead of re-clicking a live grid.
- After capturing a portal pass, run `npm run generate:crawl-candidates -- --spec <title-or-spec-id> --artifacts <artifact-dir>` to normalize the captured route families, scope them to the target spec's hosts and path prefixes, diff them against the checked-in spec, and emit a candidate queue tagged as confirmed, probed, or bundle-discovered.
- Run `npm run generate:coverage-ledger` whenever you want a refreshed machine-readable inventory of portal seeds, pass depth, promoted routes, telemetry exclusions, and still-open discovery gaps.
- Add `--include-adjacent` when you intentionally want to inspect cross-product shell, support, telemetry, or neighboring portal traffic that falls outside the target spec's own host and path scope.
