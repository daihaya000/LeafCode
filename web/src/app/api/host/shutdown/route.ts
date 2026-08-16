import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { hostShutdownPath, resolveHostControlUrl } from "@/lib/host-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask the tray host to quit after a graceful OpenCode stop.
 *
 * Force-killing the console or using Task Manager leaves a Windows LISTENING
 * ghost socket on :4096. This path uses the host's `quit()` (dispose + soft
 * kill) so the listen handle is released before the process exits.
 */
export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const base = resolveHostControlUrl();
  try {
    const res = await fetch(`${base}${hostShutdownPath()}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && res.status !== 202) {
      return NextResponse.json(
        {
          error:
            typeof data.error === "string"
              ? data.error
              : `host control failed: ${res.status}`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: true, accepted: true, shutdown: true, ...data },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `ホスト制御に接続できません: ${err.message}`
            : "ホスト制御に接続できません",
        hint: "start-webui.bat（トレイホスト）経由で起動しているか確認してください",
      },
      { status: 502 },
    );
  }
}
