import { NextRequest, NextResponse } from "next/server";
import { setProviderEnabled } from "@/lib/opencode-extensions/agents";
import {
  extensionsErrorResponse,
  parseProviderEnabledBody,
} from "@/lib/opencode-extensions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulk enable/disable every toggleable agent of a provider. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = parseProviderEnabledBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    const count = await setProviderEnabled(parsed.providerID, parsed.enabled);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}