# Teams adjacent scope assignment backlog

Portal: Viva Engage
Source artifact: `teams-adjacent-scope-review.md`
Generated: 2026-08-08 18:45:01

## Host-family assignment matrix
| Host family | Adjacent candidate count | Matching-spec IDs seen | Assignment action |
| --- | --- | --- | --- |
| {tenant}.{tenant}.office.net | 29 | none | Needs owner assignment by host-family steward |
| {tenant}.{tenant}.office.com | 6 | none | Needs owner assignment by host-family steward |
| [redacted-host] | 4 | none | Needs owner assignment by host-family steward |
| {tenant}.{tenant}.{tenant}.microsoft.com | 2 | none | Needs owner assignment by host-family steward |
| ecs.office.com | 2 | security-copilot | Use explicit matchingSpecIds unless evidence updates the assignment |
| {tenant}.{tenant}.{tenant}.office.com | 1 | none | Needs owner assignment by host-family steward |
| {tenant}.microsoftonline.com | 1 | none | Needs owner assignment by host-family steward |
| {tenant}.office.com | 1 | none | Needs owner assignment by host-family steward |
| clients.config.office.net | 1 | none | Needs owner assignment by host-family steward |
| graph.microsoft.com | 1 | none | Needs owner assignment by host-family steward |

## Adjacent candidates requiring scope assignment
| Method | normalizedPath | hostFamily | evidenceBucket | matchingSpecIds | scopeReasons | assignmentNeeded |
| --- | --- | --- | --- | --- | --- | --- |
| GET | /api/myapps/GetAllApps | {tenant}.{tenant}.office.com | adjacent-confirmed-read | unspecified | host-out-of-scope | manual |
| GET | /api/myapps/GetAppDataCache | {tenant}.{tenant}.office.com | adjacent-confirmed-read | unspecified | host-out-of-scope | manual |
| GET | /api/shell/navbardata | {tenant}.{tenant}.office.com | adjacent-confirmed-read | unspecified | host-out-of-scope | manual |
| GET | /api/storage/SystemMetadata/User/AppsPinnedData | {tenant}.{tenant}.office.com | adjacent-confirmed-read | unspecified | host-out-of-scope | manual |
| GET | /api/v1/livepersonacard/configuration | {tenant}.{tenant}.office.com | adjacent-confirmed-read | unspecified | host-out-of-scope | manual |
| GET | /config/v1/Oneshell/1.0.0.0 | ecs.office.com | adjacent-confirmed-read | security-copilot | host-and-path-out-of-scope | confirm-or-update |
| GET | /config/v1/YammerClients/0.0.1 | ecs.office.com | adjacent-confirmed-read | security-copilot | host-and-path-out-of-scope | confirm-or-update |
| GET | /files/fabric-cdn-prod_20240228.001/assets/animations/flair/flair.min.js | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-0-467ee27f.woff | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-13-c3989a02.woff | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-4-a656cc0a.woff | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /files/fabric-cdn-prod_20241209.001/assets/icons/fabric-icons-a13498cf.woff | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /owamail/20260731008.07/resources/boot-analytics-ping.js | [redacted-host] | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /shellux/allthemes.f44d6be8e52ee17eaf666a1fbe1b6647.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /shellux/en/shellstrings.9347b6944f1c0aa9589691e018242245.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /teams-js/validDomains/json/validDomains.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /user/v1.0/web/policies | clients.config.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /v1.0/users/{id}/photo/$value | graph.microsoft.com | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/adminSettings.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/common.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/firstRunExperience.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/group.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/groupAgent.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/home.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/insights.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/leadership.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/list.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/m365Copilot.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/navigation.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/notifications.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/panes.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/pushNotificationsSettings.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/reactionsAccentColor.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/search.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/skiplink.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/suiteHeader.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/survey.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/teams.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| GET | /yammer/20260807001.9448944/yammer-locale/en-us/userSettings.json | {tenant}.{tenant}.office.net | adjacent-confirmed-read | unspecified | host-and-path-out-of-scope | manual |
| POST | /api/v1/yamalytics/webui | [redacted-host] | adjacent-safety-review | unspecified | host-out-of-scope | manual |
| POST | /api/v2/events | [redacted-host] | adjacent-safety-review | unspecified | host-out-of-scope | manual |
| POST | /api/v2/personacards/preparePersona | {tenant}.{tenant}.{tenant}.office.com | adjacent-safety-review | unspecified | host-out-of-scope | manual |
| POST | /api/v3/events | [redacted-host] | adjacent-safety-review | unspecified | host-out-of-scope | manual |
| POST | /Collector/3.0 | {tenant}.{tenant}.{tenant}.microsoft.com | adjacent-safety-review | unspecified | host-and-path-out-of-scope | manual |
| POST | /OneCollector/1.0 | {tenant}.{tenant}.{tenant}.microsoft.com | adjacent-safety-review | unspecified | host-and-path-out-of-scope | manual |
| POST | /organizations/{id}/v2.0/token | {tenant}.microsoftonline.com | adjacent-safety-review | unspecified | host-and-path-out-of-scope | manual |
| POST | /owa/{id}/startupdata.ashx | {tenant}.office.com | adjacent-safety-review | unspecified | host-and-path-out-of-scope | manual |
| PUT | /api/settings/theme | {tenant}.{tenant}.office.com | adjacent-safety-review | unspecified | host-out-of-scope | manual |

## Next action
- Review each host-family row and map to exactly one owning spec before any promotion pass.
- Keep rows with `matchingSpecIds` prefilled (`security-copilot`) as explicit unless evidence conflicts are discovered.
- Do not promote bundle-only leads here; handle separately in a targeted validation PR.
