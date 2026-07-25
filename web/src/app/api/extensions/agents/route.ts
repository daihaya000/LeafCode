import { NextResponse } from "next/server";
import { listAgents } from "@/lib/opencode-extensions/agents";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await listAgents();
    return NextResponse.json({ agents });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}
