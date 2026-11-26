import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildSpecInventory } from "./spec-quality-lib.mjs";
import { loadPublicCoverageSnapshots, projectRefreshOutput } from "./public-coverage.mjs";
import { renderPublicCoverage } from "./generate-public-coverage.mjs";
import { assertNoRefreshLinks, privateRefreshDirectory } from "./portal-refresh-paths.mjs";
import { jsonBytes, sha256 } from "./private-capture-store.mjs";
import { publicationEnvironment, publicationGit, publishReportFiles } from "./guarded-report-publication.mjs";

export function prepareCoverageReview(inputBytes, sourceRevision, publicTitles) {
  if (!/^[a-f0-9]{40}$/u.test(sourceRevision)) throw new Error("Full source revision required.");
  const input = JSON.parse(inputBytes);
  if (input.mode !== "report-only" || !Array.isArray(input.blockers) || input.blockers.length
    || !Array.isArray(input.captures) || !input.captures.length || input.captures.some(capture => !capture || capture.captureComplete !== true)) {
    throw new Error("Only a complete, unblocked private refresh report may be proposed for publication.");
  }
  if (!(publicTitles instanceof Map)) throw new Error("A public spec catalog is required.");
  const assessedSpecIds = new Set();
  for (const capture of input.captures) {
    if (typeof capture.specId !== "string" || !publicTitles.has(capture.specId)) {
      throw new Error("Capture must bind a known public specId.");
    }
    assessedSpecIds.add(capture.specId);
  }
  const snapshot = projectRefreshOutput(input, { baseRevision: sourceRevision, publicTitles, assessedSpecIds });
  snapshot.source.report = `reports/coverage/${snapshot.snapshotId}.md`;
  const review = { schemaVersion: 1, decision: "pending", sourceRevision,
    inputSha256: sha256(inputBytes), snapshotSha256: sha256(jsonBytes(snapshot)) };
  return { snapshot, review };
}

export function assertCoverageReview(review, expected) {
  if (!review || Object.keys(review).sort().join() !== Object.keys(expected).sort().join()
    || Object.entries({ ...expected, decision: "approved" }).some(([key, value]) => review[key] !== value)) {
    throw new Error("Independent approval must bind the exact private report, public projection and source revision.");
  }
}

export async function publishCaptureCoverage(inputBytes, review, options = {}) {
  const titles = new Map((await buildSpecInventory()).map(spec => [spec.specId, spec.title]));
  const sourceRevision = publicationGit(["rev-parse", "HEAD"]);
  const prepared = prepareCoverageReview(inputBytes, sourceRevision, titles);
  assertCoverageReview(review, prepared.review);
  const snapshot = prepared.snapshot;
  const snapshots = await loadPublicCoverageSnapshots();
  const existing = snapshots.find(row => row.snapshotId === snapshot.snapshotId);
  if (existing && !jsonBytes(existing).equals(jsonBytes(snapshot))) throw new Error("An assessment already exists for that date; review it rather than replacing history.");
  if (!existing) snapshots.push(snapshot);
  snapshots.sort((a, b) => Date.parse(a.assessedAt) - Date.parse(b.assessedAt));
  const markdown = [
    `# Reviewed coverage assessment ${snapshot.snapshotId}`, "",
    `Assessment: ${snapshot.assessedAt}; window: ${snapshot.windowDays} days.`,
    `Source revision: \`${sourceRevision}\`.`, "",
    "This is a reviewed aggregate projection scoped to specifications with complete captures. Other specifications were not assessed in this snapshot.",
    "Observed, healthy and contract-complete are distinct measures.",
    "Raw captures, private review receipts and tenant identifiers remain outside this repository.", "",
    "| Measure | Count |", "| --- | ---: |",
    ...Object.entries(snapshot.totals).map(([key, value]) => `| ${key} | ${value} |`), "",
  ].join("\n");
  return publishReportFiles({
    branch: `automation/capture-coverage-${snapshot.snapshotId}`, sourceRevision,
    message: `docs: reviewed capture coverage ${snapshot.snapshotId}`,
    files: {
      [`src/data/coverageSnapshots/${snapshot.snapshotId}.json`]: jsonBytes(snapshot).toString(),
      [snapshot.source.report]: markdown,
      "src/generated/publicCoverage.ts": await renderPublicCoverage(snapshots),
    },
  }, options);
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, review: { type: "string" }, output: { type: "string" }, publish: { type: "boolean", default: false },
  } });
  if (!values.input) throw new Error("Supply the original private refresh report.");
  for (const filename of [values.input, values.review].filter(Boolean)) {
    await privateRefreshDirectory(path.dirname(path.resolve(filename)));
    await assertNoRefreshLinks(filename);
  }
  const bytes = await readFile(values.input);
  if (values.publish) {
    if (!values.review) throw new Error("An independently approved private review is required.");
    const result = await publishCaptureCoverage(bytes, JSON.parse(await readFile(values.review)), { env: publicationEnvironment() });
    console.log(`Reviewed coverage ${result.status}: ${result.branch}. Open a PR; no direct push to main.`);
  } else {
    const directory = await privateRefreshDirectory(values.output, { create: true });
    const titles = new Map((await buildSpecInventory()).map(spec => [spec.specId, spec.title]));
    const prepared = prepareCoverageReview(bytes, publicationGit(["rev-parse", "HEAD"]), titles);
    for (const [name, value] of Object.entries(prepared)) await writeFile(path.join(directory, `${name}.json`), jsonBytes(value), { flag: "wx", mode: 0o600 });
    console.log("Private projection and pending review prepared; no approval or publication performed.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error("Capture publication failed. Inspect the private inputs and source revision; nothing is automatically approved.");
  process.exitCode = 1;
});
