import { NextRequest, NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listSkills } from "@/lib/opencode-extensions/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    return NextResponse.json({ skills: await listSkills() });
  } catch (err) {
    return extensionsErrorResponse(err, "スキル一覧を取得できません");
  }
}
