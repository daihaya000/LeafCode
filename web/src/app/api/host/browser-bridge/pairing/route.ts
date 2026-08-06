import { NextResponse } from "next/server";
import { browserBrokerFetch } from "@/lib/browser-bridge";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;
  try {
    const res = await browserBrokerFetch("/internal/pairing-requests");
    if (!res) return NextResponse.json({ requests: [], available: false });
    if (!res.ok)
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    const data = (await res.json().catch(() => null)) as {
      requests?: unknown;
    } | null;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      requests: Array.isArray(data.requests) ? data.requests : [],
      available: true,
    });
  } catch {
    return NextResponse.json(
      { error: "browser broker unavailable" },
      { status: 502 },
    );
  }
}
