import { NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = resolveHostControlUrl();
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, controlUrl: base, error: `status ${res.status}` },
        { status: 502 },
      );
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return NextResponse.json({
      ok: Boolean(body.ok),
      controlUrl: base,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        controlUrl: base,
        error: err instanceof Error ? err.message : "unreachable",
      },
      { status: 502 },
    );
  }
}
