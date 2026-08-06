import { NextResponse } from "next/server";
import { browserBrokerFetch } from "@/lib/browser-bridge";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;
  const { id } = await context.params;
  if (!/^approval_[A-Za-z0-9_-]{20,}$/.test(id)) {
    return NextResponse.json({ error: "invalid approval id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as {
    decision?: unknown;
  } | null;
  if (!body || (body.decision !== "allow" && body.decision !== "deny")) {
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  }
  try {
    const res = await browserBrokerFetch(`/internal/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: body.decision }),
    });
    if (!res || !res.ok)
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    const data = (await res.json().catch(() => null)) as {
      approvalId?: unknown;
      decision?: unknown;
    } | null;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.approvalId !== id ||
      data.decision !== body.decision
    ) {
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { approvalId: id, decision: body.decision },
      { status: res.status },
    );
  } catch {
    return NextResponse.json(
      { error: "browser broker unavailable" },
      { status: 502 },
    );
  }
}
