import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Allowlist of setting keys that may be read/written through this generic
 * route. Keeps arbitrary clients from overwriting unrelated rows in the
 * `settings` table.
 */
const ALLOWED_KEYS = new Set<string>([
  "default-model",
  "sidebar",
  "sidepanel-width",
]);

function isAllowedKey(key: string): key is string {
  return ALLOWED_KEYS.has(key);
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  if (!isAllowedKey(key)) {
    return NextResponse.json({ error: "unknown setting key" }, { status: 400 });
  }
  const value = getSetting(key);
  return NextResponse.json({
    value: value && value.length > 0 ? value : null,
  });
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  if (!isAllowedKey(key)) {
    return NextResponse.json({ error: "unknown setting key" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | { value?: unknown }
    | null;

  if (!body || typeof body !== "object" || !("value" in body)) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  const { value } = body;
  if (value !== null && typeof value !== "string") {
    return NextResponse.json(
      { error: "value must be a string or null" },
      { status: 400 },
    );
  }

  // Treat empty string as "unset" so readers can distinguish unset from set.
  const stored = typeof value === "string" && value.length > 0 ? value : "";
  setSetting(key, stored);
  return NextResponse.json({ ok: true });
}