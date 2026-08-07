import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { installationRoot } from "@/lib/install-root";
import { requireAuthorized } from "@/lib/api-guard";
import { resolveNpmCli } from "@/lib/npm-cli";
import { installSpecForMajor, majorOf } from "@/lib/nextjs-major";

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

/** Range declared in `web/package.json` — the fallback when `node_modules` is
 *  missing/unreadable. */
function readDeclaredNextVersion(webDir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    const declared = pkg.dependencies?.[NEXTJS_PACKAGE];
    return typeof declared === "string" ? declared : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Manually triggered from Settings (not run automatically at startup).
 * Installs the newest release **within the currently installed major** — see
 * lib/nextjs-major.ts: Next 16 rejects this project's external distDir, so
 * `next@latest` breaks every production build. Crossing a major is a planned
 * migration, not a button.
 */
export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const webDir = join(installationRoot(), "web");

  const major =
    majorOf(readInstalledNextVersion(webDir)) ?? majorOf(readDeclaredNextVersion(webDir));
  if (major === undefined) {
    return NextResponse.json(
      { ok: false, error: "現在の Next.js バージョンを特定できませんでした" },
      { status: 500 },
    );
  }
  const spec = installSpecForMajor(major);

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
      [npmCli, "install", spec],
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
      command: `npm install ${spec}`,
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
        command: `npm install ${spec}`,
        error: e.message,
        code: e.code,
        stdout: trimOutput(e.stdout ?? ""),
        stderr: trimOutput(e.stderr ?? ""),
      },
      { status: 500 },
    );
  }
}
