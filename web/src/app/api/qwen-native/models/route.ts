import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { ocServer } from "@/lib/oc-server";
import { listConfiguredImageModels } from "@/lib/opencode-extensions/provider-models";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderResponse = {
  all?: Array<{
    id?: string;
    name?: string;
    models?: Record<string, {
      name?: string;
      capabilities?: { attachment?: boolean; input?: { image?: boolean } };
    }>;
  }>;
  connected?: string[];
};

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  // `opencode.jsonc` に直接書かれた画像対応モデル（登録済みローカルOllamaなど）。
  // エンジン再起動前で `/provider` にまだ出ない登録直後でも選択できるようにする。
  let configured: { value: string; label: string; group: string }[] = [];
  try {
    configured = listConfiguredImageModels();
  } catch {
    configured = [];
  }

  try {
    const providers = await ocServer<ProviderResponse>(null, "/provider");
    const connected = providers.connected ? new Set(providers.connected) : null;
    const fromEngine = (providers.all ?? []).flatMap((provider) => {
      if (!provider.id || (connected && !connected.has(provider.id))) return [];
      return Object.entries(provider.models ?? {})
        .filter(([, model]) =>
          model.capabilities?.input?.image === true ||
          model.capabilities?.attachment === true,
        )
        .map(([modelID, model]) => ({
          value: `${provider.id}::${modelID}`,
          label: model.name?.trim() || modelID,
          group: provider.name?.trim() || provider.id!,
        }));
    });
    return withReadCache(
      NextResponse.json({ models: mergeModels(fromEngine, configured) }),
      { maxAge: 60 },
    );
  } catch (error) {
    // エンジンが落ちていても、設定ファイル由来の候補だけは返す。
    if (configured.length > 0) {
      return withReadCache(
        NextResponse.json({ models: mergeModels([], configured) }),
        { maxAge: 60 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "モデル一覧を取得できません" },
      { status: 502 },
    );
  }
}

function mergeModels(
  ...groups: { value: string; label: string; group: string }[][]
): { value: string; label: string; group: string }[] {
  const byValue = new Map<string, { value: string; label: string; group: string }>();
  for (const group of groups) {
    for (const model of group) {
      if (!byValue.has(model.value)) byValue.set(model.value, model);
    }
  }
  return [...byValue.values()];
}
