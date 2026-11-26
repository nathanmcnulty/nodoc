# Offline Defender incident read client

This example completes a read-only task from the published, bundled Defender
XDR contract: fetch an incident by `IncidentId`, then fetch its associated
alerts using the documented `incidentId` query parameter. It loads the spec via
`buildSpecInventory()` and `loadBundledSpecification()`; request paths,
parameters, response status/media checks, and response-shape validation come
from that contract.

Run the end-to-end acceptance against the loopback mock server:

```powershell
node --test tools/tests/read-only-client-acceptance.test.mjs
```

Or run the sample to print the synthetic result and per-operation evidence
report:

```powershell
node tools/clients/defender-incident-readonly/demo.mjs
```

`synthetic-examples.json` is authored synthetic data, not a capture. The mock
server binds only to `127.0.0.1`; the client accepts only an HTTP loopback base
URL, omits credentials, rejects redirects, and refuses every operation whose
published method is not `GET`. No token, tenant, or live network access is used.
The report keeps declared contract details separate from typed observed
behavior evidence. Synthetic status codes and bodies do not count as observed
behavior; unrecorded auth, status/media, errors, pagination, concurrency, and
async behavior remain `unknown`.

This is offline client acceptance only. **Live acceptance against a signed-in
tenant remains pending and owner-gated.** Do not treat this example, its
synthetic fixtures, or a passing test as authorization or evidence of live
compatibility.
