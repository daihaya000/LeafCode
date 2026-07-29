import { NextResponse } from "next/server";
import { browserBrokerFetch } from "@/lib/browser-bridge";
import { rejectUnlessLocal } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;
  try {
    const res = await browserBrokerFetch("/internal/approvals");
    if (!res) return NextResponse.json({ approvals: [], available: false });
    if (!res.ok) return NextResponse.json({ error: "browser broker unavailable" }, { status: 502 });
    const data = (await res.json().catch(() => ({}))) as { approvals?: unknown };
    return NextResponse.json({ approvals: Array.isArray(data.approvals) ? data.approvals : [], available: true });
  } catch {
    return NextResponse.json({ error: "browser broker unavailable" }, { status: 502 });
  }
}
