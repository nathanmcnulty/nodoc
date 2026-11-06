# Portfolio refresh results

Snapshot: 2026-11-06, starting from main after #226 (`db6c17f`). This is an operation-level evidence assessment, not whole-spec or current-authentication certification.

The workflow inventoried all 22 specifications and 2,027 operations, 119 distinct recipes (125 spec assignments), public evidence files, recipe evaluations and blockers. It reused five retained captures across Purview (native and proxy), M365 Admin, Entra IAM and SharePoint. These cover authored cookie, delegated bearer, tenant-host and portal-proxy access patterns. No fresh browser capture, API replay, portal write, permission change or automatic merge was performed.

The retained corpus supports 111 exact, attributed operation observations within the configured 30-day window; 1,916 operations were not observed in this corpus. Seven operations have an observed error as their latest accepted observation, and 44 have a verified complete body. Original observation times are preserved. Fifteen ambiguous M365 raw records are excluded from owner-specific freshness. No error or absence recommends removal.

A second pass reused all five analyses, computed none, and produced byte-identical inventory and refresh reports. The first pass also preserved every capture input. Repeat execution exercises the offline refresh path; it does not establish new live portal acceptance or new independent reviewer execution.

## Operation inventory

“Observed” is scoped to the retained corpus and 30-day cutoff. Schema and example columns are authored-model diagnostics, including unknown models; they are review opportunities rather than confirmed runtime defects. The 325 checked-in capture annotations remain historical and unverified unless independently resolved against private artifacts. Every whole-spec freshness claim remains unknown.

| Specification | Operations | Observed | Not observed | Latest error | Schema gaps | Example gaps | Public evidence files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [Defender XDR](specifications/nodoc-defender-xdr/specification/openapi.yml) | 585 | 0 | 585 | 0 | 451 | 585 | 3 |
| [Defender XDR (MTO)](specifications/nodoc-defender-mto/specification/openapi.yml) | 19 | 0 | 19 | 0 | 19 | 14 | 1 |
| [Entra B2C](specifications/nodoc-entra-b2c/specification/openapi.yml) | 7 | 0 | 7 | 0 | 4 | 5 | 0 |
| [Entra IAM](specifications/nodoc-ibiza-iam/specification/openapi.yml) | 286 | 1 | 285 | 0 | 286 | 265 | 0 |
| [Entra IDGov](specifications/nodoc-entra-idgov/specification/openapi.yml) | 17 | 0 | 17 | 0 | 15 | 7 | 0 |
| [Entra IGA](specifications/nodoc-entra-iga/specification/openapi.yml) | 13 | 0 | 13 | 0 | 12 | 6 | 0 |
| [Entra PIM](specifications/nodoc-entra-pim/specification/openapi.yml) | 16 | 0 | 16 | 0 | 14 | 7 | 0 |
| [Exchange](specifications/nodoc-exchange-beta/specification/openapi.yml) | 62 | 0 | 62 | 0 | 62 | 57 | 0 |
| [Intune Autopatch](specifications/nodoc-intune-autopatch/specification/openapi.yml) | 53 | 0 | 53 | 0 | 53 | 52 | 0 |
| [Intune Portal](specifications/nodoc-intune-portal/specification/openapi.yml) | 5 | 0 | 5 | 0 | 5 | 3 | 0 |
| [M365 Admin](specifications/nodoc-m365-admin/specification/openapi.yml) | 320 | 48 | 272 | 3 | 269 | 320 | 2 |
| [M365 Apps Config](specifications/nodoc-m365-apps-config/specification/openapi.yml) | 24 | 0 | 24 | 0 | 11 | 18 | 0 |
| [M365 Apps Inventory](specifications/nodoc-m365-apps-inventory/specification/openapi.yml) | 27 | 0 | 27 | 0 | 19 | 25 | 0 |
| [M365 Apps Services](specifications/nodoc-m365-apps-services/specification/openapi.yml) | 9 | 0 | 9 | 0 | 1 | 7 | 0 |
| [Microsoft Graph Research](specifications/nodoc-graph-research/specification/openapi.yml) | 2 | 0 | 2 | 0 | 2 | 0 | 2 |
| [Power Platform](specifications/nodoc-power-platform/specification/openapi.yml) | 248 | 0 | 248 | 0 | 244 | 21 | 0 |
| [Purview](specifications/nodoc-purview/specification/openapi.yml) | 136 | 49 | 87 | 3 | 107 | 136 | 2 |
| [Purview Portal](specifications/nodoc-purview-portal/specification/openapi.yml) | 8 | 5 | 3 | 0 | 8 | 6 | 0 |
| [Security Copilot](specifications/nodoc-security-copilot/specification/openapi.yml) | 42 | 1 | 41 | 1 | 34 | 39 | 1 |
| [SharePoint](specifications/nodoc-sharepoint-admin/specification/openapi.yml) | 43 | 7 | 36 | 0 | 43 | 41 | 0 |
| [Teams](specifications/nodoc-teams/specification/openapi.yml) | 100 | 0 | 100 | 0 | 100 | 92 | 0 |
| [Viva Engage](specifications/nodoc-viva-engage/specification/openapi.yml) | 5 | 0 | 5 | 0 | 5 | 1 | 0 |

## Discovery, enrichment and blockers

The same captures generated the existing discovery/review handoffs and private schema/example candidates. Three M365 Admin GET drafts have complete attributable bodies and one public server binding; these are review candidates, not accepted new endpoints. Adjacent operations, shared-owner ambiguity, request variants, changed schemas and unsupported schema composition remain visible for review. Repeated identical shapes are grouped only within the same request variant, retaining every supporting observation.

The concise table below counts review groups, not promoted changes. Raw discovery leads may overlap across captures and include known ownership or static-client questions; they are not additive coverage claims.

| Retained capture scope | Exact matched operations | Enrichment observations | Review groups | New-GET drafts |
| --- | ---: | ---: | ---: | ---: |
| purview | 51 | 4 | 2 | 0 |
| purview | 24 | 2 | 1 | 0 |
| m365-admin | 43 | 148 | 135 | 3 |
| ibiza-iam | 2 | 2 | 1 | 0 |
| sharepoint-admin | 12 | 1 | 1 | 0 |

- New live collection needs a reviewed current missing-state/body objective and renewed exact execution bindings. The retained representative refresh approvals inspected here have expired; metadata validation also reports 37 legacy non-runnable approvals and 15 structurally bound approvals, which alone do not prove current execution readiness.
- Complete JSON bodies establish observed token types. Empty collections, null-only fields, unsupported composition, dynamic dictionary names, request variants and incomplete/oversize bodies require explicit limitations and review.
- Local checks and the pinned official Graph-contract comparison establish offline acceptance only. Fresh authentication, current tenant/feature states, minimum roles and unattended capture recovery remain unproved.
- Private proposals use the existing independent review and source-application receipts. The dry-run merger requires exact final bytes, complete evidence, sanitization and observed checks; missing inputs explain ineligibility. Actual automatic merging remains disabled.

See [the workflow](REFRESH_WORKFLOW.md) for reproducible commands, cache invalidation, source proposals, #225 reconciliation and the proposed merge rules. Private artifacts, raw identifiers, request values, body fingerprints and body lengths are excluded from this report.
