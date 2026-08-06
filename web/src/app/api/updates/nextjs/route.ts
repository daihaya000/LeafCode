import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { installationRoot } from "@/lib/install-root";
import { requireAuthorized } from "@/lib/api-guard";
import { resolveNpmCli } from "@/lib/npm-cli";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 64 * 1024;
const NEXTJS_PACKAGE = "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT) return value;
  return `${value.slice(0, MAX_OUTPUT)}\n…(truncated)`;
}

/** Installed `next` version straight off disk, so this reflects the update
 *  immediately even though the already-running server keeps the old code
 *  loaded until the next WebUI restart. */
function readInstalledNextVersion(webDir: string): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(join(webDir, "node_modules", NEXTJS_PACKAGE, "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Manually triggered from Settings (not run automatically at startup).
 * Always installs `next@latest`, including major versions — the operator
 * accepted the breaking-change risk when clicking the button.
 */
export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const webDir = join(installationRoot(), "web");

  let npmCli: string;
  try {
    npmCli = resolveNpmCli();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "npm が見つかりませんでした" },
      { status: 500 },
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [npmCli, "install", `${NEXTJS_PACKAGE}@latest`],
      {
        cwd: webDir,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: MAX_OUTPUT * 2,
        windowsHide: true,
      },
    );
    return NextResponse.json({
      ok: true,
      cwd: webDir,
      command: "npm install next@latest",
      version: readInstalledNextVersion(webDir),
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: unknown };
    return NextResponse.json(
      {
        ok: false,
        cwd: webDir,
        command: "npm install next@latest",
        error: e.message,
        code: e.code,
        stdout: trimOutput(e.stdout ?? ""),
        stderr: trimOutput(e.stderr ?? ""),
      },
      { status: 500 },
    );
  }
}
