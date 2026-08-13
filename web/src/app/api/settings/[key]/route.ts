import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";
import {
  MAX_SETTING_VALUE_CHARS,
  isAllowedKey,
  normalizeSettingValue,
} from "@/lib/settings-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { key } = await context.params;
  if (!isAllowedKey(key)) {
    return NextResponse.json({ error: "unknown setting key" }, { status: 400 });
  }
  const value = getSetting(key);
  return withReadCache(
    NextResponse.json({
      value: value && value.length > 0 ? value : null,
    }),
  );
}

export async function PUT(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

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

  // Cap payload size: this BFF is LAN-reachable without auth.
  if (typeof value === "string" && value.length > MAX_SETTING_VALUE_CHARS) {
    return NextResponse.json(
      { error: `value exceeds ${MAX_SETTING_VALUE_CHARS} characters` },
      { status: 400 },
    );
  }

  // Treat empty string / null as "unset".
  const raw = typeof value === "string" && value.length > 0 ? value : "";
  const normalized = normalizeSettingValue(key, raw);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  setSetting(key, normalized.value);
  return NextResponse.json({ ok: true });
}
