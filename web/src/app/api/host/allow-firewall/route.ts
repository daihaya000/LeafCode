import { NextResponse } from "next/server";
import { hostAllowFirewallPath, resolveHostControlUrl } from "@/lib/host-control";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The elevated netsh command waits on the UAC prompt, which can take a while
// for a human to answer — allow more time than the other host-control calls.
const ALLOW_FIREWALL_TIMEOUT_MS = 65000;

export async function POST(req: Request) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;

  const base = resolveHostControlUrl();
  try {
    const res = await fetch(`${base}${hostAllowFirewallPath()}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(ALLOW_FIREWALL_TIMEOUT_MS),
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
