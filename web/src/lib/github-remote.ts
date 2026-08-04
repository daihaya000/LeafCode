import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RemoteHead = { branch: string; commit: string };

/**
 * Parses `git ls-remote --symref <url> HEAD` output, e.g.:
 *   ref: refs/heads/master\tHEAD
 *   e871d3765129eef9bbc5f4e83f4489867970ae1d\tHEAD
 */
export function parseLsRemoteSymrefOutput(stdout: string): RemoteHead | null {
  let branch: string | null = null;
  let commit: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const symrefMatch = trimmed.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
    if (symrefMatch) {
      branch = symrefMatch[1];
      continue;
    }
    const hashMatch = trimmed.match(/^([0-9a-f]{7,40})\s+HEAD$/);
    if (hashMatch) commit = hashMatch[1];
  }
  if (!branch || !commit) return null;
  return { branch, commit };
}

/**
 * Resolves the default branch name and its tip commit for a remote repo
 * without needing a local git checkout, so it works whether or not `.git`
 * exists yet, and never hardcodes a branch name (main/master/etc. vary).
 */
export async function resolveRemoteHead(
  repoUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<RemoteHead> {
  // repoUrl is passed straight through to `git ls-remote` as a positional
  // argument; a value starting with `-` would be parsed as a git option
  // instead (e.g. `--upload-pack=...`) if this is ever called with anything
  // other than the hardcoded GITHUB_REPO_URL.
  if (repoUrl.startsWith("-")) {
    throw new Error(`invalid repository URL: ${repoUrl}`);
  }
  const { stdout } = await execFileAsync(
    "git",
    ["ls-remote", "--symref", repoUrl, "HEAD"],
    {
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 20_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  const result = parseLsRemoteSymrefOutput(stdout);
  if (!result) throw new Error(`git ls-remote --symrefの出力を解析できませんでした: ${stdout}`);
  return result;
}
