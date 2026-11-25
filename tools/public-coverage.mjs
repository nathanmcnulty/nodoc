import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./spec-quality-lib.mjs";

// Public coverage snapshots are reviewed aggregates only. Every field is
// allowlisted so routes, bodies, identifiers and local paths cannot leak from
// private refresh outputs into the site.
export const publicCoverageSchemaVersion = 1;
export const snapshotDirectory = path.join(repoRoot, "src", "data", "coverageSnapshots");

const measures = ["currentObservations", "staleObservations", "notObserved", "latestErrorObserved", "completeBodyObserved", "schemaGaps", "exampleGaps"];
// Older published reports may omit a per-spec measure; unknown stays null, never zero.
const nullableMeasures = new Set(["completeBodyObserved"]);
const snapshotKeys = ["schemaVersion", "snapshotId", "assessedAt", "windowDays", "source", "totals", "specs"];
const sourceKeys = ["report", "baseRevision"];
const totalKeys = ["specs", "operations", ...measures];
const specKeys = ["specId", "title", "operations", ...measures];
const timestampPattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/u;
const specIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const titlePattern = /^[A-Za-z0-9][A-Za-z0-9 ().-]{0,79}$/u;
const reportPattern = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,119}\.md$/u;
const revisionPattern = /^[0-9a-f]{7,40}$/u;

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const plainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function validTimestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) return false;
  const date = value.slice(0, 10);
  return Number.isFinite(Date.parse(value)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function unexpectedKeys(value, allowed, context, problems) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problems.push(`${context}: unexpected field ${JSON.stringify(key)}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) problems.push(`${context}: missing field ${JSON.stringify(key)}`);
}

function checkMeasures(row, context, problems, { allowNull }) {
  for (const key of ["operations", ...measures]) {
    const value = row[key];
    if (value === null && allowNull && nullableMeasures.has(key)) continue;
    if (!isCount(value)) problems.push(`${context}: ${key} must be a nonnegative integer${nullableMeasures.has(key) && allowNull ? " or null" : ""}`);
  }
  if (problems.length) return;
  const observed = row.currentObservations + row.staleObservations;
  if (observed + row.notObserved !== row.operations) problems.push(`${context}: current, stale and not-observed counts do not partition ${row.operations} operations`);
  if (row.latestErrorObserved > observed) problems.push(`${context}: latest errors exceed observed operations`);
  if (row.completeBodyObserved !== null && row.completeBodyObserved > observed) problems.push(`${context}: complete bodies exceed observed operations`);
  for (const key of ["schemaGaps", "exampleGaps"]) if (row[key] > row.operations) problems.push(`${context}: ${key} exceeds operations`);
}

// Returns a list of problems. An empty list means the snapshot is internally
// reconciled; it does not prove which operations were sampled or authorized.
export function reconcilePublicCoverageSnapshot(snapshot, { knownSpecIds = null } = {}) {
  const problems = [];
  if (!plainObject(snapshot)) return ["snapshot: must be an object"];
  unexpectedKeys(snapshot, snapshotKeys, "snapshot", problems);
  if (snapshot.schemaVersion !== publicCoverageSchemaVersion) problems.push("snapshot: unsupported schemaVersion");
  if (!validTimestamp(snapshot.assessedAt)) problems.push("snapshot: assessedAt must be an ISO date or UTC timestamp");
  else if (snapshot.snapshotId !== snapshot.assessedAt.slice(0, 10)) problems.push("snapshot: snapshotId must equal the assessment date");
  if (!Number.isSafeInteger(snapshot.windowDays) || snapshot.windowDays < 1) problems.push("snapshot: windowDays must be a positive integer");
  if (!plainObject(snapshot.source)) problems.push("source: must be an object");
  else {
    unexpectedKeys(snapshot.source, sourceKeys, "source", problems);
    if (typeof snapshot.source.report !== "string" || !reportPattern.test(snapshot.source.report) || snapshot.source.report.includes("..")) problems.push("source: report must be a repository-relative Markdown path");
    if (typeof snapshot.source.baseRevision !== "string" || !revisionPattern.test(snapshot.source.baseRevision)) problems.push("source: baseRevision must be a commit SHA");
  }
  if (!Array.isArray(snapshot.specs) || snapshot.specs.length === 0) {
    problems.push("missing-rows: specs must be a nonempty array");
    return problems;
  }
  const seen = new Set();
  snapshot.specs.forEach((row, index) => {
    const context = `specs[${index}]`;
    if (!plainObject(row)) { problems.push(`${context}: must be an object`); return; }
    unexpectedKeys(row, specKeys, context, problems);
    if (typeof row.specId !== "string" || !specIdPattern.test(row.specId)) problems.push(`${context}: invalid specId`);
    else if (seen.has(row.specId)) problems.push(`${context}: duplicate specId ${row.specId}`);
    else seen.add(row.specId);
    if (typeof row.title !== "string" || !titlePattern.test(row.title)) problems.push(`${context}: invalid title`);
    if (knownSpecIds && typeof row.specId === "string" && !knownSpecIds.has(row.specId)) problems.push(`${context}: unknown specId ${row.specId}`);
    const rowProblems = [];
    checkMeasures(row, `${context} (${row.specId})`, rowProblems, { allowNull: true });
    problems.push(...rowProblems);
  });
  if (!plainObject(snapshot.totals)) { problems.push("missing-baseline: totals must be an object"); return problems; }
  unexpectedKeys(snapshot.totals, totalKeys, "totals", problems);
  const totalProblems = [];
  checkMeasures(snapshot.totals, "totals", totalProblems, { allowNull: false });
  if (!isCount(snapshot.totals.specs)) totalProblems.push("totals: specs must be a nonnegative integer");
  problems.push(...totalProblems);
  if (problems.length) return problems;
  if (snapshot.totals.specs !== snapshot.specs.length) problems.push(`spec-count-mismatch: totals report ${snapshot.totals.specs} specs but ${snapshot.specs.length} rows are present`);
  for (const key of ["operations", ...measures]) {
    const values = snapshot.specs.map(row => row[key]);
    // A published aggregate cannot be reconciled from unknown per-spec values.
    if (values.some(value => value === null)) continue;
    const sum = values.reduce((total, value) => total + value, 0);
    if (sum !== snapshot.totals[key]) problems.push(`${key === "operations" ? "operation-count-mismatch" : "measure-mismatch"}: ${key} rows sum to ${sum} but totals report ${snapshot.totals[key]}`);
  }
  return problems;
}

export function assertPublicCoverageSnapshot(snapshot, options) {
  const problems = reconcilePublicCoverageSnapshot(snapshot, options);
  if (problems.length) throw new Error(`Public coverage snapshot is not reconciled:\n- ${problems.join("\n- ")}`);
  return snapshot;
}

// Accepts the private inventory.json or refresh-report.json written by
// runPortfolioRefresh and copies only reviewed aggregate counts.
export function projectRefreshOutput(input, { baseRevision, report = "REFRESH_STATUS.md", assessedAt = null, windowDays = null, knownSpecIds = null } = {}) {
  if (!plainObject(input) || input.schemaVersion !== 1) throw new Error("Refresh output must be a schemaVersion 1 inventory or report.");
  const portfolio = plainObject(input.portfolio) ? input.portfolio : input;
  if (!Array.isArray(portfolio.specs) || !plainObject(portfolio.summary)) throw new Error("Refresh output lacks per-spec rows or an independent summary.");
  const window = windowDays ?? input.freshnessDays;
  if (window === undefined || window === null) throw new Error("A refresh report does not record its window; pass --window-days explicitly.");
  const field = (source, key, context) => {
    if (!Object.hasOwn(source, key)) throw new Error(`${context} lacks ${key}; missing measures are never treated as zero.`);
    return source[key];
  };
  const project = (source, context) => ({
    currentObservations: field(source, "currentObservations", context), staleObservations: field(source, "staleObservations", context),
    notObserved: field(source, "notObserved", context), latestErrorObserved: field(source, "errorObserved", context),
    completeBodyObserved: field(source, "completeBodyObserved", context), schemaGaps: field(source, "schemaGaps", context),
    exampleGaps: field(source, "exampleGaps", context),
  });
  const timestamp = assessedAt ?? input.asOf;
  const snapshot = {
    schemaVersion: publicCoverageSchemaVersion,
    snapshotId: typeof timestamp === "string" ? timestamp.slice(0, 10) : null,
    assessedAt: timestamp, windowDays: window,
    source: { report, baseRevision },
    totals: { specs: field(portfolio.summary, "specCount", "summary"), operations: field(portfolio.summary, "operationCount", "summary"), ...project(portfolio.summary, "summary") },
    specs: portfolio.specs.map((spec, index) => ({ specId: spec.specId, title: spec.title, operations: spec.operationCount, ...project(spec.freshness ?? {}, `specs[${index}].freshness`) }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title))),
  };
  return assertPublicCoverageSnapshot(snapshot, { knownSpecIds });
}

export async function loadPublicCoverageSnapshots(directory = snapshotDirectory) {
  const names = (await readdir(directory)).filter(name => name.endsWith(".json")).sort();
  const snapshots = [];
  for (const name of names) {
    const snapshot = JSON.parse((await readFile(path.join(directory, name), "utf8")).replace(/^\uFEFF/u, ""));
    if (`${snapshot?.snapshotId}.json` !== name) throw new Error(`${name}: file name must match snapshotId.`);
    assertPublicCoverageSnapshot(snapshot);
    snapshots.push(snapshot);
  }
  if (!snapshots.length) throw new Error("No public coverage snapshots are available.");
  return snapshots.sort((a, b) => Date.parse(a.assessedAt) - Date.parse(b.assessedAt));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].split(/=(.*)/su, 2);
    if (!key.startsWith("--")) throw new Error(`Unexpected argument ${key}.`);
    args[key.slice(2)] = inline ?? argv[++index];
  }
  return args;
}

async function main([command, ...rest]) {
  const { buildSpecInventory } = await import("./spec-quality-lib.mjs");
  const knownSpecIds = new Set((await buildSpecInventory()).map(spec => spec.specId));
  if (command === "check") {
    const snapshots = await loadPublicCoverageSnapshots();
    assertPublicCoverageSnapshot(snapshots.at(-1), { knownSpecIds });
    console.log(`Reconciled ${snapshots.length} public coverage snapshot(s).`);
    return;
  }
  if (command !== "project") throw new Error("Usage: public-coverage.mjs check | project --input <inventory.json|refresh-report.json> --base-revision <sha> [--assessed-at <ts>] [--window-days <n>] [--report <file.md>]");
  const args = parseArgs(rest);
  if (!args.input || !args["base-revision"]) throw new Error("--input and --base-revision are required.");
  const input = JSON.parse((await readFile(path.resolve(args.input), "utf8")).replace(/^\uFEFF/u, ""));
  const snapshot = projectRefreshOutput(input, {
    baseRevision: args["base-revision"], report: args.report ?? "REFRESH_STATUS.md", assessedAt: args["assessed-at"] ?? null,
    windowDays: args["window-days"] === undefined ? null : Number(args["window-days"]), knownSpecIds,
  });
  const destination = path.join(snapshotDirectory, `${snapshot.snapshotId}.json`);
  const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
  try {
    await writeFile(destination, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(destination, "utf8") !== bytes) throw new Error(`${path.relative(repoRoot, destination)} already exists with different counts; review it instead of overwriting.`);
  }
  console.log(`Wrote ${path.relative(repoRoot, destination).replaceAll("\\", "/")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
