# Azure private capture host

This is an **undeployed, manual-trigger infrastructure template**, not a
working unattended capture service. Nothing has been deployed. No schedule,
container image, portal session, secrets, CI-to-Azure identity or GitHub
publisher is provisioned. Building the template does not access Azure.

## Resources and boundaries

- A Container Apps managed environment hosts a single manual Job. Each execution
  has one replica, no automatic retries and a one-hour timeout. Separate manual
  starts can still overlap: the operator must serialize them.
- A user-assigned managed identity gets Storage Blob Data Contributor on only
  the private `capture-private` container and Key Vault Secrets User on only
  this vault. Blob contributor includes delete and overwrite, so it is not an
  append-only evidence store. No registry is provisioned or granted access;
  the supplied image must be publicly pullable.
- The storage account rejects anonymous blob access and shared-key
  authorization, requires HTTPS/TLS 1.2, and enables versioning plus 30-day
  blob and container soft delete. Private means authenticated, not
  network-isolated: the account and vault retain public network endpoints.
  Add owner-approved network restrictions/private endpoints and DNS before
  deployment if the tenant requires them; do not assume private networking.
- The RBAC-mode vault has 90-day soft delete and purge protection. Provisioning
  a secret and granting an operator write access are deliberately separate.
- Log Analytics retains job logs for 30 days. Container Apps uses the workspace
  ingestion shared key for this integration; it is passed directly to the
  environment, not output. Never log secrets, portal data or raw captures.
  Workspace access and retention need the same privacy review as evidence.

There is no budget resource or spending limit. The owner must establish and
monitor an appropriate Azure budget and alert separately. Versioning, retained
evidence, logs and running jobs incur costs even without a schedule.

## Required owner approvals before deployment

1. Select the Azure subscription, tenant, dedicated resource group and region;
   approve costs, a budget/alerts, retention and network exposure.
2. Approve an immutable, publicly pullable capture image and its supply chain,
   resource limits, execution timeout, and a concurrency/kill procedure. The
   example image is a placeholder, not a supplied runner.
3. Decide and approve a tenant sign-in and MFA/Conditional Access model for
   authenticated portal sessions. Managed identity authenticates to Azure,
   not to the Microsoft admin portals. Never bypass MFA or weaken policy.
4. Approve each scoped capture recipe and its evidence handling; do not renew
   observation dates or fabricate approvals.
5. Decide which credentials are needed, who provisions and rotates them in Key
   Vault, and who can operate the job and read private outputs. No secrets or
   real tenant identifiers belong in the repository or command history.
6. Approve the offline validation, independent review, public projection and
   publication process described below before any private capture begins.

The deployment principal needs permission to create the resources and the two
scoped role assignments. Job start can override an image or command: granting
start access effectively grants access to the job identity and its data.
Use a narrowly scoped operator role, and use GitHub OIDC if a separately
approved future CI integration starts the job. No such integration exists here.

## Validation and deployment

From the repository root, offline compilation and lint require Azure CLI and
Bicep:

```powershell
az bicep build --file infra/azure-capture/main.bicep --outfile "$env:TEMP/nodoc-azure-capture.json"
az bicep lint --file infra/azure-capture/main.bicep
az bicep build-params --file infra/azure-capture/main.bicepparam --outfile "$env:TEMP/nodoc-azure-capture-params.json"
```

`main.bicepparam` is an example containing placeholders only, not a deployable
configuration. After all approvals, the owner can supply approved non-secret
values in a local parameter file and run the following against an existing,
dedicated resource group. Keep the local parameter file out of Git; its `using`
path must point to `main.bicep`. Set the subscription explicitly. This command
creates resources and incurs charges; do not run it before approval.

```powershell
az account set --subscription "<approved-subscription>"
az deployment group create --resource-group "<approved-resource-group>" --parameters "<local-approved.bicepparam>"
```

## Capture and publication contract

The future approved image must use `AZURE_CLIENT_ID` for managed identity and
the `CAPTURE_BLOB_SERVICE_URL`, `CAPTURE_BLOB_CONTAINER` and
`CAPTURE_KEY_VAULT_URI` environment variables. It must persist raw evidence,
checkpoints, receipts and accounting only to the private blob container, fail
visibly on storage/authentication errors, and avoid sensitive stdout/stderr.
These environment variables are a contract, not an implemented uploader or
capture runner. Browser compatibility, durable checkpointing, limits, and
authentication still require implementation and an acceptance exercise.

After capture, run the existing offline evidence validation, independent
review and allowlisted public projection. Only reviewed, sanitized report
candidates or spec proposals may leave private storage. A separately approved
publisher or human pushes them to a monthly branch and opens a PR for normal
review; never push directly to main. The existing public-source monthly
workflow is separate and does not ingest private captures automatically.

## Teardown

Stop and verify all job executions, disable any separately configured trigger,
and export or retain approved private evidence and receipts first. The owner
can then delete the dedicated resource group using Azure's normal resource
group deletion process. Key Vault soft delete and purge protection retain the
vault for its configured period; storage soft delete, backups, logs, role
assignments and external credentials must also be reviewed under the retention
policy. Revoke separately granted permissions and rotate/revoke separately
provisioned credentials. Deletion is not a substitute for an evidence backup.
