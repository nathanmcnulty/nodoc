import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function publicationGit(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function publicationEnvironment(env = process.env) {
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(repository ?? "") || !env.GH_TOKEN) throw new Error("Publisher requires GITHUB_REPOSITORY and GH_TOKEN.");
  if (![ `https://github.com/${repository}`, `https://github.com/${repository}.git` ].includes(publicationGit(["remote", "get-url", "origin"]))) throw new Error("Unexpected publication remote.");
  const auth = Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString("base64");
  return { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` };
}

export async function publishReportFiles({ branch, files, sourceRevision, message }, { remote = "origin", env = process.env } = {}) {
  if (!/^automation\/(?:monthly-review-\d{4}-\d{2}|capture-coverage-\d{4}-\d{2}-\d{2})$/u.test(branch)
    || !/^[a-f0-9]{40}$/u.test(sourceRevision) || publicationGit(["rev-parse", "HEAD"]) !== sourceRevision) throw new Error("Publisher checkout must match the report source revision.");
  if (publicationGit(["status", "--porcelain", "--untracked-files=all"])) throw new Error("Publisher requires a clean checkout.");
  const names = Object.keys(files).sort();
  if (!names.length || names.length > 3 || names.some(file => !/^(?:reports\/monthly\/\d{4}-\d{2}\.json|reports\/coverage\/\d{4}-\d{2}-\d{2}\.md|src\/data\/coverageSnapshots\/\d{4}-\d{2}-\d{2}\.json|src\/generated\/publicCoverage\.ts)$/u.test(file))) throw new Error("Unsupported publication path.");
  if (publicationGit(["ls-remote", "--heads", remote, `refs/heads/${branch}`], { env })) {
    publicationGit(["fetch", "--no-tags", remote, `refs/heads/${branch}`], { env });
    const reject = () => { throw new Error("Review branch already exists with different content or source; it was not overwritten."); };
    const parents = publicationGit(["rev-list", "--parents", "-n", "1", "FETCH_HEAD"]).split(" ");
    if (parents.length !== 2 || parents[1] !== sourceRevision) reject();
    const changed = publicationGit(["diff", "--no-renames", "--name-only", "-z", sourceRevision, "FETCH_HEAD"]).split("\0").filter(Boolean);
    if (changed.some(file => !names.includes(file))) reject();
    for (const file of names) {
      const entry = publicationGit(["ls-tree", "FETCH_HEAD", "--", file]);
      if (!/^100644 blob [a-f0-9]{40}\t/u.test(entry)) reject();
      const previous = execFileSync("git", ["show", `FETCH_HEAD:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (previous !== files[file]) reject();
    }
    return { branch, status: "unchanged" };
  }
  for (const file of names) {
    await mkdir(path.dirname(file), { recursive: true });
    if (file === "src/generated/publicCoverage.ts") await writeFile(file, files[file]);
    else {
      try { await writeFile(file, files[file], { flag: "wx" }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (await readFile(file, "utf8") !== files[file]) throw new Error("An existing dated report has different content; it was not overwritten.");
      }
    }
  }
  publicationGit(["add", "--", ...names]);
  const staged = publicationGit(["diff", "--cached", "--name-only"]);
  if (!staged) return { branch, status: "unchanged" };
  if (staged.split("\n").some(file => !names.includes(file))) throw new Error("Only the validated report files may be committed.");
  publicationGit(["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit", "-m", message, "-m", "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"]);
  // Empty expected tip is a create-only lease, never permission to overwrite a review.
  publicationGit(["push", `--force-with-lease=refs/heads/${branch}:`, remote, `HEAD:refs/heads/${branch}`], { env });
  return { branch, status: "pushed" };
}
