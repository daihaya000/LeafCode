import { NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listSkills } from "@/lib/opencode-extensions/skills";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const { skills, truncated } = await listSkills();
    return withReadCache(NextResponse.json({ skills, truncated }));
  } catch (err) {
    return extensionsErrorResponse(err, "スキル一覧を取得できません");
  }
}
