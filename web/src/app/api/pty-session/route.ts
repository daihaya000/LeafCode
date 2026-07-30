import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { createPty, listPtys, resolveScopedCwd, PtyError } from "@/lib/pty-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TITLE_MAX_LEN = 200;

/**
 * POST /api/pty-session — create a PTY on the Engine (host-only).
 *
 * Body: { directory: string, cwd?: string, title?: string }
 * `command`/`args`/`env` are rejected: the WebUI must not let a browser pick an
 * arbitrary executable. The Engine uses its default shell.
 */
export async function POST(req: NextRequest) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | {
        directory?: string;
        cwd?: string;
        title?: string;
        command?: unknown;
        args?: unknown;
        env?: unknown;
      }
    | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "request body required" }, { status: 400 });
  }

  // Reject any attempt to specify an executable — arbitrary command
  // execution is the exact risk this endpoint gates.
  if (body.command !== undefined || body.args !== undefined || body.env !== undefined) {
    return NextResponse.json(
      { error: "command/args/env are not accepted; the default shell is used" },
      { status: 400 },
    );
  }

  const directory = typeof body.directory === "string" ? body.directory.trim() : "";
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }

  // Phase 0: the project directory must be under an allowed root (same guard
  // as the in-task FileTree). This is the outer filesystem boundary; the cwd
  // scoping below is an inner check relative to this directory.
  const dirCheck = assertAllowedDirectory(directory);
  if (!dirCheck.ok) {
    return NextResponse.json({ error: dirCheck.error }, { status: dirCheck.status });
  }

  // Inner check: cwd must stay within the project directory.
  const cwdCheck = resolveScopedCwd(dirCheck.path, body.cwd);
  if (!cwdCheck.ok) {
    return NextResponse.json({ error: cwdCheck.error }, { status: cwdCheck.status });
  }

  let title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "";
  if (title.length > TITLE_MAX_LEN) title = title.slice(0, TITLE_MAX_LEN);

  try {
    const pty = await createPty(dirCheck.path, {
      cwd: cwdCheck.cwd,
      title: title || undefined,
    });
    return NextResponse.json(
      { id: pty.id, title: pty.title, cwd: pty.cwd, status: pty.status },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof PtyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create PTY" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/pty-session?directory= — list PTY sessions (host-only).
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const directory = req.nextUrl.searchParams.get("directory")?.trim() ?? "";
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }

  const dirCheck = assertAllowedDirectory(directory);
  if (!dirCheck.ok) {
    return NextResponse.json({ error: dirCheck.error }, { status: dirCheck.status });
  }

  try {
    const sessions = await listPtys(dirCheck.path);
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        cwd: s.cwd,
        status: s.status,
        size: undefined as { rows: number; cols: number } | undefined,
      })),
    });
  } catch (err) {
    if (err instanceof PtyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to list PTY sessions" },
      { status: 500 },
    );
  }
}
