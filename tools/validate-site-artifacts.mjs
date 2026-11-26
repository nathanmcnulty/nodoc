import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./spec-quality-lib.mjs";
import { assertOperationIndexShape, operationIndexPath, sha256 } from "./site-artifacts.mjs";

const buildDir = path.resolve(repoRoot, process.argv[2] ?? "build");
const failures = [];
const fail = message => failures.push(message);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readBuildFile(relativePath) {
  return readFile(path.join(buildDir, ...relativePath.split("/")), "utf8");
}

async function routeHtmlExists(route) {
  const segments = route.split("/").filter(Boolean);
  if (!segments.length) return exists(path.join(buildDir, "index.html"));
  return await exists(path.join(buildDir, ...segments.slice(0, -1), `${segments.at(-1)}.html`))
    || await exists(path.join(buildDir, ...segments, "index.html"));
}

function relativeFromSite(url, site) {
  if (!url.startsWith(site)) throw new Error(`${url} is outside ${site}`);
  return url.slice(site.length).replace(/^\/+/u, "");
}

const committed = JSON.parse(await readFile(operationIndexPath, "utf8"));
assertOperationIndexShape(committed);

const catalog = JSON.parse(await readBuildFile("openapi/index.json"));
const site = catalog.site.replace(/\/+$/u, "");
if (catalog.specifications.length !== committed.specs.length) fail(`Catalog lists ${catalog.specifications.length} specifications; the operation index lists ${committed.specs.length}.`);

for (const entry of catalog.specifications) {
  const indexed = committed.specs.find(spec => spec.specId === entry.specId);
  if (!indexed) {
    fail(`Catalog specification ${entry.specId} is missing from the operation index.`);
    continue;
  }
  if (entry.page !== `${site}${indexed.route}`) fail(`${entry.specId} page ${entry.page} does not match route ${indexed.route}.`);
  if (!await routeHtmlExists(indexed.route)) fail(`${entry.specId} route ${indexed.route} has no built page.`);
  const downloadPath = relativeFromSite(entry.openapi, site);
  let text;
  try {
    text = await readBuildFile(downloadPath);
  } catch {
    fail(`${entry.specId} download ${downloadPath} is missing.`);
    continue;
  }
  if (sha256(text) !== entry.sha256) fail(`${entry.specId} download digest does not match the catalog.`);
  if (Buffer.byteLength(text, "utf8") !== entry.bytes) fail(`${entry.specId} download size does not match the catalog.`);
  const document = JSON.parse(text);
  const operationCount = Object.values(document.paths ?? {}).reduce((sum, pathItem) => sum
    + ["get", "put", "post", "patch", "delete", "head", "options", "trace"].filter(method => pathItem?.[method]).length, 0);
  if (operationCount !== entry.operationCount || operationCount !== indexed.operationCount) fail(`${entry.specId} download has ${operationCount} operations; the catalog lists ${entry.operationCount}.`);
  if (/"\$ref"\s*:\s*"(?!#)/u.test(text)) fail(`${entry.specId} download contains an external reference.`);
}

const published = JSON.parse(await readBuildFile("operations.json"));
const stripped = published.operations.map(({ href, ...operation }) => operation);
if (JSON.stringify(stripped) !== JSON.stringify(committed.operations)) fail("Published operations.json differs from src/generated/operationIndex.json; run npm run generate:site-data.");
for (const operation of published.operations) {
  const page = catalog.specifications.find(entry => entry.specId === operation.specId)?.page;
  const expected = operation.anchor ? `${page}#${operation.anchor}` : page;
  if (operation.href !== expected) {
    fail(`${operation.method} ${operation.path} has href ${operation.href}; expected ${expected}.`);
    break;
  }
}

const llms = await readBuildFile("llms.txt");
for (const entry of catalog.specifications) {
  if (!llms.includes(`](${entry.page})`)) fail(`llms.txt does not link ${entry.specId}.`);
}
for (const route of ["/operations", "/coverage"]) {
  if (!await routeHtmlExists(route)) fail(`Built site is missing ${route}.`);
}
if (!await exists(path.join(buildDir, "_headers"))) fail("Built site is missing _headers for artifact CORS.");

if (failures.length) {
  console.error(failures.map(message => `- ${message}`).join("\n"));
  process.exit(1);
}
console.log(`Validated ${catalog.specifications.length} OpenAPI downloads, ${published.operations.length} indexed operations, and llms.txt in ${path.relative(repoRoot, buildDir) || "."}.`);
