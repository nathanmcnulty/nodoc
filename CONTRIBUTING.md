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

## Quality metrics

The website now surfaces generated spec-quality metadata from the checked-in OpenAPI files, and the repo also keeps a machine-readable portal coverage ledger under `src/generated/`.

- Regenerate it with `npm run generate:site-data`.
- `npm run build`, `npm run start`, and `npm run typecheck` already regenerate this data automatically.
- The generator reports navigation consistency, metadata completeness, placeholder debt, and example coverage for every published spec.
- The same pass also refreshes `src/generated/portalCoverageLedger.json`, which captures per-portal seed URLs, observed hosts, promoted discoveries, telemetry exclusions, and open gaps for agent-driven discovery work.
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
- Use `npm run capture:deep-crawl -- --portal <portal-name> --url <seed-url> --out <artifact-dir> ...` for checked-in raw CDP page-target capture. It supports repeated `--action type=value` steps including `click-label`, `click-contains`, `click-href`, `navigate`, `capture`, `wait-ms`, and `replay-seeded-links`.
- Pair `replay-seeded-links` with `--seed-artifacts <artifact-dir>` and optional `--seed-page <page-substring>` / `--seed-link-contains <substring>` filters when you want to revisit safe same-origin detail links recorded in earlier page-state artifacts instead of re-clicking a live grid.
- After capturing a portal pass, run `npm run generate:crawl-candidates -- --spec <title-or-spec-id> --artifacts <artifact-dir>` to normalize the captured route families, scope them to the target spec's hosts and path prefixes, diff them against the checked-in spec, and emit a candidate queue tagged as confirmed, probed, or bundle-discovered.
- Run `npm run generate:coverage-ledger` whenever you want a refreshed machine-readable inventory of portal seeds, pass depth, promoted routes, telemetry exclusions, and still-open discovery gaps.
- Add `--include-adjacent` when you intentionally want to inspect cross-product shell, support, telemetry, or neighboring portal traffic that falls outside the target spec's own host and path scope.
