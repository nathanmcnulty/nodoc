# Specification Refresh Ledger

Canonical specifications: **20** | Operations: **2004** | Schemas: **588** | Explicit gaps: **115**

| ID | Operations | Schemas | Parity | Evidence | Readiness | Gaps |
| --- | ---: | ---: | --- | --- | --- | ---: |
| defender-xdr | 601 | 148 | complete | incomplete | incomplete | 1 |
| entra-b2c | 6 | 4 | complete | incomplete | incomplete | 0 |
| ibiza-iam | 286 | 73 | complete | incomplete | incomplete | 0 |
| entra-idgov | 17 | 6 | complete | incomplete | incomplete | 0 |
| entra-iga | 11 | 0 | complete | incomplete | incomplete | 1 |
| entra-pim | 16 | 6 | complete | incomplete | incomplete | 0 |
| exchange-beta | 61 | 10 | complete | incomplete | incomplete | 0 |
| intune-autopatch | 53 | 85 | complete | complete | complete | 0 |
| intune-portal | 5 | 8 | complete | complete | complete | 0 |
| m365-admin | 309 | 52 | incomplete | incomplete | incomplete | 103 |
| m365-apps-config | 24 | 20 | complete | incomplete | incomplete | 0 |
| m365-apps-inventory | 27 | 17 | complete | incomplete | incomplete | 0 |
| m365-apps-services | 9 | 13 | complete | incomplete | incomplete | 0 |
| power-platform | 248 | 0 | complete | complete | complete | 3 |
| purview | 134 | 68 | complete | incomplete | incomplete | 2 |
| purview-portal | 8 | 11 | complete | incomplete | incomplete | 1 |
| security-copilot | 42 | 19 | complete | incomplete | incomplete | 2 |
| sharepoint-admin | 42 | 18 | complete | incomplete | incomplete | 1 |
| teams | 100 | 21 | complete | incomplete | incomplete | 0 |
| viva-engage | 5 | 9 | complete | incomplete | incomplete | 1 |

Detailed operations, schemas, and evidence are emitted on demand with `npm run spec-refresh -- --spec <id> --details operations|schemas|evidence`.
