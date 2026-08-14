import { NextRequest, NextResponse } from "next/server";
import { OcError } from "@/lib/oc-server";
import { refreshSessionTitleForWorkspace } from "@/lib/session-title-refresh";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

export async function POST(req: NextRequest, context: Ctx) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id, sessionId } = await context.params;
  try {
    const title = await refreshSessionTitleForWorkspace(id, sessionId);
    return NextResponse.json({ title });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "failed to generate title",
      },
      { status: err instanceof OcError ? err.status : 502 },
    );
  }
}
