import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { OcError } from "@/lib/oc-server";
import { getTaskCost } from "@/lib/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    const cost = await getTaskCost(id);
    return NextResponse.json({ cost: cost ?? null });
  } catch (err) {
    // Defense in depth: cost is optional UI chrome. Never turn an engine
    // timeout into an unhandled Next.js route error in the host log.
    if (err instanceof OcError) {
      return NextResponse.json({ cost: null }, { status: 200 });
    }
    throw err;
  }
}
