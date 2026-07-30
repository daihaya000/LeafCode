import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { removePty, PtyError } from "@/lib/pty-session";
import { logPtyEvent } from "@/lib/pty-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** PTY id format used by the Engine (alphanumeric, avoids path injection in /pty/{id}). */
const PTY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * DELETE /api/pty-session/[id]?directory= — terminate a PTY (host-only).
 */
export async function DELETE(req: NextRequest) {
  const denied = rejectUnlessLocal(req);
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

  try {
    const removed = await removePty(dirCheck.path, ptyId);
    logPtyEvent(ptyId, "delete", { directory: dirCheck.path });
    return NextResponse.json({ ok: removed });
  } catch (err) {
    if (err instanceof PtyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to remove PTY" },
      { status: 500 },
    );
  }
}
