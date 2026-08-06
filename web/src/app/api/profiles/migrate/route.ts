import { NextResponse } from "next/server";
import { migrateDefault } from "@/lib/profiles/service";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const result = migrateDefault();

  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ jobId: result.jobId }, { status: 202 });
}
