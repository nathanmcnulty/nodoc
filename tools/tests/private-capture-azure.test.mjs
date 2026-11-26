import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { PrivateBlobStore } from "../private-capture-store.mjs";

// Public synthetic emulator key, never accepted by the production managed-identity factory.
const key = Buffer.from("nodoc-synthetic-storage-test-key-only").toString("base64");

test("Azure SDK against loopback Azurite verifies immutable upload, readback and cross-client leases", {
  skip: process.env.NODOC_AZURITE !== "1",
}, async () => {
  const service = new BlobServiceClient("http://127.0.0.1:10000/nodocsynthetic",
    new StorageSharedKeyCredential("nodocsynthetic", key),
    { retryOptions: { maxTries: 2, tryTimeoutInMs: 3000 } });
  const container = service.getContainerClient(`synthetic-${randomUUID()}`);
  await container.create();
  try {
    const first = new PrivateBlobStore(container), second = new PrivateBlobStore(container);
    await first.put("objects/synthetic", Buffer.from("synthetic-only"));
    await first.put("objects/empty", Buffer.alloc(0));
    assert.equal((await second.get("objects/empty")).length, 0);
    await second.put("objects/synthetic", Buffer.from("synthetic-only"));
    await assert.rejects(second.put("objects/synthetic", Buffer.from("conflict")), /readback mismatch/);
    const lease = await first.acquire();
    try {
      await assert.rejects(second.acquire(), /lease unavailable/);
      await lease.renew();
    } finally { await lease.release(); }
    const next = await second.acquire();
    await next.release();
    assert.equal(await first.get("objects/missing"), null);
  } finally { await container.delete(); }
});
