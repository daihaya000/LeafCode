import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getJson } from "@/lib/client";
import { formatCostValue, useCostDisplayPrefs } from "@/lib/currency";
import { providerIconSrcForOpencodeId } from "@addons/codexbar";
import type { ModelRankingEntry } from "@/lib/model-ranking";

type RankingResponse = { rankings: ModelRankingEntry[] };

export function ModelRankingSettings() {
  const [rankings, setRankings] = useState<ModelRankingEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const prefs = useCostDisplayPrefs();

  const load = useCallback(async (initial = false) => {
    if (initial) setState("loading");
    setRefreshing(true);
    try {
      const response = await getJson<RankingResponse>("/api/analytics/model-ranking");
      setRankings(Array.isArray(response.rankings) ? response.rankings : []);
      setState("ready");
    } catch {
      setState("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  return (
    <section aria-labelledby="model-ranking-heading">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="model-ranking-heading" className="text-sm font-semibold text-muted">
            プロバイダー/モデルのコスパランキング
          </h2>
          <p className="mt-1 text-xs text-faint">
            セッション履歴の出力・推論トークン ÷ OpenCode の報告費用または設定価格で比較します。
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          disabled={refreshing}
          aria-label="ランキングを更新"
        >
          <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          更新
        </Button>
      </div>

      {state === "loading" ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">履歴を集計中…</p>
      ) : state === "error" ? (
        <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-5 text-sm text-muted">
          <p>セッション履歴を取得できませんでした。</p>
          <button type="button" className="mt-2 text-primary underline" onClick={() => void load()}>
            再試行
          </button>
        </div>
      ) : rankings.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          モデル情報を含む完了済みのセッション履歴がありません。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">プロバイダーとモデルのコスパランキング</caption>
            <thead className="border-b border-border text-xs text-faint">
              <tr>
                <th scope="col" className="px-4 py-3">順位</th>
                <th scope="col" className="px-4 py-3">プロバイダー / モデル</th>
                <th scope="col" className="px-4 py-3 text-right">トークン/$</th>
                <th scope="col" className="px-4 py-3 text-right">費用</th>
                <th scope="col" className="px-4 py-3 text-right">セッション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rankings.map((entry, index) => {
                const icon = providerIconSrcForOpencodeId(entry.providerID);
                return (
                  <tr key={`${entry.providerID}::${entry.modelID}`}>
                    <td className="px-4 py-3 font-semibold text-muted">{index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={icon} alt="" className="h-4 w-4 rounded object-contain" />
                        ) : null}
                        <span className="min-w-0 truncate">
                          <span className="block text-xs text-faint">{entry.providerID}</span>
                          <span className="block font-medium text-text">{entry.modelID}</span>
                        </span>
                        {entry.tokensPerDollar === null && <Badge tone="neutral">無料</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text">
                      {entry.tokensPerDollar === null ? "—" : Math.round(entry.tokensPerDollar).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">
                      {entry.cost > 0 ? formatCostValue(entry.cost, prefs) : "無料"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{entry.sessions}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
