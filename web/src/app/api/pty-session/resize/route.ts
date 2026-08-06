import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { resizePty, PtyError } from "@/lib/pty-session";
import { logPtyEvent } from "@/lib/pty-audit";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PTY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MIN_DIM = 1;
const MAX_DIM = 1000;

function validDim(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= MIN_DIM && n <= MAX_DIM;
}

/**
 * POST /api/pty-session/resize?id=&directory= — update PTY size (host-only).
 *
 * Body: { rows: number, cols: number }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const ptyId = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!PTY_ID_RE.test(ptyId)) {
    return NextResponse.json({ error: "invalid pty id" }, { status: 400 });
  }

  const directory = req.nextUrl.searchParams.get("directory")?.trim() ?? "";
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }

  const dirCheck = assertAllowedDirectory(directory);
  if (!dirCheck.ok) {
    return NextResponse.json({ error: dirCheck.error }, { status: dirCheck.status });
  }

  const body = (await req.json().catch(() => null)) as
    | { rows?: number; cols?: number }
    | null;
  if (!body || !validDim(body.rows) || !validDim(body.cols)) {
    return NextResponse.json(
      { error: `rows and cols must be integers in [${MIN_DIM}, ${MAX_DIM}]` },
      { status: 400 },
    );
  }

  try {
    await resizePty(dirCheck.path, ptyId, body.rows, body.cols);
    logPtyEvent(ptyId, "resize", {
      directory: dirCheck.path,
      detail: `${body.rows}x${body.cols}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PtyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to resize PTY" },
      { status: 500 },
    );
  }
}
