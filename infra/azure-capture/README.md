# Azure private capture host

This is an **undeployed, manual-trigger infrastructure template** with a
buildable capture image, private Blob archive/restore adapter and separately
reviewed coverage publisher. Nothing has been deployed or scheduled. No portal
session, secrets or CI-to-Azure identity has been provisioned. Offline tests
and a container build do not qualify unattended portal capture.

## Resources and boundaries

- A Container Apps managed environment hosts a single manual Job. Each execution
  has one replica, no automatic retries and a one-hour timeout. Separate manual
  starts can overlap, so the runtime also holds a renewable 60-second Blob
  lease shared by all captures in the container. A failed renewal stops the
  active subprocess tree; a conflicting start fails rather than stealing it.
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
- Log Analytics is **off by default** (`enableLogAnalytics=false`) to avoid
  routine ingestion costs. Bounded driver diagnostics and evidence are still
  archived privately in Blob; platform console/system logs are not retained
  there. Opt in for operational troubleshooting when needed; the workspace
  then retains job logs for 30 days. Container Apps uses the workspace
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
   example image reference is a placeholder. Build the supplied Dockerfile,
   review the resulting image and publish it to an approved registry before
   supplying its immutable digest.
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
Use a narrowly scoped operator role. The optional GitHub OIDC integration below
starts the job without giving it any GitHub credential.

## Low-cost manual CI orchestration

`.github/workflows/private-capture.yml` is separate from monthly public review
and publication. It has **no schedule**, no AI, no artifact upload and no
GitHub write permission. It runs only from `main`, after the repository
variable `NODOC_PRIVATE_CAPTURE_ENABLED` is explicitly set to `true`. Nothing
in this increment enables it.

After deployment and browser qualification, an owner must configure the
`private-capture` GitHub environment with required reviewers, main-only
deployment restrictions and variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `CAPTURE_JOB_ID` (the full ARM job resource ID).
Create a federated OIDC trust bound to that repository/environment and grant
the CI identity only the job read/start and execution read operations at that
job's scope. It needs no Blob, vault, registry or GitHub write permission.
These grants are owner steps, not provisioned by this template. Starting a job
is nevertheless sensitive: Azure's start API supports overrides, so its
principal is effectively trusted to use the job identity. GitHub environment
protection and restricted workflow changes are essential, not a substitute for
Azure authorization.

The dispatch input is only the approved plan SHA-256. The script checks the
job's configured plan, immutable image reference, manual trigger, single
replica, no retries and bounded timeout before issuing **one start without
overrides**. It polls for at most 65 minutes; each Azure CLI call is bounded
to 60 seconds, and the execution template must report the same plan and image
before success is accepted. A concurrent Azure configuration edit can still
race the start; a detected mismatch fails without claiming capture success
or retrying. CLI output and configuration are never echoed. It does not stage
plans, modify resources, read secrets or publish coverage. A successful Azure
execution is not a fresh-coverage or tenant-authentication claim; inspect the
private completed receipt and perform independent review.

Cancellation, transport failure or timeout does **not** prove the Azure job
stopped. Inspect its executions and private claim before another dispatch.
No automatic restart or retry is attempted. CI concurrency complements rather
than replaces the runtime's Blob lease.

Jobs are manual and have no idle capture replicas. Consumption grants are
subscription-wide, not a promise of zero cost; running replicas, Blob requests,
storage/version/soft-delete overhead, optional logs and CI minutes can still
be billed. No paid registry, private endpoint or dedicated workload profile is
added. The existing 2-vCPU/4-GiB limit is retained until a real browser pilot
justifies downsizing; lowering it without measuring could break capture.

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

The runtime uses `AZURE_CLIENT_ID` for managed identity and
the `CAPTURE_BLOB_SERVICE_URL`, `CAPTURE_BLOB_CONTAINER` and
`CAPTURE_KEY_VAULT_URI` environment variables. Key Vault is reserved for a
separately approved authentication integration; the runtime does not fetch
secrets or bootstrap a login. `CAPTURE_PLAN_DIGEST` selects a private plan whose
bytes must match that SHA-256. The public job environment contains no plan body.

### Build and provide the browser session

From a clean checkout, build a local image (this does not publish or deploy it):

```powershell
$revision = git rev-parse HEAD
docker build --build-arg "SOURCE_REVISION=$revision" -f infra\azure-capture\Dockerfile -t nodoc-capture:local .
```

The image has Node, Chromium and the existing discovery tools. It runs as an
unprivileged user with read-only application files, and writes only under
`/work`. Its entrypoint **attaches** to an already prepared Chromium target on
`127.0.0.1:9222`; it does not launch or authenticate a browser. A privately
operated browser can share the container network namespace (or be an approved
sidecar). The template does not provision that session/sidecar. Never expose
unauthenticated CDP publicly, copy a normal desktop browser profile, disable
Chromium's sandbox to get past a failure, or weaken MFA/Conditional Access.
Provisioning and acceptance of this authenticated browser are still owner-gated.

### Private plan and execution

Keep the following plan in an owner-controlled private file outside Git.
Every value below is an example, not approval or a usable tenant session:

```json
{
  "schemaVersion": 1,
  "runId": "approved-cycle-unique-id",
  "sourceRevision": "0000000000000000000000000000000000000000",
  "specId": "m365-admin",
  "recipe": "tools/capture-recipes/m365-admin-deep.json",
  "recipeSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "tenantId": "00000000-0000-0000-0000-000000000000",
  "targetId": "approved-chromium-target-id",
  "timeoutSeconds": 900
}
```

Use the image's exact source revision and the SHA-256 of the approved recipe
bytes. `tenantId` is an **operator-supplied audit label**, not proof of the
browser's active tenant. Independently confirm the active tenant and the
recipe-specific identity controls before approving the plan. The runner binds
the exact tab and preserves the existing recipe, approval, auth, action-budget
and read-only-operation checks. A plan neither renews an expired approval nor
permits writes. A target ID from an old browser is not silently replaced.

On an approved operator workstation, explicitly select Azure CLI authentication
and the approved storage target (the default in the job is managed identity):

```powershell
$env:CAPTURE_AUTH = 'azure-cli'
$env:CAPTURE_BLOB_SERVICE_URL = 'https://<approved-account>.blob.core.windows.net'
$env:CAPTURE_BLOB_CONTAINER = 'capture-private'
npm run capture:private -- --stage --plan C:\private\approved-plan.json
```

Set the returned digest as `capturePlanDigest` in the private deployment
parameters. The runtime rechecks the source and recipe digests before capture.
It invokes the existing bounded discovery driver, then `runPortfolioRefresh`
on a completed capture. The assessment uses the actual inventory assessment
time; observation timestamps still come from the evidence, never the clock
of a later website build.

The image runs no model. Optional Luna review and usage accounting remain the
separate workflow documented in `MONTHLY_AUTOMATION.md`. No cost estimate is
substituted for actual model accounting.

### Durable receipts, recovery and limits

All objects use create-only writes and are downloaded and compared before
success is acknowledged. Identical retries are accepted; different content at
an existing key is rejected. The container must disallow anonymous access.
Production access uses HTTPS plus Entra authentication, not storage keys/SAS.
Object requests have bounded retries and timeouts. Archives allow at most
2,000 regular files, 64 MiB per file and 256 MiB total, including binary and
empty files; symlinks, traversal and ambiguous Windows names are rejected.

New archives use a `schemaVersion: 2` manifest (bounded to 2 MiB). Each file
keeps its original byte count and SHA-256 and declares
`storage: {version: 1, codec, bytes, sha256}` for the stored representation.
Gzip level 6 is used only when smaller than the original; otherwise `identity`
stores the exact original bytes. Objects live under
`objects/v2/<codec>/<stored-sha256>`; identical representations are shared.
Legacy `schemaVersion: 1` manifests and raw `objects/<sha256>` restore without
rewriting or migrating any existing evidence. Restore checks stored length and
hash, bounds decompression by the declared original length (also subject to the
64-MiB/256-MiB limits), then checks original length and hash. Unknown encoding
versions/codecs, truncation and integrity failures block restore.

The CLI reports numeric archive accounting, including on restored/reused runs:
`rawBytes` is the logical sum of original files; `storedBytes` is the logical
sum after encoding; `uniqueStoredBytes` counts each referenced object once;
`objectCount` counts distinct objects; `manifestBytes` is the exact manifest
length. These are retained payload sizes, **not incremental uploads, Azure
billing or cross-run totals**. Plans, run markers, locks, older shared objects,
Blob metadata, versions and soft-deleted data are additional storage. Create-only
upload plus readback also incurs requests even for already stored objects.

Retain all lossless evidence needed for restoration and audit. There is no
automatic deletion/lifecycle rule: old content-addressed objects can still be
referenced by newer manifests. A future owner-approved cleanup must first mark
all objects referenced by every retained manifest/receipt, account for backups
and interrupted runs, then review any unreferenced candidates before deletion.
Deleting objects simply by creation age would silently break retained archives.
Compression is not anonymization.

The evidence directory is for discovery outputs only. The driver receives
explicit capture, bundle-cache, ledger and refresh paths and a restricted
environment, not CI tokens or managed-identity configuration. Its `HOME`,
`USERPROFILE`, `TEMP`, `TMP` and `TMPDIR` point to an isolated temporary sibling
of the evidence root, removed when the driver/analysis stops. Before archival,
the job rejects unexpected top-level content; only `capture`, `bundle-cache`,
`refresh-cache`, `refresh`, `ledger.jsonl`, bounded driver logs/errors and the
cloud receipt are accepted. Keep any browser
profile, credential or authentication scratch files in a **separate sibling
directory outside that evidence root**; this job still creates none. The
archive walks the allowed output roots recursively, so never place authentication
material there or treat it as an authentication working directory.

Before invoking a driver, `runs/<runId>/started.json` claims the exact plan.
After the driver stops, its output, bounded private diagnostics, refresh
analysis and cloud receipt are archived by content digest. Only then is
`completed.json` written. A successful capture still requires independent
review; a complete archive can contain a **blocked** capture.

These are **phase-boundary checkpoints**, not continuous browser-state backups.
Hard loss of a runner during capture can lose its unfinished local files.
A started run with no completion becomes `interrupted-run-requires-review`;
it is never automatically recaptured. If the local directory survives an
upload failure, `--recover` uploads it without invoking the browser again:

```powershell
npm run capture:private -- --plan C:\private\approved-plan.json --directory C:\private\retained-run --recover
```

Recovery requires the retained cloud receipt and original matching source.
If the files are gone, preserve the claim, record the blocker and obtain
explicit approval for any new run ID; changing the ID is not automatic retry.
Restore a completed archive on another approved private host without starting
any browser or requiring the old source checkout:

```powershell
npm run capture:private -- --plan-digest <digest> --directory C:\private\restored-run --restore
```

Restoration revalidates the plan/manifest/file hashes, handles empty files, and
refuses to replace different local content. Originals and cloud objects are
not deleted. Storage versioning and retention are additional protections, not
substitutes for independent backups.

### Independent review and public projection

Restore the private output and inspect the capture, integrity checks, tenant
context and refresh report. Use a clean checkout of the capture source revision.
Prepare the allowlisted projection and a **pending** review outside Git:

```powershell
npm run publish:capture-coverage -- --input C:\private\restored-run\refresh\refresh-report.json --output C:\private\coverage-review
```

An independent reviewer must inspect both the private report and `snapshot.json`
and change `review.json`'s decision to `approved` only after accepting them.
This local receipt is an operator attestation, not cryptographic proof of a
reviewer's identity. Do not accept it from an untrusted capture or model, and
do not grant the capture job a GitHub publishing credential.

On the separately authorized publishing host, set `GITHUB_REPOSITORY` and
`GH_TOKEN`, then explicitly publish:

```powershell
npm run publish:capture-coverage -- --input C:\private\restored-run\refresh\refresh-report.json --review C:\private\coverage-review\review.json --publish
```

The publisher binds approval to the exact private input bytes, public projection
and source commit. It rejects incomplete/blocked reports. Only the dated public
snapshot, its aggregate Markdown report and regenerated coverage module enter
`automation/capture-coverage-YYYY-MM-DD`. Existing dated assessments and review
branches are never overwritten. Open a PR for normal CI/review; no main push,
automatic PR approval, merge or specification mutation occurs.

The public-source monthly workflow remains separate and does not download
private evidence. The container/transport/recovery tests are synthetic
qualification, including an isolated Azurite emulator; they do not establish
real Azure permissions, browser compatibility, correct tenant binding, live
recorder acceptance (M6), or two completed live monthly cycles.

## Teardown

Stop and verify all job executions, disable any separately configured trigger,
and export or retain approved private evidence and receipts first. The owner
can then delete the dedicated resource group using Azure's normal resource
group deletion process. Key Vault soft delete and purge protection retain the
vault for its configured period; storage soft delete, backups, logs, role
assignments and external credentials must also be reviewed under the retention
policy. Revoke separately granted permissions and rotate/revoke separately
provisioned credentials. Deletion is not a substitute for an evidence backup.
