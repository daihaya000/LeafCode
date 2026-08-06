import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { getRelay } from "@/lib/pty-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PTY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_INPUT_BYTES = 64 * 1024;

/**
 * POST /api/pty-session/input?id=&directory= — send keystrokes to the PTY.
 *
 * Body: `{ data: string }` (raw bytes as a string; xterm.js serializes this
 * way). The BFF forwards the data to the Engine WebSocket opened by the
 * sibling `stream` route. If no stream is currently attached, the input is
 * rejected — the relay must be established first so input never opens a fresh
 * Engine connection on its own.
 */
export async function POST(req: NextRequest) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
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
    | { data?: string }
    | null;
  if (!body || typeof body.data !== "string") {
    return NextResponse.json({ error: "data (string) is required" }, { status: 400 });
  }
  if (body.data.length > MAX_INPUT_BYTES) {
    return NextResponse.json(
      { error: `input exceeds ${MAX_INPUT_BYTES} bytes` },
      { status: 413 },
    );
  }

  const relay = getRelay(ptyId);
  if (!relay) {
    return NextResponse.json(
      { error: "no active stream; open the stream endpoint first" },
      { status: 409 },
    );
  }

  try {
    relay.ws.send(body.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to send input" },
      { status: 500 },
    );
  }
}
