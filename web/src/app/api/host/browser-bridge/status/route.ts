import { NextResponse } from "next/server";
import { browserBrokerFetch } from "@/lib/browser-bridge";
import { rejectUnlessLocal } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;
  try {
    const res = await browserBrokerFetch("/internal/status");
    if (!res) return NextResponse.json({ available: false });
    if (!res.ok) {
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    }
    const { extension, pendingApprovals } = data as {
      extension?: { connected?: unknown; paired?: unknown };
      pendingApprovals?: unknown;
    };
    return NextResponse.json({
      available: true,
      connected: extension?.connected === true,
      paired: extension?.paired === true,
      pendingApprovals:
        typeof pendingApprovals === "number" && Number.isFinite(pendingApprovals)
          ? Math.max(0, pendingApprovals)
          : 0,
    });
  } catch {
    return NextResponse.json(
      { error: "browser broker unavailable" },
      { status: 502 },
    );
  }
}
