import { NextRequest, NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listPlugins } from "@/lib/opencode-extensions/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    return NextResponse.json({ plugins: await listPlugins() });
  } catch (err) {
    return extensionsErrorResponse(err, "プラグイン一覧を取得できません");
  }
}
