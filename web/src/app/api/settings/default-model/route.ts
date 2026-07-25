import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTING_KEY = "default-model";

export async function GET() {
  const value = getSetting(SETTING_KEY);
  return NextResponse.json({ value: value && value.length > 0 ? value : null });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { value?: unknown }
    | null;

  if (!body || typeof body !== "object" || !("value" in body)) {
    return NextResponse.json(
      { error: "value is required" },
      { status: 400 },
    );
  }

  const { value } = body;
  if (value !== null && typeof value !== "string") {
    return NextResponse.json(
      { error: "value must be a string or null" },
      { status: 400 },
    );
  }

  // Treat empty string as "unset" so readDefaultModelFromServer returns null.
  const stored = typeof value === "string" && value.length > 0 ? value : "";
  setSetting(SETTING_KEY, stored);
  return NextResponse.json({ ok: true });
}