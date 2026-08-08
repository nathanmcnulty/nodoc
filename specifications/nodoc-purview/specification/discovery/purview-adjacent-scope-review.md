# Purview bounded discovery adjacency scope-review handoff

Portal: Purview
Spec: purview
Artifacts directory: C:\Users\NATHAN~1\AppData\Local\Temp\nodoc-purview-discovery-1563d695-14de-41a7-a270-d837662a44c8

## Run completion
- Status: completed
- Recommended next action: review-adjacent-candidate-scope - Assign the adjacent confirmed or probed candidates to the correct specification and host family before any promotion review.
- Candidate counts: confirmed-read=0, confirmed-safety=0, successfully-probed=0, bundle-only=59, suppressed=0, adjacent-confirmed-read=13, adjacent-safety=7, adjacent-probed=0, adjacent-bundle-only=0
- Evidence channels: GraphQL=16, RPC=0, streaming=0, successful probe results=0

## Adjacent confirmed reads requiring scope assignment
| method | normalizedPath | hostFamily | matchingSpecIds | scopeReasons |
|---|---|---|---|---|
| GET | /account | {tenant}.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| GET | /shellux/en/shellstrings.9347b6944f1c0aa9589691e018242245.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /knowledge-center/blogs.json | {tenant}.prod.ext.{tenant}.{tenant}.azure.com | unspecified | host-and-path-out-of-scope |
| GET | /knowledge-center/docs.json | {tenant}.prod.ext.{tenant}.{tenant}.azure.com | unspecified | host-and-path-out-of-scope |
| GET | /knowledge-center/videos.json | {tenant}.prod.ext.{tenant}.{tenant}.azure.com | unspecified | host-and-path-out-of-scope |
| GET | /manifest.json | {tenant}.prod.ext.{tenant}.{tenant}.azure.com | unspecified | host-and-path-out-of-scope |
| GET | /releasenotes/releasenotes.json | {tenant}.prod.ext.{tenant}.{tenant}.azure.com | unspecified | host-and-path-out-of-scope |
| GET | /account | api.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| GET | /provisioning/checkTenant | api.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| GET | /config/v1/LokiService/1.0.0.0 | ecs.office.com | security-copilot | host-and-path-out-of-scope |
| GET | /tenants | management.azure.com | unspecified | host-and-path-out-of-scope |
| GET | /api/Auth/getSpaAuthCode | purview.microsoft.com | purview-portal | path-out-of-scope |
| GET | /api/v2/auth/GetCachedRoles | purview.microsoft.com | purview-portal | path-out-of-scope |

## Adjacent confirmed safety-classification candidates requiring scope assignment
| method | normalizedPath | hostFamily | matchingSpecIds | scopeReasons |
|---|---|---|---|---|
| POST | /v2/track | [redacted-host] | unspecified | host-and-path-out-of-scope |
| POST | /Collector/3.0 | {tenant}.{tenant}.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| POST | /OneCollector/1.0 | {tenant}.{tenant}.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| POST | /account/features | api.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| POST | /api/gateway/actions/collections/me | api.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| POST | /api/auth/IsInRoles | purview.microsoft.com | purview-portal | path-out-of-scope |
| POST | /api/log/Put | purview.microsoft.com | purview-portal | path-out-of-scope |

## Adjacent successful probes requiring scope assignment
- None

## Adjacent bundle-only leads requiring scope assignment
- None

## Non-adjacent handoff status
- confirmedReadCandidates: 0
- confirmedSafetyReviewCandidates: 0
- successfullyProbedCandidates: 0
- bundleOnlyCandidates: 59
- suppressedCandidates: 0

## Suggested owner actions
- Assign routes with explicit `matchingSpecIds` to the same owning spec.
- Resolve remaining `unspecified` routes by host-family ownership and target spec.
- Keep 59 bundle-only candidates in a separate follow-up validation PR.
- Do not promote adjacent entries without explicit host/spec assignment.
