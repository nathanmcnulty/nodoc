import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { responseBodyLimits, resolveResponseBodyLimits } from "./discovery-capture-policy.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const evidencePattern = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const redacted = "[redacted]";
export const responseBodySidecarLimit = responseBodyLimits.perBodyBytes;
const sensitiveKeys = new Set(["accesstoken", "assertion", "authorization", "authtoken", "clientsecret", "hubtenanttoken", "idtoken", "password", "refreshtoken", "secret", "token"]);
const normalizedKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");
function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sensitiveKeys.has(normalizedKey(key)) ? redacted : redactValue(entry)]));
  if (typeof value === "string") return value.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gu, "$1 [redacted]").replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu, redacted);
  return value;
}

export function sanitizeResponseBody(value) {
  if (typeof value !== "string" || !value.trim()) return value;
  const trimmed = value.trim();
  try { return JSON.stringify(redactValue(JSON.parse(trimmed))); } catch {
    // Malformed structured data cannot be redacted reliably. Omitting the
    // sidecar is safer than retaining a partially masked credential value.
    if (/^[\[{]/u.test(trimmed)) return null;
  }
  try {
    if (!trimmed.includes("=")) throw new Error("not form encoded");
    const params = new URLSearchParams(trimmed);
    let changed = false;
    for (const key of new Set(params.keys())) if (sensitiveKeys.has(normalizedKey(key))) { params.set(key, redacted); changed = true; }
    if (changed) return params.toString();
  } catch { /* fall through */ }
  if (/(?:^|[^a-z0-9])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|authorization|password|secret|token)\s*[:=]/iu.test(trimmed)) return null;
  return redactValue(value);
}

function boundedPath(artifactDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || relativePath.includes("..")) throw new Error("response body sidecar path is outside the artifact directory.");
  const absolute = path.resolve(artifactDir, relativePath);
  const relative = path.relative(path.resolve(artifactDir), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("response body sidecar path is outside the artifact directory.");
  return absolute;
}

async function validateRealPathBoundary(artifactDir, absolutePath, { requireFile = false } = {}) {
  const rootReal = await realpath(path.resolve(artifactDir));
  const parent = path.dirname(absolutePath);
  const parentInfo = await lstat(parent);
  if (parentInfo.isSymbolicLink()) throw new Error("response body sidecar symlink boundary is not allowed.");
  const parentReal = await realpath(parent);
  const parentRelative = path.relative(rootReal, parentReal);
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) throw new Error("response body sidecar real path is outside the artifact directory.");
  if (requireFile) {
    const fileInfo = await lstat(absolutePath);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error("response body sidecar must be a regular non-symlink file.");
    const fileReal = await realpath(absolutePath);
    const fileRelative = path.relative(rootReal, fileReal);
    if (fileRelative.startsWith("..") || path.isAbsolute(fileRelative)) throw new Error("response body sidecar real path is outside the artifact directory.");
  } else {
    try {
      const fileInfo = await lstat(absolutePath);
      if (fileInfo.isSymbolicLink()) throw new Error("response body sidecar symlink boundary is not allowed.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

const pendingWrites = new Map();
export function writeResponseBodySidecar(options) {
  const key = path.resolve(options.artifactDir);
  const result = (pendingWrites.get(key) ?? Promise.resolve()).then(() => writeSidecar(options));
  const tail = result.catch(() => {}).finally(() => { if (pendingWrites.get(key) === tail) pendingWrites.delete(key); });
  pendingWrites.set(key, tail);
  return result;
}

async function writeSidecar({ artifactDir, evidenceId, sanitizedBody, previewLimit = 5000, write = writeFile, move = rename, limits = responseBodyLimits }) {
  limits = resolveResponseBodyLimits(limits);
  if (!evidencePattern.test(String(evidenceId ?? ""))) throw new Error("response body evidenceId is invalid.");
  if (typeof sanitizedBody !== "string") return { preview: null, bodyCapture: { state: "decode-failed", previewState: "absent", path: null, sha256: null, byteLength: 0 } };
  const bytes = Buffer.from(sanitizedBody, "utf8");
  if (bytes.byteLength > limits.perBodyBytes) {
    return {
      preview: sanitizedBody.length > previewLimit ? `${sanitizedBody.slice(0, previewLimit)}…` : sanitizedBody,
      bodyCapture: bodyCaptureWithoutSidecar("oversize", bytes.byteLength),
    };
  }
  const relativePath = `response-body-sidecars/${evidenceId}.body`;
  const absolutePath = boundedPath(artifactDir, relativePath);
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
  const preview = sanitizedBody.length > previewLimit ? `${sanitizedBody.slice(0, previewLimit)}…` : sanitizedBody;
  try {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await validateRealPathBoundary(artifactDir, absolutePath);
    try {
      const existingInfo = await lstat(absolutePath);
      if (!existingInfo.isFile() || existingInfo.size > limits.perBodyBytes) {
        return { preview, bodyCapture: { state: "incomplete-write", previewState: sanitizedBody.length > previewLimit ? "truncated" : "complete", path: null, sha256: null, byteLength: bytes.byteLength } };
      }
      const existing = await readFile(absolutePath);
      if (existing.byteLength !== bytes.byteLength || sha256(existing) !== sha256(bytes)) {
        return { preview, bodyCapture: { state: "incomplete-write", previewState: sanitizedBody.length > previewLimit ? "truncated" : "complete", path: null, sha256: null, byteLength: bytes.byteLength } };
      }
      return { preview, bodyCapture: { state: "complete", previewState: sanitizedBody.length > previewLimit ? "truncated" : "complete", path: relativePath, sha256: sha256(bytes), byteLength: bytes.byteLength } };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    let retainedBytes = 0;
    for (const entry of await readdir(path.dirname(absolutePath), { withFileTypes: true })) {
      if (!entry.name.endsWith(".body")) continue;
      const info = await lstat(path.join(path.dirname(absolutePath), entry.name));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid sidecar budget entry.");
      retainedBytes += info.size;
    }
    if (retainedBytes + bytes.byteLength > limits.totalBytes) return { preview, bodyCapture: bodyCaptureWithoutSidecar("oversize", bytes.byteLength), bodyCaptureDiagnostic: "response-body-retention-budget-exceeded" };
    await write(temporaryPath, bytes);
    await move(temporaryPath, absolutePath);
  } catch {
    return { preview, bodyCapture: { state: "incomplete-write", previewState: sanitizedBody.length > previewLimit ? "truncated" : "complete", path: null, sha256: null, byteLength: bytes.byteLength } };
  }
  return { preview, bodyCapture: { state: "complete", previewState: sanitizedBody.length > previewLimit ? "truncated" : "complete", path: relativePath, sha256: sha256(bytes), byteLength: bytes.byteLength } };
}

export function bodyCaptureWithoutSidecar(state, byteLength = 0) {
  if (!["truncated", "oversize", "decode-failed", "incomplete-write"].includes(state)) throw new Error("invalid incomplete response body state.");
  return { state, previewState: "absent", path: null, sha256: null, byteLength: Number(byteLength) || 0 };
}

export async function loadResponseBodySidecar({ artifactDir, evidenceId, descriptor, limits = responseBodyLimits }) {
  limits = resolveResponseBodyLimits(limits);
  if (!descriptor || descriptor.state !== "complete" || !evidencePattern.test(String(evidenceId ?? ""))) throw new Error("response body sidecar is not complete or evidence-bound.");
  if (descriptor.path !== `response-body-sidecars/${evidenceId}.body`) throw new Error("response body sidecar filename does not match its evidence ID.");
  if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0 || descriptor.byteLength > limits.perBodyBytes) throw new Error("response body sidecar length exceeds the retention limit.");
  const absolutePath = boundedPath(artifactDir, descriptor.path);
  await validateRealPathBoundary(artifactDir, absolutePath, { requireFile: true });
  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile() || fileStats.size !== descriptor.byteLength || fileStats.size > limits.perBodyBytes) throw new Error("response body sidecar hash or length mismatch.");
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) throw new Error("response body sidecar hash or length mismatch.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function hydrateResponseBodySidecars(records, artifactDir, limits = responseBodyLimits) {
  limits = resolveResponseBodyLimits(limits);
  let totalBytes = 0;
  for (const record of records ?? []) {
    if (record?.bodyCapture?.state !== "complete") continue;
    totalBytes += record.bodyCapture.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.totalBytes) throw new Error("Response-body analysis exceeds the aggregate budget.");
    const body = await loadResponseBodySidecar({ artifactDir, evidenceId: record.evidenceId, descriptor: record.bodyCapture, limits });
    Object.defineProperty(record, "responseBodyForAnalysis", { configurable: false, enumerable: false, value: body, writable: false });
  }
  return records ?? [];
}

export function assessResponseBodySidecarCompleteness(records) {
  const failures = (records ?? []).filter((record) => record?.matchesCurrentSpec === true && record?.bodyCapture?.state === "incomplete-write");
  return {
    captureComplete: failures.length === 0,
    incompleteWriteCount: failures.length,
    evidenceIds: failures.map((record) => String(record.evidenceId ?? "")).filter(Boolean).sort(),
  };
}
