import { NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listProviderModels } from "@/lib/opencode-extensions/provider-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      providers: await listProviderModels(),
    });
  } catch (err) {
    return extensionsErrorResponse(
      err,
      "プロバイダー一覧を取得できません",
    );
  }
}
