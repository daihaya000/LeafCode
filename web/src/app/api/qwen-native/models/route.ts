import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { ocServer } from "@/lib/oc-server";

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

  try {
    const providers = await ocServer<ProviderResponse>(null, "/provider");
    const connected = providers.connected ? new Set(providers.connected) : null;
    const models = (providers.all ?? []).flatMap((provider) => {
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
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "モデル一覧を取得できません" },
      { status: 502 },
    );
  }
}
