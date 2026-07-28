import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function repoRoot(): string {
  const root = resolve(process.cwd(), "..");
  if (existsSync(join(root, ".git"))) return root;
  if (existsSync(join(process.cwd(), ".git"))) return process.cwd();
  throw new Error("WebUI リポジトリを特定できません");
}

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT) return value;
  return `${value.slice(0, MAX_OUTPUT)}\n…(truncated)`;
}

export async function POST(req: Request) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  let cwd: string;
  try {
    cwd = repoRoot();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "WebUI リポジトリを特定できません" },
      { status: 500 },
    );
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
