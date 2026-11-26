import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { archiveDirectory } from "./private-capture-store.mjs";

const usage = "node tools/measure-private-storage.mjs --directory <absolute-private-capture> [--directory <next-capture>] [--usd-per-gib-month <rate>]";

export async function measurePrivateStorage(directories, usdPerGiBMonth) {
  if (!Array.isArray(directories) || !directories.length) throw new Error("Provide at least one private capture directory.");
  if (usdPerGiBMonth !== undefined && (!Number.isFinite(usdPerGiBMonth) || usdPerGiBMonth < 0)) throw new Error("Invalid capacity rate.");

  const keys = new Set(), versions = new Set();
  let sourceFiles = 0, sourceBytes = 0, payloadBytes = 0, manifestBytes = 0, archivePutCalls = 0;
  const sink = {
    put(key, bytes) {
      archivePutCalls++;
      if (keys.has(key)) return;
      keys.add(key);
      if (key.startsWith("archives/")) {
        const manifest = JSON.parse(bytes);
        versions.add(manifest.schemaVersion);
        sourceFiles += manifest.entries.length;
        sourceBytes += manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
        manifestBytes += bytes.length;
      } else {
        payloadBytes += bytes.length;
      }
    },
  };
  for (const [index, directory] of directories.entries()) {
    // Each directory represents a distinct run, not a retry of the previous run.
    const runId = directories.length === 1 ? "offline-measurement" : `offline-measurement-${index + 1}`;
    await archiveDirectory(sink, directory, { runId, sourceRevision: "0".repeat(40), planDigest: "0".repeat(64) });
  }
  const retainedBytes = payloadBytes + manifestBytes;
  return {
    snapshots: directories.length, archiveVersions: [...versions], sourceFiles, sourceBytes,
    uniqueBlobs: keys.size, payloadBytes, manifestBytes, retainedBytes, archivePutCalls,
    ...(usdPerGiBMonth === undefined ? {} : { usdPerGiBMonth, estimatedCapacityUsdPerMonth: retainedBytes / 2 ** 30 * usdPerGiBMonth }),
  };
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: {
      directory: { type: "string", multiple: true }, "usd-per-gib-month": { type: "string" }, help: { type: "boolean" },
    } }));
  } catch { throw new Error(usage); }
  if (values.help) { console.log(usage); return; }
  const rate = values["usd-per-gib-month"];
  if (!values.directory?.length || (rate !== undefined && (!rate.trim() || !Number.isFinite(Number(rate)) || Number(rate) < 0))) throw new Error(usage);
  let result;
  try {
    result = await measurePrivateStorage(values.directory, rate === undefined ? undefined : Number(rate));
  } catch {
    // Filesystem errors can include private filenames. Don't print them or partial totals.
    throw new Error("Cannot measure the archive. Check private path, permissions, file types and archive limits.");
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
