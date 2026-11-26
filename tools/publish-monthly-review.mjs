import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertMonth, assertMonthlyReport, loadMonthlyPacket } from "./monthly-review.mjs";
import { publicationEnvironment, publicationGit, publishReportFiles } from "./guarded-report-publication.mjs";

export function publicationTarget(month) {
  assertMonth(month);
  return { branch: `automation/monthly-review-${month}`, file: `reports/monthly/${month}.json` };
}

export async function publishReport(report, { remote = "origin", env = process.env } = {}) {
  const { branch, file } = publicationTarget(report.month);
  const revision = publicationGit(["rev-parse", "HEAD"]);
  const packet = await loadMonthlyPacket(report.month, revision);
  assertMonthlyReport(report, packet);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  const result = await publishReportFiles({ branch, files: { [file]: bytes }, sourceRevision: report.sourceRevision,
    message: `docs: offline documentation review ${report.month}` }, { remote, env });
  return { ...result, file };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: "string" } } });
  if (!values.input) throw new Error("--input <report.json> is required.");
  const report = JSON.parse(await readFile(values.input, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const result = await publishReport(report, { env: publicationEnvironment() });
  const url = `https://github.com/${repository}/compare/main...${result.branch}`;
  const summary = `Monthly review **${result.status}**: [review branch](${url}). No direct push to main; open a pull request to start normal CI.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
