import { NextResponse } from "next/server";
import { hostVoiceInputPath, resolveHostControlUrl } from "@/lib/host-control";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const base = resolveHostControlUrl();
  try {
    const res = await fetch(`${base}${hostVoiceInputPath()}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
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
    return NextResponse.json({ ok: true, ...data });
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
