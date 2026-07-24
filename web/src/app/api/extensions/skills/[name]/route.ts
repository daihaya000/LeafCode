import { NextRequest, NextResponse } from "next/server";
import {
  extensionsErrorResponse,
  parseEnabledBody,
} from "@/lib/opencode-extensions/http";
import { setSkillEnabled } from "@/lib/opencode-extensions/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  const body = await req.json().catch(() => undefined);
  const parsed = parseEnabledBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    await setSkillEnabled(name, parsed.enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}
