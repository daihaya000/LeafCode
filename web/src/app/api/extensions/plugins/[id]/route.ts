import { NextRequest, NextResponse } from "next/server";
import {
  extensionsErrorResponse,
  parseEnabledBody,
} from "@/lib/opencode-extensions/http";
import { setPluginEnabled } from "@/lib/opencode-extensions/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => undefined);
  const parsed = parseEnabledBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    await setPluginEnabled(id, parsed.enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}
