import { NextResponse } from "next/server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";
import { rejectUnlessLocal } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  try {
    const upstream = await fetch(new URL("/global/upgrade", OPENCODE_BASE_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upstream.ok || data.success === false) {
      return NextResponse.json(
        {
          ok: false,
          error:
            typeof data.error === "string"
              ? data.error
              : `OpenCode upgrade failed: ${upstream.status}`,
          result: data,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, result: data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `OpenCode CLI のアップデートに失敗しました: ${err.message}`
            : "OpenCode CLI のアップデートに失敗しました",
      },
      { status: 502 },
    );
  }
}
