import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const maxUsageBytes = 128 * 1024;

export function parseUsageReceipt(bytes) {
  try {
    if (Buffer.byteLength(bytes) > maxUsageBytes) throw new Error();
    const receipt = JSON.parse(bytes);
    // These are the final-usage fields documented by Copilot CLI 1.0.116's `help billing`.
    // Preserve provider units and opaque metrics, not an invented USD conversion.
    if (!receipt || Array.isArray(receipt) || typeof receipt !== "object"
      || !Object.hasOwn(receipt, "totalNanoAiu")
      || !(receipt.totalNanoAiu === null || (Number.isSafeInteger(receipt.totalNanoAiu) && receipt.totalNanoAiu >= 0))
      || !Number.isFinite(receipt.totalPremiumRequestCost) || receipt.totalPremiumRequestCost < 0
      || !receipt.modelMetrics || typeof receipt.modelMetrics !== "object"
      || !receipt.agentMetrics || typeof receipt.agentMetrics !== "object") throw new Error();
    return receipt;
  } catch {
    throw new Error("Missing, malformed or oversized private provider usage receipt; cost remains unknown.");
  }
}

export async function readUsageBytes(file) {
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.nlink !== 1) throw new Error();
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino
      || stat.size > maxUsageBytes) throw new Error();
    const buffer = Buffer.alloc(maxUsageBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (!length || length > maxUsageBytes) throw new Error();
    return buffer.subarray(0, length);
  } catch {
    throw new Error("Missing, malformed or oversized private provider usage receipt; cost remains unknown.");
  } finally {
    await handle?.close();
  }
}

export function usageBlobUrl(containerSas, id) {
  let url;
  try { url = new URL(containerSas); } catch {
    throw new Error("Use an HTTPS private Azure Blob container SAS with create, but no read/list permission.");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password
    || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/u.test(url.hostname)
    || !/^\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/?$/u.test(url.pathname)
    || !url.searchParams.has("sig") || url.searchParams.get("sr") !== "c"
    || url.searchParams.get("sp") !== "c"
    || !/^[0-9a-f-]{36}$/u.test(id)) {
    throw new Error("Use an HTTPS private Azure Blob container SAS with create, but no read/list permission.");
  }
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/monthly-usage/${id}.json`;
  return url;
}

export async function storeUsage(bytes, containerSas, { request = fetch, id = randomUUID() } = {}) {
  parseUsageReceipt(bytes);
  const url = usageBlobUrl(containerSas, id);
  try {
    const response = await request(url, { method: "PUT", redirect: "error",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/json", "If-None-Match": "*" },
      body: bytes, signal: AbortSignal.timeout(30_000) });
    if (response.status !== 201) throw new Error(`Azure storage returned HTTP ${response.status}.`);
  } catch {
    // Fetch errors can include the signed URL. Do not print it into public Actions logs.
    throw new Error("Private usage upload failed; verify SAS expiry, permissions and storage network policy.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || !process.env.NODOC_USAGE_BLOB_SAS_URL) throw new Error("Usage file and NODOC_USAGE_BLOB_SAS_URL are required.");
    await storeUsage(await readUsageBytes(process.argv[2]), process.env.NODOC_USAGE_BLOB_SAS_URL);
    console.log("Private usage receipt preserved in Azure.");
  } catch {
    console.error("Private usage preservation failed; nothing may be published. Verify receipt and storage configuration privately.");
    process.exitCode = 1;
  }
}
