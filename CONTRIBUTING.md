# Contributing Guide

Thanks for checking out this guide - we really appreciate any contributions to the project. This page outlines high-level guidance for contributing to any of the nodoc project, whether that be in this repository specifically, or within the seperate API repositories.

We welcome a range of contributions including updates to:

- Specifications
- Website
- Documentation
- CI/CD

## OpenAPI

Unless otherwise specified, we use OpenAPI 3.0.1. Whilst we have plans to upgrade to 3.1.x, there are compatibility issues with some tools keeping us on this version for now.

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
- The current 14-spec bundle-and-convert pass benchmarks at roughly **10 seconds per spec** and about **2.5 minutes total** when writing to temp outputs. A real run that also rewrites `postman/collections/` can take a bit longer, but anything that sits well past that without finishing is worth investigating as a likely hang or filesystem-write issue.
- For focused local iteration, limit generation to the affected specs with `NODOC_COLLECTIONS=purview,purview-portal npm run generate:postman` (or the PowerShell equivalent with `$env:NODOC_COLLECTIONS = 'purview,purview-portal'`).
- If long-running commands look stuck in the shell wrapper, redirect stdout/stderr to an artifact log and capture elapsed time separately before assuming the generator or site build is actually hung.

## Discovery workflow

For recurring portal research and undocumented API discovery work, use the living playbook in [AGENT_DISCOVERY_PLAYBOOK.md](./AGENT_DISCOVERY_PLAYBOOK.md).

It captures the preferred browser/auth workflow, traffic-first discovery process, JavaScript bundle mining guidance, write-shape safety practices, and an experiment log for iterating on better techniques over time.
