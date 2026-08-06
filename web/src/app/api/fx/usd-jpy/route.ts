import { NextResponse } from "next/server";
import { fetchUsdJpyQuote } from "@/lib/fx-usd-jpy";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const quote = await fetchUsdJpyQuote();
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fx fetch failed" },
      { status: 502 },
    );
  }
}
