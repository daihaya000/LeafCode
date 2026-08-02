import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 64 * 1024;
const GITHUB_REPO = "daihaya000/OpenCodeWebUI";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function installationRoot(): string {
  const root = resolve(process.cwd(), "..");
  return existsSync(join(root, "scripts")) ? root : process.cwd();
}

function isGitInstall(root: string): boolean {
  return existsSync(join(root, ".git"));
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function updateFromLatestRelease(root: string) {
  const response = await fetch(GITHUB_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenCodeWebUI" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`GitHub Releasesの取得に失敗しました（HTTP ${response.status}）`);
  const release = (await response.json()) as {
    tag_name?: string;
    zipball_url?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const asset = release.assets?.find((item) => item.name?.toLowerCase().endsWith(".zip"));
  const downloadUrl = asset?.browser_download_url ?? release.zipball_url;
  if (!downloadUrl) throw new Error("利用可能なリリースZIPが見つかりません");

  const work = await mkdtemp(join(tmpdir(), "opencode-webui-update-"));
  try {
    const archive = join(work, "release.zip");
    const archiveResponse = await fetch(downloadUrl, {
      headers: { Accept: "application/octet-stream", "User-Agent": "OpenCodeWebUI" },
      signal: AbortSignal.timeout(120_000),
    });
    if (!archiveResponse.ok) throw new Error(`リリースZIPの取得に失敗しました（HTTP ${archiveResponse.status}）`);
    await writeFile(archive, Buffer.from(await archiveResponse.arrayBuffer()));
    const extracted = join(work, "extracted");
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath ${powershellLiteral(archive)} -DestinationPath ${powershellLiteral(extracted)} -Force`,
    ], { timeout: 120_000, windowsHide: true });
    const entries = await readdir(extracted, { withFileTypes: true });
    const sourceRoot = entries.length === 1 && entries[0].isDirectory()
      ? join(extracted, entries[0].name)
      : extracted;
    await cp(sourceRoot, root, {
      recursive: true,
      force: true,
      filter: (source) => {
        const name = source.slice(sourceRoot.length + 1);
        return !name.startsWith(".git") && !name.startsWith("node_modules") && !name.startsWith(".next");
      },
    });
    return { tag: release.tag_name ?? "latest", source: asset ? "release-asset" : "source-archive" };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT) return value;
  return `${value.slice(0, MAX_OUTPUT)}\n…(truncated)`;
}

export async function POST(req: Request) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const cwd = installationRoot();
  if (!isGitInstall(cwd)) {
    try {
      const result = await updateFromLatestRelease(cwd);
      return NextResponse.json({
        ok: true,
        cwd,
        mode: "release",
        command: "GitHub Releases",
        result,
        stdout: `リリース ${result.tag} を取得しました。ビルド/再起動で反映されます。`,
      });
    } catch (err) {
      return NextResponse.json(
        { ok: false, cwd, mode: "release", error: err instanceof Error ? err.message : "リリース更新に失敗しました" },
        { status: 500 },
      );
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["pull", "--ff-only"],
      {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: MAX_OUTPUT * 2,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    return NextResponse.json({
      ok: true,
      cwd,
      mode: "git",
      command: "git pull --ff-only",
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: unknown };
    return NextResponse.json(
      {
        ok: false,
        cwd,
        command: "git pull --ff-only",
        error: e.message,
        code: e.code,
        stdout: trimOutput(e.stdout ?? ""),
        stderr: trimOutput(e.stderr ?? ""),
      },
      { status: 500 },
    );
  }
}
