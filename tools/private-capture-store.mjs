import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { addAbortSignal } from "node:stream";
import { assertNoRefreshLinks, privateRefreshDirectory } from "./portal-refresh-paths.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const digestPattern = /^[a-f0-9]{64}$/u;
export const archiveLimits = { files: 2000, fileBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 };

async function readPrivateFile(filename) {
  const chunks = [];
  let length = 0;
  for await (const chunk of createReadStream(filename)) {
    length += chunk.length;
    if (length > archiveLimits.fileBytes) throw new Error("Private artifact exceeds the file byte limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validKey(key) {
  if (typeof key !== "string" || key.length > 240 || !key.split("/").every(part =>
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/u.test(part) && !part.endsWith(".")
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error("Invalid private object key.");
  }
  return key;
}

export function validateStorageTarget(serviceUrl, container) {
  const url = new URL(serviceUrl);
  if (url.protocol !== "https:" || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/u.test(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/u.test(container ?? "") || container.includes("--")) {
    throw new Error("Use an explicit Azure Blob HTTPS account and private container, without a SAS URL.");
  }
  return url.origin;
}

export class PrivateBlobStore {
  constructor(container) { this.container = container; }

  async get(key, maximum = archiveLimits.fileBytes) {
    try {
      const signal = AbortSignal.timeout(30000);
      const response = await this.container.getBlobClient(validKey(key)).download(0, undefined, { abortSignal: signal });
      if (response.contentLength > maximum || !response.readableStreamBody) {
        response.readableStreamBody?.destroy();
        throw new Error("Invalid private blob length or stream.");
      }
      addAbortSignal(signal, response.readableStreamBody);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.readableStreamBody) {
        bytes += chunk.length;
        if (bytes > maximum) { response.readableStreamBody.destroy(); throw new Error("Private blob exceeds its bound."); }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error.statusCode === 404 && error.code === "BlobNotFound") return null;
      throw new Error("Private blob read failed.", { cause: error });
    }
  }

  async put(key, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > archiveLimits.fileBytes) throw new Error("Invalid private blob payload.");
    try {
      await this.container.getBlockBlobClient(validKey(key)).uploadData(bytes, {
        conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: "application/octet-stream" },
        abortSignal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (![409, 412].includes(error.statusCode)) throw new Error("Private blob upload failed.", { cause: error });
    }
    const restored = await this.get(key, bytes.length);
    if (!restored?.equals(bytes)) throw new Error("Private blob readback mismatch; existing data was not overwritten.");
  }

  async acquire() {
    await this.put("locks/live-browser", Buffer.from("nodoc-private-capture-v1\n"));
    const lease = this.container.getBlobClient("locks/live-browser").getBlobLeaseClient();
    try { await lease.acquireLease(60); }
    catch (error) { throw new Error("Private capture lease unavailable.", { cause: error }); }
    return {
      renew: async () => {
        try { await lease.renewLease({ abortSignal: AbortSignal.timeout(10000) }); }
        catch (error) { throw new Error("Private capture lease lost.", { cause: error }); }
      },
      release: async () => {
        try { await lease.releaseLease(); }
        catch (error) { throw new Error("Private capture lease release failed.", { cause: error }); }
      },
    };
  }
}

export async function openPrivateBlobStore(env = process.env) {
  const url = validateStorageTarget(env.CAPTURE_BLOB_SERVICE_URL, env.CAPTURE_BLOB_CONTAINER);
  const { ManagedIdentityCredential, AzureCliCredential } = await import("@azure/identity");
  const { BlobServiceClient } = await import("@azure/storage-blob");
  let credential;
  if (env.CAPTURE_AUTH === "azure-cli") credential = new AzureCliCredential();
  else if ((!env.CAPTURE_AUTH || env.CAPTURE_AUTH === "managed-identity") && env.AZURE_CLIENT_ID) {
    credential = new ManagedIdentityCredential({ clientId: env.AZURE_CLIENT_ID });
  } else throw new Error("Select managed identity with AZURE_CLIENT_ID, or explicitly select CAPTURE_AUTH=azure-cli.");
  const client = new BlobServiceClient(url, credential, {
    retryOptions: { maxTries: 3, tryTimeoutInMs: 15000, retryDelayInMs: 500 },
  }).getContainerClient(env.CAPTURE_BLOB_CONTAINER);
  try {
    const properties = await client.getProperties();
    if (properties.blobPublicAccess && properties.blobPublicAccess !== "none") throw new Error("Anonymous access is enabled.");
  } catch (error) { throw new Error("Private container verification failed.", { cause: error }); }
  return new PrivateBlobStore(client);
}

export async function archiveDirectory(store, directory, binding) {
  directory = await privateRefreshDirectory(directory);
  const entries = [];
  let totalBytes = 0;
  async function visit(relative = "") {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const key = validKey(relative ? `${relative}/${name}` : name);
      const filename = path.join(directory, key);
      await assertNoRefreshLinks(filename);
      const stat = await lstat(filename);
      if (stat.isDirectory()) { await visit(key); continue; }
      if (!stat.isFile() || stat.size > archiveLimits.fileBytes || entries.length >= archiveLimits.files) throw new Error("Private archive file limit or type rejected.");
      const bytes = await readPrivateFile(filename);
      const after = await lstat(filename);
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || bytes.length !== stat.size) throw new Error("Private artifact changed during archival.");
      totalBytes += bytes.length;
      if (totalBytes > archiveLimits.totalBytes) throw new Error("Private archive total byte limit exceeded.");
      const digest = sha256(bytes);
      await store.put(`objects/${digest}`, bytes);
      entries.push({ path: key, bytes: bytes.length, sha256: digest });
    }
  }
  await visit();
  const manifest = { schemaVersion: 1, binding, entries };
  const bytes = jsonBytes(manifest), digest = sha256(bytes);
  await store.put(`archives/${digest}.json`, bytes);
  return digest;
}

export async function restoreArchive(store, digest, directory, expectedBinding) {
  if (!digestPattern.test(digest)) throw new Error("Invalid private archive digest.");
  const bytes = await store.get(`archives/${digest}.json`, 1024 * 1024);
  if (!bytes || sha256(bytes) !== digest) throw new Error("Private archive manifest integrity failed.");
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length > archiveLimits.files
    || JSON.stringify(manifest.binding) !== JSON.stringify(expectedBinding)) throw new Error("Private archive binding failed.");
  const seen = new Set();
  let total = 0;
  for (const entry of manifest.entries) {
    validKey(entry.path);
    const folded = entry.path.toLowerCase();
    if (seen.has(folded) || !digestPattern.test(entry.sha256) || !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 0 || entry.bytes > archiveLimits.fileBytes) throw new Error("Invalid private archive entry.");
    seen.add(folded);
    total += entry.bytes;
  }
  for (const entry of manifest.entries) {
    const parts = entry.path.toLowerCase().split("/");
    while (parts.length > 1) {
      parts.pop();
      if (seen.has(parts.join("/"))) throw new Error("Conflicting private archive paths.");
    }
  }
  if (total > archiveLimits.totalBytes) throw new Error("Private archive total byte limit exceeded.");
  directory = await privateRefreshDirectory(directory, { create: true });
  for (const entry of manifest.entries) {
    const payload = await store.get(`objects/${entry.sha256}`, entry.bytes);
    if (!payload || payload.length !== entry.bytes || sha256(payload) !== entry.sha256) throw new Error("Private artifact integrity failed.");
    const filename = path.join(directory, entry.path);
    await assertNoRefreshLinks(filename);
    await mkdir(path.dirname(filename), { recursive: true });
    try { await writeFile(filename, payload, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await readPrivateFile(filename)).equals(payload)) throw new Error("Restore refused to overwrite a different local artifact.");
    }
  }
  return manifest;
}
