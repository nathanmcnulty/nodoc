import assert from "node:assert/strict";
import { link, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishRefreshAnalysisCache } from "../portal-refresh.mjs";

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-refresh-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const entry = { schemaVersion: 1, cacheKey: "a".repeat(64), analysisDigest: "b".repeat(64), analysis: { visibility: "private-evidence-only", syntheticFixtureOnly: true } };

test("interrupted cache writes never publish partial JSON and an identical retry succeeds", async t => {
  const root = await temporary(t), cacheFile = path.join(root, `${entry.cacheKey}.json`);
  let partialWritten = false;
  await assert.rejects(publishRefreshAnalysisCache(cacheFile, entry, {
    write: async (handle, bytes) => {
      await handle.writeFile(bytes.slice(0, 19));
      partialWritten = true;
      await assert.rejects(readFile(cacheFile), { code: "ENOENT" });
      throw new Error("Synthetic interrupted cache write.");
    },
  }), /Synthetic interrupted cache write/u);
  assert.equal(partialWritten, true);
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(readFile(cacheFile), { code: "ENOENT" });
  await publishRefreshAnalysisCache(cacheFile, entry);
  assert.deepEqual(JSON.parse(await readFile(cacheFile, "utf8")), entry);
  assert.deepEqual(await readdir(root), [`${entry.cacheKey}.json`]);
});

test("cache publication exposes complete bytes only at promotion and preserves crash orphans", async t => {
  const root = await temporary(t), cacheFile = path.join(root, `${entry.cacheKey}.json`);
  // A terminated process may leave its own private temp file. It must neither
  // poison the final filename nor be deleted by the next writer's cleanup.
  const orphan = path.join(root, `${entry.cacheKey}.json.old-process.tmp`);
  await writeFile(orphan, '{"partial":');
  await publishRefreshAnalysisCache(cacheFile, entry, {
    promote: async (temporary, destination) => {
      await assert.rejects(readFile(destination), { code: "ENOENT" });
      assert.deepEqual(JSON.parse(await readFile(temporary, "utf8")), entry);
      await link(temporary, destination);
    },
  });
  assert.deepEqual(JSON.parse(await readFile(cacheFile, "utf8")), entry);
  assert.equal(await readFile(orphan, "utf8"), '{"partial":');
  assert.equal((await readdir(root)).length, 2);
});

test("publication never overwrites an existing valid or tampered cache entry", async t => {
  const root = await temporary(t);
  for (const [name, original] of [["valid", JSON.stringify(entry)], ["tampered", '{"truncated":']]) {
    const cacheFile = path.join(root, `${name}.json`);
    await writeFile(cacheFile, original);
    await assert.rejects(publishRefreshAnalysisCache(cacheFile, { ...entry, replacement: true }), { code: "EEXIST" });
    assert.equal(await readFile(cacheFile, "utf8"), original);
  }
  assert.deepEqual((await readdir(root)).sort(), ["tampered.json", "valid.json"]);
});
