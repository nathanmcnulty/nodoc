import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertMonth, assertMonthlyReport, loadMonthlyPacket, revisionPattern } from "./monthly-review.mjs";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function publicationTarget(month) {
  assertMonth(month);
  return { branch: `automation/monthly-review-${month}`, file: `reports/monthly/${month}.json` };
}

export async function publishReport(report, { remote = "origin", env = process.env } = {}) {
  const { branch, file } = publicationTarget(report.month);
  const revision = git(["rev-parse", "HEAD"]);
  if (!revisionPattern.test(report.sourceRevision) || revision !== report.sourceRevision) throw new Error("Publisher checkout must match the report source revision.");
  if (git(["status", "--porcelain", "--untracked-files=all"])) throw new Error("Publisher requires a clean checkout.");
  const packet = await loadMonthlyPacket(report.month, revision);
  assertMonthlyReport(report, packet);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  const existing = git(["ls-remote", "--heads", remote, `refs/heads/${branch}`], { env });
  if (existing) {
    git(["fetch", "--no-tags", remote, `refs/heads/${branch}`], { env });
    const previous = execFileSync("git", ["show", `FETCH_HEAD:${file}`], { encoding: "utf8" });
    if (previous === bytes) return { branch, file, status: "unchanged" };
    throw new Error(`${branch} already exists with different content. Preserving it for review; no overwrite or force push.`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  git(["add", "--", file]);
  if (!git(["diff", "--cached", "--name-only"])) return { branch, file, status: "unchanged" };
  if (git(["diff", "--cached", "--name-only"]) !== file) throw new Error("Only the monthly report may be committed.");
  git(["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit", "-m", `docs: offline documentation review ${report.month}`]);
  // An empty expected tip is a create-only lease, not permission to replace an existing review branch.
  git(["push", `--force-with-lease=refs/heads/${branch}:`, remote, `HEAD:refs/heads/${branch}`], { env });
  return { branch, file, status: "pushed" };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: "string" } } });
  if (!values.input) throw new Error("--input <report.json> is required.");
  const report = JSON.parse(await readFile(values.input, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(repository ?? "") || !process.env.GH_TOKEN) throw new Error("Publisher requires GITHUB_REPOSITORY and GH_TOKEN.");
  if (git(["remote", "get-url", "origin"]) !== `https://github.com/${repository}` && git(["remote", "get-url", "origin"]) !== `https://github.com/${repository}.git`) throw new Error("Unexpected publication remote.");
  const auth = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64");
  const result = await publishReport(report, { env: { ...process.env, GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` } });
  const url = `https://github.com/${repository}/compare/main...${result.branch}`;
  const summary = `Monthly review **${result.status}**: [review branch](${url}). No direct push to main; open a pull request to start normal CI.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
