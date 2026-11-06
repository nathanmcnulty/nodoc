# Portfolio refresh results

Snapshot: 2026-11-06, starting from main after #226 (`db6c17f`). This is an operation-level evidence assessment, not whole-spec or current-authentication certification.

The workflow inventoried all 22 specifications and 2,027 operations, 119 distinct recipes (125 spec assignments), public evidence files, recipe evaluations and blockers. It assessed 26 retained attempt inputs and analyzed 23 complete captures across all 21 portal owners, covering authored cookie, delegated bearer, tenant-host, GraphQL/RPC and portal-proxy patterns. Microsoft Graph Research has no dedicated capture in this campaign. No fresh browser capture, API replay, portal write, permission change or automatic merge was performed.

The retained corpus supports 245 exact, attributed operation observations within the configured 30-day window; 1,782 operations were not observed in this corpus. Twelve operations have an observed error as their latest qualifying observation, and 184 have a verified complete body. Original observation times are preserved. Fifteen ambiguous M365 raw records are excluded from owner-specific freshness. No error or absence recommends removal.

The full repeat pass reused all 23 materialized analyses, computed none, and produced byte-identical inventory and refresh reports. Every capture input remained unchanged. Three historical artifact gaps stayed blocked: initial Defender MTO and SharePoint attempts produced no capture directory; the first Purview Portal capture has no summary. Later captures remain independently usable, including the recovered MTO remediation evidence. Repeat execution exercises the offline path; it does not establish new live portal acceptance or new independent reviewer execution.

## Operation inventory

“Observed” is scoped to the retained corpus and 30-day cutoff. Schema and example columns are authored-model diagnostics, including unknown models; they are review opportunities rather than confirmed runtime defects. The 325 checked-in capture annotations remain historical and unverified unless independently resolved against private artifacts. Every whole-spec freshness claim remains unknown.

| Specification | Operations | Observed | Not observed | Latest error | Schema gaps | Example gaps | Public evidence files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [Defender XDR](specifications/nodoc-defender-xdr/specification/openapi.yml) | 585 | 7 | 578 | 2 | 451 | 585 | 3 |
| [Defender XDR (MTO)](specifications/nodoc-defender-mto/specification/openapi.yml) | 19 | 3 | 16 | 0 | 19 | 14 | 1 |
| [Entra B2C](specifications/nodoc-entra-b2c/specification/openapi.yml) | 7 | 2 | 5 | 1 | 4 | 5 | 0 |
| [Entra IAM](specifications/nodoc-ibiza-iam/specification/openapi.yml) | 286 | 1 | 285 | 0 | 286 | 265 | 0 |
| [Entra IDGov](specifications/nodoc-entra-idgov/specification/openapi.yml) | 17 | 0 | 17 | 0 | 15 | 7 | 0 |
| [Entra IGA](specifications/nodoc-entra-iga/specification/openapi.yml) | 13 | 3 | 10 | 1 | 12 | 6 | 0 |
| [Entra PIM](specifications/nodoc-entra-pim/specification/openapi.yml) | 16 | 2 | 14 | 0 | 14 | 7 | 0 |
| [Exchange](specifications/nodoc-exchange-beta/specification/openapi.yml) | 62 | 16 | 46 | 0 | 62 | 57 | 0 |
| [Intune Autopatch](specifications/nodoc-intune-autopatch/specification/openapi.yml) | 53 | 3 | 50 | 0 | 53 | 52 | 0 |
| [Intune Portal](specifications/nodoc-intune-portal/specification/openapi.yml) | 5 | 4 | 1 | 0 | 5 | 3 | 0 |
| [M365 Admin](specifications/nodoc-m365-admin/specification/openapi.yml) | 320 | 48 | 272 | 3 | 269 | 320 | 2 |
| [M365 Apps Config](specifications/nodoc-m365-apps-config/specification/openapi.yml) | 24 | 6 | 18 | 0 | 11 | 18 | 0 |
| [M365 Apps Inventory](specifications/nodoc-m365-apps-inventory/specification/openapi.yml) | 27 | 7 | 20 | 0 | 19 | 25 | 0 |
| [M365 Apps Services](specifications/nodoc-m365-apps-services/specification/openapi.yml) | 9 | 8 | 1 | 0 | 1 | 7 | 0 |
| [Microsoft Graph Research](specifications/nodoc-graph-research/specification/openapi.yml) | 2 | 1 | 1 | 0 | 2 | 0 | 2 |
| [Power Platform](specifications/nodoc-power-platform/specification/openapi.yml) | 248 | 11 | 237 | 0 | 244 | 21 | 0 |
| [Purview](specifications/nodoc-purview/specification/openapi.yml) | 136 | 71 | 65 | 4 | 107 | 136 | 2 |
| [Purview Portal](specifications/nodoc-purview-portal/specification/openapi.yml) | 8 | 6 | 2 | 0 | 8 | 6 | 0 |
| [Security Copilot](specifications/nodoc-security-copilot/specification/openapi.yml) | 42 | 19 | 23 | 1 | 34 | 39 | 1 |
| [SharePoint](specifications/nodoc-sharepoint-admin/specification/openapi.yml) | 43 | 7 | 36 | 0 | 43 | 41 | 0 |
| [Teams](specifications/nodoc-teams/specification/openapi.yml) | 100 | 15 | 85 | 0 | 100 | 92 | 0 |
| [Viva Engage](specifications/nodoc-viva-engage/specification/openapi.yml) | 5 | 5 | 0 | 0 | 5 | 1 | 0 |

## Discovery, enrichment and blockers

The same captures generated the existing discovery/review handoffs and private schema/example candidates. Across the corpus, 481 enrichment observation records consolidate into 379 request/shape review groups, retaining every supporting observation. Seven new-GET draft observations remain review candidates, not accepted new endpoints; three reviewed M365 drafts were withheld for broad/composed schemas and privacy-sensitive field names. Other drafts remain unreviewed. Adjacent operations, shared-owner ambiguity, changed contracts and unsupported constraints remain visible.

Two M365 Admin GET response examples passed exact independent and separate source-acceptance gates and were applied through existing source-review receipts. They publish synthetic Boolean values with original observation time and evidence reference; the Postman collection was regenerated. No schema, endpoint, role or availability changes were invented. The operation-level example-gap count remains unchanged because other response/error examples in those operations are still missing.

The concise table below counts review groups, not promoted changes. Raw discovery leads may overlap across captures and include known ownership or static-client questions; they are not additive coverage claims.

| Retained capture scope | Enrichment observations | Review groups | New-GET draft observations |
| --- | ---: | ---: | ---: |
| defender-xdr | 11 | 5 | 3 |
| entra-b2c | 1 | 1 | 0 |
| entra-idgov | 0 | 0 | 0 |
| entra-iga | 3 | 3 | 0 |
| entra-pim | 3 | 3 | 0 |
| exchange-beta | 19 | 18 | 0 |
| ibiza-iam | 2 | 1 | 0 |
| intune-autopatch | 2 | 2 | 0 |
| intune-portal | 6 | 6 | 0 |
| m365-admin | 140 | 133 | 3 |
| m365-apps-config | 12 | 5 | 0 |
| m365-apps-inventory | 10 | 5 | 0 |
| m365-apps-services | 17 | 5 | 0 |
| power-platform | 22 | 14 | 0 |
| purview | 134 | 97 | 1 |
| purview-portal | 6 | 4 | 0 |
| security-copilot | 10 | 1 | 0 |
| sharepoint-admin | 1 | 1 | 0 |
| teams | 6 | 4 | 0 |
| viva-engage | 66 | 66 | 0 |
| purview | 4 | 2 | 0 |
| purview | 2 | 1 | 0 |
| defender-mto | 4 | 2 | 0 |

- New live collection needs a reviewed current missing-state/body objective and renewed exact execution bindings. The retained representative refresh approvals inspected here have expired; metadata validation also reports 37 legacy non-runnable approvals and 15 structurally bound approvals, which alone do not prove current execution readiness.
- Complete JSON bodies establish observed token types. Empty collections, null-only fields, unsupported composition, dynamic dictionary names, request variants and incomplete/oversize bodies require explicit limitations and review.
- Local checks and the pinned official Graph-contract comparison establish offline acceptance only. Fresh authentication, current tenant/feature states, minimum roles and unattended capture recovery remain unproved.
- Private proposals use the existing independent review and source-application receipts. The dry-run merger requires exact final bytes, complete evidence, sanitization and observed checks; missing inputs explain ineligibility. Actual automatic merging remains disabled.

The scoped privacy scan covered all 190 physical bodies in the five representative evidence roots against 527 public source files with no fingerprint/length matches before application. The wider historical artifact-tree scan stopped on source-mirror symlinks and is not claimed as passed. Independent review separately checked both published examples and their property names.

See [the workflow](REFRESH_WORKFLOW.md) for reproducible commands, cache invalidation, source proposals, #225 reconciliation and the proposed merge rules. Private artifacts, raw identifiers, request values, body fingerprints and body lengths are excluded from this report.
