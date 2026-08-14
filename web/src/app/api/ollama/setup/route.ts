import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  installOllama,
  isOllamaInstalled,
  listOllamaModels,
  pullOllamaModel,
} from "@/lib/ollama-cli";
import {
  OLLAMA_DEFAULT_VISION_MODEL,
  ollamaModelValue,
  registerOllamaProvider,
} from "@/lib/ollama-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * 設定画面「画像解析」タブのセットアップボタン。
 * 起動時の自動セットアップは廃止し、この明示操作でのみ
 * インストール → モデルPull → OpenCode provider 登録 を行う。
 */
export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => undefined)) as
    | { model?: unknown }
    | undefined;
  const model =
    typeof body?.model === "string" && body.model.trim()
      ? body.model.trim()
      : OLLAMA_DEFAULT_VISION_MODEL;

  const steps: string[] = [];
  try {
    if (!isOllamaInstalled()) {
      const install = await installOllama();
      if (!install.installed) {
        return NextResponse.json(
          { ok: false, steps, error: install.message },
          { status: 500 },
        );
      }
      steps.push("Ollamaをインストールしました");
    } else {
      steps.push("Ollamaは導入済みです");
    }

    const before = await listOllamaModels();
    if (before.includes(model)) {
      steps.push(`モデル「${model}」は取得済みです`);
    } else {
      await pullOllamaModel(model);
      steps.push(`モデル「${model}」を取得しました`);
    }

    const registered = await registerOllamaProvider();
    steps.push(
      `OpenCodeに ${registered.models.length} 件のモデルを登録しました（provider: ${registered.providerID}）`,
    );

    return NextResponse.json({
      ok: true,
      steps,
      model,
      modelValue: ollamaModelValue(model),
      models: registered.models,
      visionModels: registered.visionModels,
      // 登録直後の provider を OpenCode エンジンへ反映するには再起動が要る。
      restartRequired: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        steps,
        error: err instanceof Error ? err.message : "Ollamaのセットアップに失敗しました",
      },
      { status: 500 },
    );
  }
}
