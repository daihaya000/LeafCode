import { NextResponse } from "next/server";
import { migrateDefault } from "@/lib/profiles/service";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  let mode: "copy" | "move" = "copy";
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
    if (body.mode !== undefined && body.mode !== "copy" && body.mode !== "move") {
      return NextResponse.json({ error: "mode は copy または move を指定してください" }, { status: 400 });
    }
    mode = body.mode === "move" ? "move" : "copy";
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const result = migrateDefault(mode);

  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ jobId: result.jobId }, { status: 202 });
}
