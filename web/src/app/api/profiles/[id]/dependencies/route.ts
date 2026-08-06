import { NextResponse } from "next/server";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";
import { installDependencies } from "@/lib/profiles/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;
  const { id } = await params;
  const result = installDependencies(id);
  if ("status" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
