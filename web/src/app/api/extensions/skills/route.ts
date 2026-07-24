import { NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listSkills } from "@/lib/opencode-extensions/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { skills, truncated } = await listSkills();
    return NextResponse.json({ skills, truncated });
  } catch (err) {
    return extensionsErrorResponse(err, "スキル一覧を取得できません");
  }
}
