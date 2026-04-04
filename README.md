# nodoc

[![Postman Workspace](https://img.shields.io/badge/postman-dolphinlabs-ef5b25?logo=postman&logoColor=white)](https://www.postman.com/dolphinlabs/workspace/nodoc)
![GitHub License](https://img.shields.io/github/license/nathanmcnulty/nodoc)

_documenting undocumented interfaces_

nodoc is a project created by Dolphin Labs to enable deeper understanding and utilisation of undocumented APIs in cloud services. The project consists of OpenAPI specifications for APIs that were previously undocumented (at least publicly). By documenting these APIs, we hope to empower security teams to better understand the attack surface of these services and build safer tooling around real portal behavior.

## Coverage

The project currently publishes the following API definitions:

| API | Ops | Access model | Site page | Checked-in Postman collection |
| --- | ---: | --- | --- | --- |
| Defender | 459 | Portal session cookie (`sccauth`) | [Browse](https://nodoc.nathanmcnulty.com/defender) | `postman/collections/defender.collection.json` |
| M365 Admin | 213 | Portal session + custom admin headers | [Browse](https://nodoc.nathanmcnulty.com/m365-admin) | `postman/collections/m365-admin.collection.json` |
| Exchange | 61 | Portal session cookie + same-origin `x-requested-with` | [Browse](https://nodoc.nathanmcnulty.com/exchange) | `postman/collections/exchange-beta.collection.json` |
| SharePoint Admin | 41 | Portal session cookie (`FedAuth`) + SharePoint form digest | [Browse](https://nodoc.nathanmcnulty.com/sharepoint-admin) | `postman/collections/sharepoint-admin.collection.json` |
| Teams | 99 | Portal bearer token + same-origin portal context | [Browse](https://nodoc.nathanmcnulty.com/teams) | `postman/collections/teams.collection.json` |
| M365 Apps Config | 23 | Portal bearer token + diagnostic headers | [Browse](https://nodoc.nathanmcnulty.com/m-365-apps-config) | `postman/collections/m365-apps-config.collection.json` |
| M365 Apps Services | 8 | Portal bearer token + diagnostic headers | [Browse](https://nodoc.nathanmcnulty.com/m-365-apps-services) | `postman/collections/m365-apps-services.collection.json` |
| M365 Apps Inventory | 27 | Portal bearer token + diagnostic headers | [Browse](https://nodoc.nathanmcnulty.com/m-365-apps-inventory) | `postman/collections/m365-apps-inventory.collection.json` |
| Intune Autopatch | 52 | Portal bearer token + x-ms portal headers | [Browse](https://nodoc.nathanmcnulty.com/intune-autopatch) | `postman/collections/intune-autopatch.collection.json` |
| Intune Portal | 3 | Portal bearer token + same-origin portal context | [Browse](https://nodoc.nathanmcnulty.com/intune-portal) | `postman/collections/intune-portal.collection.json` |
| Purview | 85 | Portal session cookie (`sccauth`) | [Browse](https://nodoc.nathanmcnulty.com/purview) | `postman/collections/purview.collection.json` |
| Purview Portal | 6 | Portal session cookie (`sccauth`) + same-origin portal context | [Browse](https://nodoc.nathanmcnulty.com/purview-portal) | `postman/collections/purview-portal.collection.json` |
| Entra IAM | 286 | Delegated OAuth2 + `X-Ms-Client-Request-Id` | [Browse](https://nodoc.nathanmcnulty.com/entra-iam) | `postman/collections/entra-iam.collection.json` |
| Entra PIM | 16 | Azure AD bearer token | [Browse](https://nodoc.nathanmcnulty.com/entra-pim) | `postman/collections/entra-pim.collection.json` |
| Entra IGA | 17 | Azure AD bearer token | [Browse](https://nodoc.nathanmcnulty.com/entra-iga) | `postman/collections/entra-iga.collection.json` |
| Entra IDGov | 14 | Azure AD bearer token | [Browse](https://nodoc.nathanmcnulty.com/entra-id-gov) | `postman/collections/entra-idgov.collection.json` |
| Entra B2C | 5 | Azure AD bearer token + `tenantId` context | [Browse](https://nodoc.nathanmcnulty.com/entra-b-2-c) | `postman/collections/entra-b2c.collection.json` |

## Getting started

Start with the launch guide: [Getting Started](https://nodoc.nathanmcnulty.com/getting-started)

The short version:

1. Match the portal family to the right auth model before doing anything else.
2. Validate access with GET requests first.
3. Use the checked-in Postman collections or the Postman workspace to inspect requests before building automation.
4. Treat POST, PUT, PATCH, and DELETE as real writes unless you have confirmed otherwise in a safe tenant.

## Safety notes

- These are undocumented Microsoft portal APIs and may change without notice.
- Microsoft does not provide public support or compatibility guarantees for these interfaces.
- Prefer browser traffic inspection and request-shape capture before replaying state-changing operations.
- Use a non-production tenant for any request that could change configuration, policy, identity, billing, or review state.

## Usage

nodoc was designed to be fairly agnostic in how you consume the specification. This allows you to use whatever documentation, client SDK, or test suite, generation tools that you like. For example, the following tools could be used against the specifications:

- [AutoRest](https://github.com/Azure/autorest)
- [OpenAPI Generator](https://openapi-generator.tech/)
- [Insomnia](https://docs.insomnia.rest/insomnia/import-export-data)
- [Bruno](https://www.usebruno.com/)
- [Redocly](https://redocly.com/)

Currently, nodoc utilises OpenAPI 3.0.1 for specifications (see note in [roadmap](#roadmap)). These are typically done following a multi-file approach using [`$ref`](https://swagger.io/docs/specification/using-ref/) links. Bundled single-file definitions are produced during validation and collection-generation workflows for convenience and compatibility purposes.

To make things easier, we've published the OpenAPI definitions in a couple of different ways as detailed below.

### Website

The latest site published from this repository is accessible at [https://nodoc.nathanmcnulty.com](https://nodoc.nathanmcnulty.com). It is built using [Docusaurus](https://docusaurus.io/) and [Scalar](https://github.com/scalar/scalar). The files for the website are stored within this repository.

### Postman

Postman collections and API definitions can be found for all nodoc APIs within [this workspace](https://www.postman.com/dolphinlabs/workspace/nodoc). These are auto-generated from the specifications using [openapi-to-postman](https://github.com/postmanlabs/openapi-to-postman).

The repository also keeps checked-in collections under [`postman/collections/`](https://github.com/nathanmcnulty/nodoc/tree/main/postman/collections):

- they are generated from the specs
- they can be diffed and reviewed in pull requests
- they should not be edited by hand
- regenerate them with `npm run generate:postman`

## Roadmap

These are project wide roadmap items:

- [ ] Support [OpenAPI Links](https://swagger.io/docs/specification/links/)
- [ ] Migrate to OpenAPI 3.1 ([blocker](https://community.postman.com/t/unable-to-validate-this-definition-when-choosing-3-1-0/56871/2))
- [x] Improve Postman collection generation
- [ ] Build SDK packages
- [ ] Support additional API clients (e.g. Insomnia)

## Contribution

We welcome any contributions to this project. Please checkout the contributing guide [here](./CONTRIBUTING.md).

## Anything else?

If you're unsure of anything, please reach out through a GitHub issue and we'll be happy to help.
