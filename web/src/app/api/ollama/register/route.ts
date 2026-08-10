import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { registerOllamaProvider } from "@/lib/ollama-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 取得済みのローカルモデルを OpenCode の provider として登録し直す。
 * インストールやPullは行わないので、モデルを追加/削除した後の再同期に使う。
 */
export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const registered = await registerOllamaProvider();
    return NextResponse.json({
      ok: true,
      providerID: registered.providerID,
      models: registered.models,
      visionModels: registered.visionModels,
      restartRequired: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Ollamaの登録に失敗しました",
      },
      { status: 500 },
    );
  }
}
