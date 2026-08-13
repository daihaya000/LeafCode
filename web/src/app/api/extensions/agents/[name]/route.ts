import { NextRequest, NextResponse } from "next/server";
import {
  extensionsErrorResponse,
  parseAgentPatchBody,
} from "@/lib/opencode-extensions/http";
import {
  setAgentEnabled,
  setAgentModel,
} from "@/lib/opencode-extensions/agents";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest,
  context: { params: Promise<{ name: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { name } = await context.params;
  const body = await req.json().catch(() => undefined);
  const parsed = parseAgentPatchBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    if (parsed.model !== undefined || parsed.variant !== undefined) {
      await setAgentModel(name, parsed.model ?? null, parsed.variant ?? null);
    }
    if (parsed.enabled !== undefined) {
      await setAgentEnabled(name, parsed.enabled);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}
