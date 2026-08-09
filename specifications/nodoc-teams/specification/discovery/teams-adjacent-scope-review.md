# Teams bounded discovery adjacency scope-review handoff

Portal: Viva Engage
Spec: teams
Artifacts:
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-admin-all-0bd2c865-a2df-42b5-93f8-29521dac52f3\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-admin-retry-b228923b-87c3-4c1b-97da-424b7debeb88\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-extnet-all-425a90cf-fefc-4d0b-89e5-7a2b5b532abe\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-fcontinue-8fe277b9-ed20-46bd-a7c7-50a4d9a55d26\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-retry-4f9566c0-64f6-4249-ad1d-079ad907919c\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-setup-all-d9f99a41-5d39-4f6e-8d5f-85145c89e6ad\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-discovery-viva-engage-tenant-all-a4008d35-e5f5-46b7-867d-0acc8d2fa070\candidate-handoff.json
- C:\Users\NathanMcNulty\AppData\Local\Temp\nodoc-viva-engage-discovery-1c319b10-f452-4be9-964a-99d91c40bc6d\candidate-handoff.json

## Run completion
- Status: completed
- Recommended next action: review-adjacent-candidate-scope - Assign the adjacent confirmed or probed candidates to the correct specification and host family before any promotion review.
- Candidate counts: confirmed-read=0, confirmed-safety=0, successfully-probed=0, bundle-only=42, suppressed=0, adjacent-confirmed-read=39, adjacent-safety=9, adjacent-probed=0, adjacent-bundle-only=0
- Evidence channels: GraphQL=0, RPC=0, streaming=0, successful probe results=0

## Confirmed reads ready for review
- None

## Confirmed safety-classification candidates
- None

## Successful probe candidates
- None

## Bundle-only validation candidates
| Method | normalizedPath | hostFamily | matchingSpecIds | scopeReasons |
| --- | --- | --- | --- | --- |
|  | /api/([/_0-9a-zA-Z]+ |  | unspecified |  |
|  | /api/( |  | unspecified |  |
|  | /api/bootlog/bootfailure |  | unspecified |  |
|  | /api/clientshell/GetOriginAllowList |  | unspecified |  |
|  | /api/cn |  | unspecified |  |
|  | /api/instrument/logclient |  | unspecified |  |
|  | /api/mil |  | unspecified |  |
|  | /api/myapps/GetAllApplications |  | unspecified |  |
|  | /api/myapps/GetAllApps |  | unspecified |  |
|  | /api/myapps/GetAppDataCache |  | unspecified |  |
|  | /api/myapps/GetAppDetails |  | unspecified |  |
|  | /api/myapps/GetIcon |  | unspecified |  |
|  | /api/selection |  | unspecified |  |
|  | /api/settings/darkmode |  | unspecified |  |
|  | /api/settings/datetimeformats |  | unspecified |  |
|  | /api/settings/theme |  | unspecified |  |
|  | /api/shell/getshellinfo |  | unspecified |  |
|  | /api/shellbootstrapper/{id}/oneshell |  | unspecified |  |
|  | /api/shellbootstrapper |  | unspecified |  |
|  | /api/storage/{id}/{id}/{id} |  | unspecified |  |
|  | /api/theme/tenant |  | unspecified |  |
|  | /api/us |  | unspecified |  |
|  | /api/uxversion |  | unspecified |  |
|  | /api/v1/configuration |  | unspecified |  |
|  | /api/v1/contactTags |  | unspecified |  |
|  | /api/v1/livepersonacard/configuration |  | unspecified |  |
|  | /api/v1/organization |  | unspecified |  |
|  | /api/v1/peoplegraph/contact |  | unspecified |  |
|  | /api/v1/person/titleAndImage |  | unspecified |  |
|  | /api/v1/topic/capabilities |  | unspecified |  |
|  | /api/v1/topic/createTopicPage |  | unspecified |  |
|  | /api/v1/topic/findTopicPage |  | unspecified |  |
|  | /api/v1/topic/getTopicsByIds |  | unspecified |  |
|  | /api/v1/topic/getTopicsByNames |  | unspecified |  |
|  | /api/v1/topic/topics/settings |  | unspecified |  |
|  | /api/v1/topic/topics/simple |  | unspecified |  |
|  | /api/v1/topic/updateTopicPage |  | unspecified |  |
|  | /api/v1/workingwith |  | unspecified |  |
|  | /api/v2/topicfeedback/submit |  | unspecified |  |
|  | /api |  | unspecified |  |
|  | /graphql/schema.all.min-hash-7ac6404d.do.graphql |  | unspecified |  |
| GET | /api/shell/navbardata |  | unspecified |  |

## Suppressed candidates
- None

## Adjacent confirmed reads requiring scope assignment
| Method | normalizedPath | hostFamily | matchingSpecIds | scopeReasons |
| --- | --- | --- | --- | --- |
| GET | /api/myapps/GetAllApps | {tenant}.{tenant}.office.com | unspecified | host-out-of-scope |
| GET | /api/myapps/GetAppDataCache | {tenant}.{tenant}.office.com | unspecified | host-out-of-scope |
| GET | /api/shell/navbardata | {tenant}.{tenant}.office.com | unspecified | host-out-of-scope |
| GET | /api/storage/SystemMetadata/User/AppsPinnedData | {tenant}.{tenant}.office.com | unspecified | host-out-of-scope |
| GET | /api/v1/livepersonacard/configuration | {tenant}.{tenant}.office.com | unspecified | host-out-of-scope |
| GET | /config/v1/Oneshell/1.0.0.0 | ecs.office.com | security-copilot | host-and-path-out-of-scope |
| GET | /config/v1/YammerClients/0.0.1 | ecs.office.com | security-copilot | host-and-path-out-of-scope |
| GET | /files/fabric-cdn-prod_20240228.001/assets/animations/flair/flair.min.js | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-0-467ee27f.woff | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-13-c3989a02.woff | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-4-a656cc0a.woff | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-a13498cf.woff | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /owamail/20260731008.07/resources/boot-analytics-ping.js | [redacted-host] | unspecified | host-and-path-out-of-scope |
| GET | /shellux/allthemes.f44d6be8e52ee17eaf666a1fbe1b6647.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /shellux/en/shellstrings.9347b6944f1c0aa9589691e018242245.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /teams-js/validDomains/json/validDomains.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /user/v1.0/web/policies | clients.config.office.net | unspecified | host-and-path-out-of-scope |
| GET | /v1.0/users/{id}/photo/$value | graph.microsoft.com | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/adminSettings.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/common.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/firstRunExperience.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/group.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/groupAgent.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/home.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/insights.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/leadership.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/list.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/m365Copilot.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/navigation.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/notifications.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/panes.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/pushNotificationsSettings.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/reactionsAccentColor.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/search.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/skiplink.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/suiteHeader.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/survey.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/teams.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/userSettings.json | {tenant}.{tenant}.office.net | unspecified | host-and-path-out-of-scope |

## Adjacent confirmed safety-classification candidates requiring scope assignment
| Method | normalizedPath | hostFamily | matchingSpecIds | scopeReasons |
| --- | --- | --- | --- | --- |
| POST | /api/v1/yamalytics/webui | [redacted-host] | unspecified | host-out-of-scope |
| POST | /api/v2/events | [redacted-host] | unspecified | host-out-of-scope |
| POST | /api/v2/personacards/preparePersona | {tenant}.{tenant}.{tenant}.office.com | unspecified | host-out-of-scope |
| POST | /api/v3/events | [redacted-host] | unspecified | host-out-of-scope |
| POST | /Collector/3.0 | {tenant}.{tenant}.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| POST | /OneCollector/1.0 | {tenant}.{tenant}.{tenant}.microsoft.com | unspecified | host-and-path-out-of-scope |
| POST | /organizations/{id}/v2.0/token | {tenant}.microsoftonline.com | unspecified | host-and-path-out-of-scope |
| POST | /owa/{id}/startupdata.ashx | {tenant}.office.com | unspecified | host-and-path-out-of-scope |
| PUT | /api/settings/theme | {tenant}.{tenant}.office.com | unspecified | host-out-of-scope |

## Adjacent successful probes requiring scope assignment
- None

## Adjacent bundle-only leads requiring scope assignment
- None

## Suggested owner actions
- Assign adjacent candidates with explicit `matchingSpecIds` to the owning Teams-related spec families first.
- Resolve remaining `unspecified` entries by host-family ownership and assign one explicit target spec before any promotion review.
- Keep 42 bundle-only leads in a separate targeted validation pass; do not promote without explicit host/spec confirmation.

