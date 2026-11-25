import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./spec-quality-lib.mjs";

export function containsPath(root, filename) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function assertNoRefreshLinks(filename) {
  filename = path.resolve(filename);
  let current = path.parse(filename).root;
  for (const part of filename.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Refresh paths must not contain links."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return filename;
}

async function prospectiveRealPath(filename) {
  const missing = [];
  let current = path.resolve(filename);
  while (true) {
    try { return path.join(await realpath(current), ...missing.reverse()); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current)); current = parent;
    }
  }
}

export async function privateRefreshDirectory(directory, { create = false, readOnlyRoots = [] } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("Refresh directories must use absolute private paths.");
  await assertNoRefreshLinks(directory);
  // Resolve existing ancestors before comparing paths, including Windows 8.3 aliases.
  directory = await prospectiveRealPath(directory);
  // Validate every boundary before creating even an empty directory.
  if (containsPath(await realpath(repoRoot), directory)) throw new Error("Refresh output and capture data must remain outside the repository.");
  for (const root of readOnlyRoots) {
    await assertNoRefreshLinks(root);
    const canonicalRoot = await prospectiveRealPath(root);
    if (containsPath(canonicalRoot, directory) || containsPath(directory, canonicalRoot)) throw new Error("Refresh output must be separate from immutable capture inputs.");
  }
  await assertNoRefreshLinks(directory);
  if (create) await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) throw new Error("Refresh path is not a directory.");
  return realpath(directory);
}
