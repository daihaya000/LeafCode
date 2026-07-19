import { NextResponse } from "next/server";
import { fetchUsdJpyQuote } from "@/lib/fx-usd-jpy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
