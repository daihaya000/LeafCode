import { NextResponse } from "next/server";
import { browserBrokerFetch } from "@/lib/browser-bridge";
import { rejectUnlessLocal } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;
  try {
    const res = await browserBrokerFetch("/internal/pairing", {
      method: "POST",
    });
    if (!res || !res.ok)
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    const data = (await res.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.code !== "string"
    ) {
      return NextResponse.json(
        { error: "browser broker unavailable" },
        { status: 502 },
      );
    }
    return NextResponse.json({ code: data.code }, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "browser broker unavailable" },
      { status: 502 },
    );
  }
}
