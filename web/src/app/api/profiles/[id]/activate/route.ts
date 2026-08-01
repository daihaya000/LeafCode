import { NextResponse } from "next/server";
import { rejectUnlessLocal } from "@/lib/local-request";
import { activate } from "@/lib/profiles/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const { id } = await params;
  const result = activate(id);

  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
