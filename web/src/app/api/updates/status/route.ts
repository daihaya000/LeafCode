import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";
import { GITHUB_REPO, GITHUB_REPO_URL, installationRoot, isGitInstall } from "@/lib/install-root";
import { resolveRemoteHead } from "@/lib/github-remote";
import { readUpdateRecord } from "@/lib/install-state";

const execFileAsync = promisify(execFile);
const WEBUI_REPO = GITHUB_REPO;
const OPENCODE_PACKAGE = "opencode-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateStatus = {
  available: boolean;
  current?: string;
  latest?: string;
  currentDate?: string;
  latestDate?: string;
  error?: string;
};

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, timeout: 5000 });
    return true;
  } catch (err) {
    const e = err as Error & { code?: number };
    if (e.code === 1) return false;
    throw err;
  }
}

/** `.git` install with a tracked upstream (`origin/master` etc.): the original check. */
async function checkWebUiViaUpstream(cwd: string): Promise<string | null> {
  const { stdout: upstream } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd, timeout: 5000 });
  const upstreamName = upstream.trim();
  const separator = upstreamName.indexOf("/");
  const remote = separator > 0 ? upstreamName.slice(0, separator) : "";
  const ref = separator > 0 ? upstreamName.slice(separator + 1) : "";
  if (!remote || !ref) return null;
  const { stdout: latest } = await execFileAsync("git", ["ls-remote", remote, `refs/heads/${ref}`], { cwd, timeout: 10_000 });
  return latest.trim().split(/\s+/, 1)[0] || null;
}

/** `.git` install without a usable upstream: fall back to the hardcoded repo URL. */
async function checkWebUiViaHardcodedRemote(cwd: string): Promise<string | null> {
  await execFileAsync("git", ["fetch", GITHUB_REPO_URL, "HEAD"], {
    cwd,
    timeout: 15_000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const { stdout } = await execFileAsync("git", ["rev-parse", "FETCH_HEAD"], { cwd, timeout: 5000 });
  return stdout.trim() || null;
}

/** No `.git` yet (zip install, startup git-restore not done/failed): compare against the locally recorded commit. */
async function checkWebUiWithoutGit(cwd: string): Promise<UpdateStatus> {
  const record = readUpdateRecord(cwd);
  if (!record) {
    return { available: false, error: "バージョン情報がありません" };
  }
  try {
    const remoteHead = await resolveRemoteHead(GITHUB_REPO_URL);
    // Note: unlike the `.git` path, there's no local object history here, so
    // this can't check ancestry (old-version regression). A plain mismatch
    // is treated as "update available".
    return {
      available: remoteHead.commit !== record.commit,
      current: record.commit.slice(0, 7),
      latest: remoteHead.commit.slice(0, 7),
    };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : "WebUIの更新確認に失敗しました" };
  }
}

async function checkWebUi(): Promise<UpdateStatus> {
  const cwd = installationRoot();
  if (!isGitInstall(cwd)) return checkWebUiWithoutGit(cwd);

  try {
    const { stdout: current } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 5000 });
    const currentHash = current.trim();
    const currentDate = await commitDate(cwd, currentHash);

    let latestHash = await checkWebUiViaUpstream(cwd).catch(() => null);
    if (!latestHash) latestHash = await checkWebUiViaHardcodedRemote(cwd).catch(() => null);
    if (!latestHash) return { available: false, current: currentHash.slice(0, 7), currentDate };

    const latestDate = await commitDate(cwd, latestHash);
    // 旧バージョンへの回帰を避ける: upstream が現在の ancestor でない場合のみ更新ありとみなす。
    // つまり latest は current の descendant（current より新しい）必要がある。
    const available = Boolean(latestHash !== currentHash && await isAncestor(cwd, currentHash, latestHash));
    return {
      available,
      current: currentHash.slice(0, 7),
      latest: latestHash.slice(0, 7),
      currentDate,
      latestDate,
    };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : "WebUIの更新確認に失敗しました" };
  }
}

async function commitDate(cwd: string, hash: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%cI", hash], { cwd, timeout: 5000 });
    const iso = stdout.trim();
    if (!iso) return undefined;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return undefined;
  }
}

function compareVersions(current: string, latest: string): number {
  const parse = (value: string) => value.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

async function checkOpenCode(): Promise<UpdateStatus> {
  try {
    const [healthResponse, registryResponse] = await Promise.all([
      fetch(`${OPENCODE_BASE_URL}/global/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) }),
      fetch(`https://registry.npmjs.org/${OPENCODE_PACKAGE}/latest`, {
        headers: { Accept: "application/json", "User-Agent": "OpenCodeWebUI" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }),
    ]);
    const health = (await healthResponse.json().catch(() => ({}))) as { version?: unknown };
    const registry = (await registryResponse.json().catch(() => ({}))) as { version?: unknown };
    const current = typeof health.version === "string" ? health.version : undefined;
    const latest = typeof registry.version === "string" ? registry.version : undefined;
    if (!current || !latest) return { available: false, current, latest, error: "OpenCodeのバージョンを取得できませんでした" };
    return { available: compareVersions(current, latest) < 0, current, latest };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : "OpenCodeの更新確認に失敗しました" };
  }
}

export async function GET(req: Request) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;
  const [webui, opencode] = await Promise.all([checkWebUi(), checkOpenCode()]);
  return NextResponse.json({ webui, opencode, repository: WEBUI_REPO });
}
