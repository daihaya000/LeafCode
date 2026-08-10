import { NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const base = resolveHostControlUrl();
  try {
    const res = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const setCookie = res.headers.get("set-cookie");
    const headers: Record<string, string> = {};
    if (setCookie) {
      headers["set-cookie"] = setCookie;
    }
    return NextResponse.json({ ok: true }, { status: 200, headers });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
