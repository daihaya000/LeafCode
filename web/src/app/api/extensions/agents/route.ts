import { NextResponse } from "next/server";
import { listAgents } from "@/lib/opencode-extensions/agents";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const agents = await listAgents();
    return withReadCache(NextResponse.json({ agents }));
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}
