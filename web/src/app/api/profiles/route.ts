import { NextResponse } from "next/server";
import { createProfile, listProfiles } from "@/lib/profiles/service";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const result = await listProfiles();
    return withReadCache(NextResponse.json(result));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "プロファイル一覧の取得に失敗しました" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  let body: { name?: string; from?: string };
  try {
    body = (await req.json().catch(() => ({}))) as { name?: string; from?: string };
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です" }, { status: 400 });
  }

  if (typeof body.name !== "string" || typeof body.from !== "string") {
    return NextResponse.json(
      { error: "name と from は必須です" },
      { status: 400 },
    );
  }

  const result = createProfile({ name: body.name, from: body.from });

  if ("status" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.kind === "created") {
    return NextResponse.json(result.profile, { status: 201 });
  }

  return NextResponse.json({ jobId: result.jobId }, { status: 202 });
}
