import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";
import { rejectUnlessLocal } from "@/lib/local-request";

const execFileAsync = promisify(execFile);
const WEBUI_REPO = "daihaya000/OpenCodeWebUI";
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

function installationRoot(): string {
  const root = resolve(process.cwd(), "..");
  return existsSync(join(root, "scripts")) ? root : process.cwd();
}

async function checkWebUi(): Promise<UpdateStatus> {
  const cwd = installationRoot();
  try {
    const { stdout: current } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 5000 });
    const { stdout: upstream } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd, timeout: 5000 });
    const upstreamName = upstream.trim();
    const separator = upstreamName.indexOf("/");
    const remote = separator > 0 ? upstreamName.slice(0, separator) : "";
    const ref = separator > 0 ? upstreamName.slice(separator + 1) : "";
    const currentHash = current.trim();
    const currentDate = await commitDate(cwd, currentHash);
    if (!remote || !ref) return { available: false, current: currentHash.slice(0, 7), currentDate };
    const { stdout: latest } = await execFileAsync("git", ["ls-remote", remote, `refs/heads/${ref}`], { cwd, timeout: 10_000 });
    const latestHash = latest.trim().split(/\s+/, 1)[0];
    const latestDate = latestHash ? await commitDate(cwd, latestHash) : undefined;
    return {
      available: Boolean(latestHash && latestHash !== currentHash),
      current: currentHash.slice(0, 7),
      latest: latestHash ? latestHash.slice(0, 7) : undefined,
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
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;
  const [webui, opencode] = await Promise.all([checkWebUi(), checkOpenCode()]);
  return NextResponse.json({ webui, opencode, repository: WEBUI_REPO });
}
