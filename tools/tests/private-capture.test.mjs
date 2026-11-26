import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PrivateBlobStore, archiveAccounting, archiveDirectory, jsonBytes, restoreArchive, sha256, validateStorageTarget } from "../private-capture-store.mjs";
import { captureArguments, executeCapture, restorePrivateCapture, runPrivateCapture, validateCapturePlan } from "../private-capture-job.mjs";
import { prepareCoverageReview, assertCoverageReview } from "../publish-capture-coverage.mjs";
import { publishReportFiles } from "../guarded-report-publication.mjs";

function memoryContainer() {
  const data = new Map();
  let leased = false;
  const client = {
    data,
    failUpload: null,
    getBlobClient: key => ({
      async download() {
        if (!data.has(key)) throw Object.assign(new Error("not found"), { statusCode: 404, code: "BlobNotFound" });
        const bytes = data.get(key);
        return { contentLength: bytes.length, readableStreamBody: Readable.from([bytes]) };
      },
      getBlobLeaseClient: () => ({
        async acquireLease() { if (leased) throw new Error("busy"); leased = true; },
        async renewLease() { if (!leased) throw new Error("lease lost"); },
        async releaseLease() { leased = false; },
      }),
    }),
    getBlockBlobClient: key => ({
      async uploadData(bytes, options) {
        assert.equal(options.conditions.ifNoneMatch, "*");
        if (client.failUpload?.(key)) throw new Error("synthetic storage outage");
        if (data.has(key)) throw Object.assign(new Error("exists"), { statusCode: 412 });
        data.set(key, Buffer.from(bytes));
      },
    }),
  };
  return client;
}

function plan(runId = "synthetic-cycle-one") {
  return { schemaVersion: 1, runId, sourceRevision: "a".repeat(40), specId: "m365-admin",
    recipe: "tools/capture-recipes/m365-admin-deep.json", recipeSha256: "b".repeat(64),
    tenantId: "00000000-0000-0000-0000-000000000000", targetId: "synthetic-target", timeoutSeconds: 15 };
}

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodoc-private-cycle-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("plans constrain command, source, bounds and explicit browser target", () => {
  validateCapturePlan(plan());
  for (const patch of [{ recipe: "../secret.json" }, { recipe: "tools/capture-recipes/../secret.json" },
    { timeoutSeconds: 2701 }, { tenantId: "" }, { targetId: "--argument" }, { command: "shell" }]) {
    assert.throws(() => validateCapturePlan({ ...plan(), ...patch }));
  }
  const args = captureArguments(plan(), path.resolve(os.tmpdir(), "private"));
  assert.equal(args[args.indexOf("--operation-ceiling") + 1], "observe-only");
  assert.equal(args[args.indexOf("--cdp-endpoint") + 1], "http://127.0.0.1:9222");
  assert.ok(!args.includes("--operation-approval-digest"));
  assert.ok(!args.includes("--no-ledger"));
  assert.equal(validateStorageTarget("https://examplestore.blob.core.windows.net", "capture-private"), "https://examplestore.blob.core.windows.net");
  for (const url of ["http://examplestore.blob.core.windows.net", "https://example.com", "https://examplestore.blob.core.windows.net/?sig=secret"]) {
    assert.throws(() => validateStorageTarget(url, "capture-private"));
  }
});

test("private immutable uploads verify readback, empty files and conflicting content", async () => {
  const container = memoryContainer(), store = new PrivateBlobStore(container);
  await store.put("objects/empty", Buffer.alloc(0));
  await store.put("objects/empty", Buffer.alloc(0));
  await assert.rejects(store.put("objects/empty", Buffer.from("different")), /readback mismatch/);
  assert.equal(container.data.get("objects/empty").length, 0);
  await store.put("objects/larger", Buffer.from("larger"));
  await assert.rejects(store.put("objects/larger", Buffer.from("x")), /readback mismatch/);
  assert.equal(container.data.get("objects/larger").toString(), "larger");
  container.failUpload = () => true;
  await assert.rejects(store.put("objects/new", Buffer.from("private-marker")), error => error.message === "Private blob upload failed.");
  const missing = await store.get("objects/missing");
  assert.equal(missing, null);
  await assert.rejects(store.get("../escape"), /read failed/);
});

test("archive restores exact binary/empty files, refuses corruption and conflicting restore", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  const source = path.join(root, "source"), restored = path.join(root, "restored");
  await mkdir(source);
  await writeFile(path.join(source, "empty.json"), "");
  await writeFile(path.join(source, "private.bin"), Buffer.from([0, 255, 128]));
  const binding = { runId: "synthetic", planDigest: "a".repeat(64) };
  const digest = await archiveDirectory(store, source, binding);
  await restoreArchive(store, digest, restored, binding);
  assert.deepEqual(await readFile(path.join(restored, "private.bin")), Buffer.from([0, 255, 128]));
  await restoreArchive(store, digest, restored, binding);
  await writeFile(path.join(restored, "private.bin"), "do not overwrite");
  await assert.rejects(restoreArchive(store, digest, restored, binding), /refused to overwrite/);
  await assert.rejects(restoreArchive(store, digest, path.join(root, "wrong-binding"), {}), /binding failed/);
  container.data.set(`objects/v2/identity/${sha256(Buffer.from([0, 255, 128]))}`, Buffer.from([4, 5, 6]));
  await assert.rejects(restoreArchive(store, digest, path.join(root, "corrupt"), binding), /integrity failed/);
});

test("versioned compression is lossless, smaller-only, deduplicated and accounts for retained bytes", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  const source = path.join(root, "source");
  await mkdir(source);
  const text = Buffer.from("synthetic evidence\n".repeat(10000)), binary = randomBytes(4096);
  for (const [name, bytes] of [["a.json", text], ["b.json", text], ["binary.bin", binary], ["empty", Buffer.alloc(0)]]) {
    await writeFile(path.join(source, name), bytes);
  }
  const binding = { runId: "synthetic-compression" };
  const legacyKey = `objects/${sha256(text)}`;
  container.data.set(legacyKey, text);
  const digest = await archiveDirectory(store, source, binding);
  assert.equal(await archiveDirectory(store, source, binding), digest);
  const manifest = await restoreArchive(store, digest, path.join(root, "restored"), binding);
  assert.equal(manifest.schemaVersion, 2);
  const entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  assert.equal(entries.get("a.json").storage.codec, "gzip");
  assert.equal(entries.get("binary.bin").storage.codec, "identity");
  assert.equal(entries.get("empty").storage.codec, "identity");
  assert.deepEqual(entries.get("a.json").storage, entries.get("b.json").storage);
  assert.deepEqual(await readFile(path.join(root, "restored", "a.json")), text);
  assert.deepEqual(await readFile(path.join(root, "restored", "binary.bin")), binary);
  const summary = archiveAccounting(manifest);
  assert.equal(summary.rawBytes, 2 * text.length + binary.length);
  assert.equal(summary.storedBytes, 2 * entries.get("a.json").storage.bytes + binary.length);
  assert.equal(summary.uniqueStoredBytes, entries.get("a.json").storage.bytes + binary.length);
  assert.equal(summary.objectCount, 3);
  assert.equal(summary.manifestBytes, container.data.get(`archives/${digest}.json`).length);
  assert.ok(summary.storedBytes < summary.rawBytes / 10);
  assert.deepEqual(container.data.get(legacyKey), text);
});

test("legacy manifests restore without conversion and report actual serialized bytes", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  const payload = Buffer.from("legacy evidence"), binding = { runId: "legacy" };
  const manifest = { schemaVersion: 1, binding, entries: [{ path: "legacy.json", bytes: payload.length, sha256: sha256(payload) }] };
  const bytes = Buffer.from(JSON.stringify(manifest)), digest = sha256(bytes);
  container.data.set(`archives/${digest}.json`, bytes);
  container.data.set(`objects/${sha256(payload)}`, payload);
  const restored = await restoreArchive(store, digest, path.join(root, "restored"), binding);
  assert.deepEqual(await readFile(path.join(root, "restored", "legacy.json")), payload);
  assert.equal(archiveAccounting(restored).manifestBytes, bytes.length);
  assert.equal(archiveAccounting(restored).uniqueStoredBytes, payload.length);
  assert.equal(container.data.size, 2);
});

test("compressed restore rejects unknown formats, bad hashes, truncation and decompression bombs", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  const payload = Buffer.alloc(1024 * 1024, 65), encoded = gzipSync(payload);
  const base = { path: "synthetic.json", bytes: payload.length, sha256: sha256(payload),
    storage: { version: 1, codec: "gzip", bytes: encoded.length, sha256: sha256(encoded) } };
  let index = 0;
  async function rejects(entry, stored, pattern) {
    const manifest = { schemaVersion: 2, binding: {}, entries: [entry] };
    const bytes = jsonBytes(manifest), digest = sha256(bytes);
    container.data.set(`archives/${digest}.json`, bytes);
    container.data.set(`objects/v2/${entry.storage.codec}/${entry.storage.sha256}`, stored);
    await assert.rejects(restoreArchive(store, digest, path.join(root, `bad-${index++}`), {}), pattern);
  }
  for (const patch of [{ version: 2 }, { codec: "brotli" }, { bytes: -1 }, { bytes: base.bytes + 1 }]) {
    await rejects({ ...base, storage: { ...base.storage, ...patch } }, encoded, /encoding/);
  }
  await rejects(base, Buffer.alloc(encoded.length), /integrity/);
  await rejects({ ...base, sha256: "0".repeat(64) }, encoded, /integrity/);
  await rejects({ ...base, bytes: encoded.length + 1 }, encoded, /decompression/);
  const truncated = encoded.subarray(0, encoded.length - 8);
  await rejects({ ...base, storage: { ...base.storage, bytes: truncated.length, sha256: sha256(truncated) } }, truncated, /decompression/);
  const broken = Buffer.from("not a gzip file");
  await rejects({ ...base, storage: { ...base.storage, bytes: broken.length, sha256: sha256(broken) } }, broken, /decompression/);
});

test("two synthetic cycles retain outcomes; restored retries never recapture", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  let calls = 0;
  const execute = async (_plan, directory) => {
    calls++;
    await mkdir(path.join(directory, "capture"));
    await writeFile(path.join(directory, "capture", "synthetic.json"), '{"synthetic":true,"observations":[]}');
    return { status: "blocked", reason: calls === 1 ? "authentication-required" : "rate-limited" };
  };
  for (const [index, reason] of ["authentication-required", "rate-limited"].entries()) {
    const selected = plan(`synthetic-cycle-${index}`);
    const options = { plan: selected, store, execute, verify: async () => {} };
    const first = await runPrivateCapture({ ...options, directory: path.join(root, `cycle-${index}`) });
    assert.equal(first.status, "blocked");
    assert.equal(first.reason, reason);
    assert.ok(first.storage.rawBytes > 0);
    const retry = await runPrivateCapture({ ...options, directory: path.join(root, `restored-${index}`) });
    assert.equal(retry.reused, true);
    assert.equal(retry.archiveDigest, first.archiveDigest);
    assert.deepEqual(retry.storage, first.storage);
    assert.deepEqual(await readFile(path.join(root, `restored-${index}`, "capture", "synthetic.json")), Buffer.from('{"synthetic":true,"observations":[]}'));
  }
  assert.equal(calls, 2);
});

test("interrupted upload cannot publish completion or replay a possibly executed capture", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  let calls = 0;
  const execute = async (_plan, directory) => {
    calls++;
    await mkdir(path.join(directory, "capture"));
    await writeFile(path.join(directory, "capture", "synthetic.json"), "{}");
    container.failUpload = key => key.startsWith("objects/");
    return { status: "capture-completed", reason: "independent-review-required" };
  };
  const options = { plan: plan(), store, execute, verify: async () => {} };
  await assert.rejects(runPrivateCapture({ ...options, directory: path.join(root, "first") }), /upload failed/);
  assert.equal(container.data.has(`runs/${plan().runId}/completed.json`), false);
  container.failUpload = null;
  const retry = await runPrivateCapture({ ...options, directory: path.join(root, "retry") });
  assert.equal(retry.reason, "interrupted-run-requires-review");
  assert.equal(calls, 1);
  await assert.rejects(runPrivateCapture({ ...options, plan: { ...plan(), sourceRevision: "f".repeat(40) }, directory: path.join(root, "conflict") }), /different plan/);
  const recovered = await runPrivateCapture({ ...options, directory: path.join(root, "first"), recover: true });
  assert.equal(recovered.status, "capture-completed");
  assert.equal(calls, 1);
  await restorePrivateCapture({ plan: plan(), store, directory: path.join(root, "off-machine-restore") });
  assert.equal(calls, 1);
});

test("unexpected authentication workspace content prevents archival and completion", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  const directory = path.join(root, "evidence");
  await assert.rejects(runPrivateCapture({
    plan: plan(), store, directory, verify: async () => {},
    execute: async (_plan, evidence) => {
      await mkdir(path.join(evidence, "browser-profile"));
      await writeFile(path.join(evidence, "passkey.json"), '{"synthetic":"not-a-real-credential"}');
      return { status: "blocked", reason: "authentication-required" };
    },
  }), /Unexpected evidence workspace/);
  assert.equal(container.data.has(`runs/${plan().runId}/completed.json`), false);
  assert.equal([...container.data.keys()].some(key => key.startsWith("objects/")), false);
});

test("driver home and temporary files are isolated outside evidence and removed", async t => {
  const root = await temporary(t), directory = path.join(root, "evidence"), driver = path.join(root, "driver.mjs");
  await mkdir(directory);
  await writeFile(driver, `
    import { writeFileSync } from "node:fs";
    writeFileSync(process.env.HOME + "/synthetic-auth.tmp", "synthetic");
    console.log(JSON.stringify({home: process.env.HOME, temp: process.env.TEMP,
      tmp: process.env.TMP, tmpdir: process.env.TMPDIR, azure: process.env.AZURE_CLIENT_ID ?? null}));
    process.exitCode = 1;
  `);
  const outcome = await executeCapture(plan(), directory, new AbortController().signal, { driver });
  assert.equal(outcome.status, "blocked");
  const runtime = JSON.parse((await readFile(path.join(directory, "driver-private.log"), "utf8")).trim());
  assert.equal(path.dirname(runtime.home), root);
  assert.notEqual(runtime.home, directory);
  assert.equal(runtime.home, runtime.temp);
  assert.equal(runtime.home, runtime.tmp);
  assert.equal(runtime.home, runtime.tmpdir);
  assert.equal(runtime.azure, null);
  await assert.rejects(readFile(path.join(runtime.home, "synthetic-auth.tmp")), { code: "ENOENT" });
});

test("capture lease prevents overlap and failed renewal aborts the active worker", async t => {
  const root = await temporary(t), container = memoryContainer(), store = new PrivateBlobStore(container);
  const lease = await store.acquire();
  await assert.rejects(runPrivateCapture({ plan: plan(), store, directory: path.join(root, "busy"), verify: async () => {} }), /lease unavailable/);
  await lease.release();
  let renewals = 0, observedAbort = false;
  const failingStore = Object.create(store);
  failingStore.acquire = async () => ({
    renew: async () => { if (++renewals > 1) throw new Error("lease-lost"); },
    release: async () => {},
  });
  await assert.rejects(runPrivateCapture({
    plan: plan(), store: failingStore, directory: path.join(root, "lost"), verify: async () => {}, renewalMs: 5,
    execute: async (_plan, _directory, signal) => {
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      observedAbort = true;
      return { status: "blocked", reason: "capture-cancelled" };
    },
  }), /lease-lost/);
  assert.equal(observedAbort, true);
});

test("real discovery driver returns a blocked receipt without bypassing recipe or browser gates", async t => {
  const root = await temporary(t), directory = path.join(root, "real-driver");
  await mkdir(directory);
  const result = await executeCapture(plan(), directory, new AbortController().signal);
  assert.equal(result.status, "blocked");
  const log = await readFile(path.join(directory, "driver-private.log"));
  assert.ok(log.length > 0);
  const run = JSON.parse(await readFile(path.join(directory, "capture", "discovery-run.json")));
  assert.equal(run.status, "blocked");
});

test("supervisor stops stalled or noisy synthetic subprocesses and retains bounded private diagnostics", async t => {
  const root = await temporary(t);
  for (const [name, source, reason] of [
    ["stall", "setInterval(() => {}, 1000);", "capture-timeout"],
    ["noise", "process.stdout.write(Buffer.alloc(5 * 1024 * 1024, 120)); setInterval(() => {}, 1000);", "diagnostic-budget-exhausted"],
  ]) {
    const driver = path.join(root, `${name}.mjs`), directory = path.join(root, name);
    await writeFile(driver, source);
    await mkdir(directory);
    const result = await executeCapture({ ...plan(), timeoutSeconds: name === "stall" ? 1 : 15 }, directory, new AbortController().signal, { driver });
    assert.equal(result.reason, reason);
    assert.ok((await readFile(path.join(directory, "driver-private.log"))).length <= 4 * 1024 * 1024);
  }
});

test("reviewed coverage publication binds source, input, projection and original assessment", () => {
  const measures = { currentObservations: 1, staleObservations: 0, notObserved: 0, errorObserved: 0, completeBodyObserved: 1, schemaGaps: 1, exampleGaps: 1 };
  const input = { schemaVersion: 1, mode: "report-only", asOf: "2026-11-06T12:00:00Z", freshnessDays: 30,
    blockers: [], captures: [{ specId: "nodoc-example", captureComplete: true }],
    portfolio: { summary: { specCount: 1, operationCount: 1, ...measures },
      specs: [{ specId: "nodoc-example", title: "PRIVATE-MARKER", operationCount: 1, freshness: measures }] } };
  const prepared = prepareCoverageReview(jsonBytes(input), "a".repeat(40), new Map([["nodoc-example", "Public example"]]));
  assert.equal(prepared.snapshot.assessedAt, input.asOf);
  assert.equal(prepared.review.decision, "pending");
  assert.ok(!JSON.stringify(prepared).includes("PRIVATE-MARKER"));
  assert.throws(() => assertCoverageReview(prepared.review, prepared.review), /Independent approval/);
  const approved = { ...prepared.review, decision: "approved" };
  assertCoverageReview(approved, prepared.review);
  for (const key of ["inputSha256", "snapshotSha256", "sourceRevision"]) {
    assert.throws(() => assertCoverageReview({ ...approved, [key]: "bad" }, prepared.review), /Independent approval/);
  }
  for (const patch of [{ blockers: [{ code: "missing" }] }, { captures: [] }, { captures: [{ captureComplete: false }] }]) {
    assert.throws(() => prepareCoverageReview(jsonBytes({ ...input, ...patch }), "a".repeat(40), new Map()), /complete, unblocked/);
  }
});

test("three-file coverage publication uses a real create-only Git remote", async t => {
  const root = await temporary(t), original = process.cwd();
  const remote = path.join(root, "remote.git"), checkout = path.join(root, "checkout");
  const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--bare", remote]);
  git(["init", checkout]);
  git(["config", "user.name", "synthetic"], checkout);
  git(["config", "user.email", "synthetic@example.invalid"], checkout);
  await writeFile(path.join(checkout, "base.txt"), "synthetic");
  git(["add", "."], checkout);
  git(["commit", "-m", "synthetic baseline"], checkout);
  git(["remote", "add", "origin", remote], checkout);
  const revision = git(["rev-parse", "HEAD"], checkout);
  const files = { "reports/coverage/2026-11-06.md": "synthetic report\n",
    "src/data/coverageSnapshots/2026-11-06.json": '{"synthetic":true}\n',
    "src/generated/publicCoverage.ts": "// synthetic\n" };
  try {
    process.chdir(checkout);
    const request = { branch: "automation/capture-coverage-2026-11-06", files, sourceRevision: revision, message: "synthetic coverage" };
    const result = await publishReportFiles(request);
    assert.equal(result.status, "pushed");
    assert.equal(git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], checkout), Object.keys(files).sort().join("\n"));
    git(["checkout", "--detach", revision], checkout);
    assert.equal((await publishReportFiles(request)).status, "unchanged");
    await assert.rejects(publishReportFiles({ ...request, files: { ...files, "reports/coverage/2026-11-06.md": "changed\n" } }), /different content/);
    const ref = `refs/heads/${request.branch}`;
    const candidate = git(["--git-dir", remote, "rev-parse", ref]);
    const tree = git(["rev-parse", `${candidate}^{tree}`], checkout);
    const setRemote = commit => git(["push", "--force", "origin", `${commit}:${ref}`], checkout);
    const rejectCandidate = async commit => {
      setRemote(commit);
      await assert.rejects(publishReportFiles(request), /already exists/);
      assert.equal(git(["--git-dir", remote, "rev-parse", ref]), commit);
    };
    const otherBase = git(["commit-tree", `${revision}^{tree}`, "-p", revision, "-m", "other base"], checkout);
    await rejectCandidate(git(["commit-tree", tree, "-p", otherBase, "-m", "wrong source"], checkout));
    await rejectCandidate(git(["commit-tree", tree, "-p", candidate, "-m", "extra commit"], checkout));
    git(["read-tree", tree], checkout);
    const blob = git(["rev-parse", `${candidate}:reports/coverage/2026-11-06.md`], checkout);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},unrelated.txt`], checkout);
    const unrelated = git(["commit-tree", git(["write-tree"], checkout), "-p", revision, "-m", "unrelated file"], checkout);
    git(["read-tree", revision], checkout);
    await rejectCandidate(unrelated);
    git(["read-tree", tree], checkout);
    git(["update-index", "--cacheinfo", `100755,${blob},reports/coverage/2026-11-06.md`], checkout);
    const wrongMode = git(["commit-tree", git(["write-tree"], checkout), "-p", revision, "-m", "wrong mode"], checkout);
    git(["read-tree", revision], checkout);
    await rejectCandidate(wrongMode);
    setRemote(candidate);
    assert.equal((await publishReportFiles(request)).status, "unchanged");
    assert.equal(git(["ls-remote", "origin", "refs/heads/main"], checkout), "");
  } finally { process.chdir(original); }
});
