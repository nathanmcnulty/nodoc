import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function usageBlobUrl(containerSas, id) {
  const url = new URL(containerSas);
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
  JSON.parse(bytes);
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
    await storeUsage(await readFile(process.argv[2], "utf8"), process.env.NODOC_USAGE_BLOB_SAS_URL);
    console.log("Private usage receipt preserved in Azure.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
