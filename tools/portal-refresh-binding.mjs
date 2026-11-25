import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "./spec-quality-lib.mjs";
import { assertNoRefreshLinks } from "./portal-refresh-paths.mjs";

const execute = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Read-only binding for the actual checkout, including uncommitted final proposals.
export async function refreshSourceState() {
  const git = async args => (await execute("git", args, { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const sourceRevision = (await git(["rev-parse", "HEAD"])).trim();
  const files = [...new Set((await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean))].sort();
  const bindings = [];
  for (const file of files) {
    const filename = path.resolve(repoRoot, file);
    await assertNoRefreshLinks(filename);
    try { bindings.push([file, hash(await readFile(filename))]); }
    catch (error) { if (error.code !== "ENOENT") throw error; bindings.push([file, "deleted"]); }
  }
  if ((await git(["rev-parse", "HEAD"])).trim() !== sourceRevision) throw new Error("Source revision changed during binding.");
  return { sourceRevision, sourceStateDigest: hash(JSON.stringify({ sourceRevision, bindings })) };
}
