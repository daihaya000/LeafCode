import { NextResponse } from "next/server";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";
import { renameProfile, deleteProfile } from "@/lib/profiles/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;

  const { id } = await params;
  let body: { name?: string };
  try {
    body = (await req.json().catch(() => ({}))) as { name?: string };
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }

  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name は必須です" }, { status: 400 });
  }

  const result = renameProfile(id, body.name);
  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;

  const { id } = await params;
  const result = await deleteProfile(id);
  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
