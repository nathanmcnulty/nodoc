import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResponseBodySidecar } from "./response-body-sidecars.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const publicDirectories = ["specifications", "postman", "src", "static", "build", "tools"];
const textExtensions = new Set([".yml", ".yaml", ".json", ".jsonc", ".md", ".txt", ".ts", ".tsx", ".js", ".mjs", ".html", ".css", ".csv"]);

function parsePrivateJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(`${label} is not valid JSON; contents remain private.`); }
}

export function jsonTokenType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Not a JSON number.");
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "object" && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Not a JSON object.");
  if (["string", "boolean", "object"].includes(typeof value)) return typeof value;
  throw new Error("Not a JSON value.");
}

// This checks only declared primitive/container types, never full schema validity.
// null means there is no supported declared type to compare; it is not a pass.
export function primitiveTypeCompatible(value, schema = {}) {
  if (schema.$ref || schema.oneOf || schema.anyOf || schema.allOf) return null;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (!types.length || types.some((type) => !["null", "object", "array", "string", "boolean", "integer", "number"].includes(type))) return null;
  const actual = jsonTokenType(value);
  return types.includes(actual) || (actual === "integer" && types.includes("number"))
    || (actual === "null" && schema.nullable === true);
}

// PRIVATE facts: paths can themselves contain tenant-specific dictionary keys.
// No scalar values are emitted. Empty collections never supply item types.
export function summarizeJsonTokens(value) {
  const fields = new Map();
  function visit(current, pointer, depth) {
    if (depth > 48 || fields.size > 10000) throw new Error("JSON shape exceeds the bounded inspection limit.");
    const type = jsonTokenType(current);
    const field = fields.get(pointer) ?? { pointer, types: new Set(), observations: 0, emptyCollectionObserved: false };
    field.types.add(type);
    field.observations++;
    if ((type === "array" && current.length === 0) || (type === "object" && Object.keys(current).length === 0)) field.emptyCollectionObserved = true;
    fields.set(pointer, field);
    if (type === "array") current.forEach((item) => visit(item, `${pointer}/*`, depth + 1));
    if (type === "object") {
      for (const [key, item] of Object.entries(current)) {
        visit(item, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, depth + 1);
      }
    }
  }
  visit(value, "", 0);
  return [...fields.values()].map((field) => ({
    ...field,
    types: [...field.types].sort(),
    nonNullTypes: [...field.types].filter((type) => type !== "null").sort(),
  }));
}

export async function inspectVerifiedResponse(artifactDir, record) {
  const body = await loadResponseBodySidecar({ artifactDir, evidenceId: record.evidenceId, descriptor: record.bodyCapture });
  return {
    schemaVersion: 1,
    visibility: "private-evidence-only",
    evidenceId: record.evidenceId,
    verifiedCompleteSidecar: true,
    facts: summarizeJsonTokens(parsePrivateJson(body, "Verified response")),
    limits: ["Observed types do not establish requiredness, minimum roles, standalone execution or full schema validity."],
  };
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (["node_modules", ".git"].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error("Symbolic link in scan tree; privacy coverage is incomplete.");
    if (entry.isDirectory() && !["node_modules", ".git"].includes(entry.name)) files.push(...await walk(name));
    else if (entry.isFile()) files.push(name);
    // Never follow symlinks into another public or private tree.
  }
  return files;
}

async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

// Include orphaned/failed-run physical bodies: privacy protection does not make
// those files admissible schema evidence. Digests and lengths never leave this process.
export async function scanPublicResponseFingerprints({ captureRoot, publicRoot = repoRoot }) {
  for (const root of [captureRoot, publicRoot]) {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Scan root must be a directory without symbolic links.");
  }
  const privateDigests = new Set();
  let privateFiles = 0;
  for (const file of await walk(captureRoot)) {
    if (path.basename(path.dirname(file)) !== "response-body-sidecars" || !file.endsWith(".body")) continue;
    privateDigests.add(await hashFile(file));
    privateFiles++;
  }
  if (!privateFiles) throw new Error("No private response bodies found; an empty privacy scan is not a pass.");
  const matches = [];
  let publicFiles = 0;
  const rootEntries = await readdir(publicRoot, { withFileTypes: true });
  if (rootEntries.some((entry) => path.extname(entry.name).toLowerCase() === ".md" && entry.isSymbolicLink())) throw new Error("Symbolic link in public Markdown; privacy coverage is incomplete.");
  const candidates = rootEntries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md")
    .map((entry) => path.join(publicRoot, entry.name));
  for (const directory of publicDirectories) {
    const absolute = path.join(publicRoot, directory);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error("Symbolic link in public root; privacy coverage is incomplete.");
      if (!info.isDirectory()) continue;
    }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    candidates.push(...(await walk(absolute)).filter((file) => !path.relative(publicRoot, file).replaceAll("\\", "/").startsWith("tools/tests/")));
  }
    for (const file of candidates) {
      if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
      publicFiles++;
      const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if ([...line.matchAll(/(?=([a-f0-9]{64}))/giu)].some(([, digest]) => privateDigests.has(digest.toLowerCase()))) {
          matches.push({ file: path.relative(publicRoot, file).replaceAll("\\", "/"), line: index + 1, reason: "private-response-fingerprint" });
        }
        if (/\b(?:complete|sanitized)\s+\d+[ -]bytes?\b|\b\d+[ -]bytes?\s+(?:sanitized|response)\b/iu.test(line)
          || /["']?(?:responseBodyByteLength|bodyByteLength|responseBytes)["']?\s*:\s*\d+/u.test(line)) {
          matches.push({ file: path.relative(publicRoot, file).replaceAll("\\", "/"), line: index + 1, reason: "public-response-length-metadata" });
        }
      }
  }
  if (!publicFiles) throw new Error("No public text files found; an empty privacy scan is not a pass.");
  return { schemaVersion: 1, status: matches.length ? "fail" : "pass", privateFiles, privateDigestCount: privateDigests.size, publicFiles, matches,
    limits: ["Exact fingerprint and explicit response-length scan only; independent review must still check scalar values and examples."] };
}

async function requirePrivateOutput(output) {
  const destination = path.resolve(output);
  const root = await realpath(repoRoot);
  const parent = await realpath(path.dirname(destination));
  const relative = path.relative(root, parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Evidence output must stay outside the repository.");
  return destination;
}

async function main(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--") || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Use named flag/value pairs.");
    if (Object.hasOwn(options, args[index])) throw new Error("Duplicate option.");
    options[args[index]] = args[index + 1];
  }
  const allowed = command === "inspect" ? ["--output", "--artifact-dir", "--evidence-id"] : ["--output", "--capture-root"];
  if (Object.keys(options).some((key) => !allowed.includes(key))) throw new Error("Unknown option.");
  if (!options["--output"]) throw new Error("An external --output is required.");
  const output = await requirePrivateOutput(options["--output"]);
  let result;
  if (command === "inspect") {
    if (!options["--artifact-dir"] || !options["--evidence-id"]) throw new Error("inspect requires --artifact-dir and --evidence-id.");
    const artifactDir = path.resolve(options["--artifact-dir"]);
    const records = [];
    for (const name of ["api-records.json", "raw-requests.json"]) {
      try {
        const parsed = parsePrivateJson(await readFile(path.join(artifactDir, name), "utf8"), "Capture record file");
        if (!Array.isArray(parsed)) throw new Error("Capture record file must be an array.");
        records.push(...parsed);
      }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const found = records.filter((record) => record.evidenceId === options["--evidence-id"]);
    if (!found.length) throw new Error("Evidence ID not found in capture records.");
    const descriptorKey = (record) => JSON.stringify([record.bodyCapture?.state, record.bodyCapture?.path, record.bodyCapture?.sha256, record.bodyCapture?.byteLength]);
    const binding = descriptorKey(found[0]);
    if (found.some((record) => descriptorKey(record) !== binding)) throw new Error("Conflicting raw/API response descriptors.");
    result = await inspectVerifiedResponse(artifactDir, found[0]);
  } else if (command === "scan-public") {
    if (!options["--capture-root"]) throw new Error("scan-public requires --capture-root.");
    result = await scanPublicResponseFingerprints({ captureRoot: path.resolve(options["--capture-root"]) });
  } else throw new Error("Use inspect or scan-public.");
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: result.status ?? "verified-private-facts-written", output }));
  if (result.status === "fail") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
