import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { assertSafeBranchName, runGit } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function runGh(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function GET(req: NextRequest) {
  const directory = req.nextUrl.searchParams.get("directory") ?? process.cwd();
  const check = assertAllowedDirectory(directory);
  // availability check may use any allowed root; if none, still probe gh
  try {
    const ver = await runGh(check.ok ? check.path : process.cwd(), ["--version"]);
    return NextResponse.json({
      available: ver.code === 0,
      version: ver.stdout.trim().split(/\r?\n/)[0] ?? null,
    });
  } catch {
    return NextResponse.json({
      available: false,
      version: null,
      hint: "Install GitHub CLI (gh) and run gh auth login",
    });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    directory?: string;
    title?: string;
    body?: string;
    base?: string;
    push?: boolean;
  } | null;

  if (!body?.directory || !body.title?.trim()) {
    return NextResponse.json(
      { error: "directory and title are required" },
      { status: 400 },
    );
  }

  const check = assertAllowedDirectory(body.directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  if (body.base) {
    try {
      assertSafeBranchName(body.base);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "invalid base" },
        { status: 400 },
      );
    }
  }

  let ghAvailable = true;
  try {
    await runGh(check.path, ["--version"]);
  } catch {
    ghAvailable = false;
  }
  if (!ghAvailable) {
    return NextResponse.json(
      {
        error: "GitHub CLI (gh) is not installed or not on PATH",
        hint: "Install gh and run: gh auth login",
      },
      { status: 503 },
    );
  }

  if (body.push !== false) {
    const push = await runGit(check.path, ["push", "-u", "origin", "HEAD"]);
    if (push.code !== 0) {
      return NextResponse.json(
        {
          error: push.stderr.trim() || push.stdout.trim() || "git push failed",
        },
        { status: 500 },
      );
    }
  }

  const args = [
    "pr",
    "create",
    "--title",
    body.title.trim(),
    "--body",
    body.body?.trim() || body.title.trim(),
  ];
  if (body.base) {
    args.push("--base", body.base);
  }

  try {
    const pr = await runGh(check.path, args);
    if (pr.code !== 0) {
      return NextResponse.json(
        { error: pr.stderr.trim() || pr.stdout.trim() || "gh pr create failed" },
        { status: 500 },
      );
    }
    const url = pr.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? pr.stdout.trim();
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "gh failed",
        hint: "Install GitHub CLI and authenticate",
      },
      { status: 503 },
    );
  }
}
