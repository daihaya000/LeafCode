"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
} from "lucide-react";
import { cx, timeAgo } from "@/components/ui";
import { getJson } from "@/lib/client";
import {
  clampPercent,
  formatResetsIn,
  isStale,
  providerLabel,
  usageTone,
  worstProvider,
  type CodexBarProvider,
  type CodexBarUsage,
  type UsageTone,
} from "@/lib/plugins/codexbar";
import { writePluginEnabled } from "@/lib/plugins/state";

export const CODEXBAR_PLUGIN_ID = "codexbar-usage";

const POLL_MS = 30_000;
const COLLAPSED_KEY = "webui:plugin:codexbar:collapsed";

const barClass: Record<UsageTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-danger",
};
const textClass: Record<UsageTone, string> = {
  ok: "text-muted",
  warn: "text-warning",
  danger: "text-danger",
};

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function saveCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function ProviderRow({ p, now }: { p: CodexBarProvider; now: number }) {
  const tone = usageTone(p);
  const resets = formatResetsIn(p.resetsAt, now);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium text-text">{providerLabel(p.id)}</span>
        {p.error ? (
          <span className="flex shrink-0 items-center gap-1 text-danger">
            <AlertTriangle className="h-3 w-3" /> エラー
          </span>
        ) : (
          <span className={cx("shrink-0 font-mono", textClass[tone])}>
            {p.usedPercent === null ? "—" : `${Math.round(p.usedPercent)}%`}
          </span>
        )}
      </div>
      {!p.error && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={cx("h-full rounded-full transition-all", barClass[tone])}
            style={{ width: `${clampPercent(p.usedPercent)}%` }}
          />
        </div>
      )}
      {(resets || p.error) && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-faint">
          <span className="truncate">{p.error ?? ""}</span>
          {resets && <span className="shrink-0">リセット {resets}</span>}
        </div>
      )}
    </li>
  );
}

export function CodexBarWidget() {
  const [usage, setUsage] = useState<CodexBarUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getJson<CodexBarUsage>("/api/plugins/codexbar/usage");
      if (!mounted.current) return;
      setUsage(data);
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setCollapsed(loadCollapsed());
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refresh();
      }
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      saveCollapsed(next);
      return next;
    });
  };

  const worst = usage ? worstProvider(usage) : null;
  const summaryTone: UsageTone = worst ? usageTone(worst) : "ok";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label="CodexBar 利用状況を開く"
        title="CodexBar 利用状況を開く"
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs shadow-lg hover:bg-surface-2"
      >
        <Activity className={cx("h-3.5 w-3.5", textClass[summaryTone])} />
        <span className="font-medium text-text">CodexBar</span>
        {worst && !worst.error && worst.usedPercent !== null && (
          <span className={cx("font-mono", textClass[summaryTone])}>
            {Math.round(worst.usedPercent)}%
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="w-64 rounded-xl border border-border bg-surface shadow-xl">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Activity className={cx("h-4 w-4", textClass[summaryTone])} />
        <span className="flex-1 truncate text-xs font-semibold text-text">
          CodexBar 利用状況
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          title="更新"
          className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text"
        >
          <RefreshCw className={cx("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "開く" : "折りたたむ"}
          className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text"
        >
          {collapsed ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => writePluginEnabled(CODEXBAR_PLUGIN_ID, false)}
          title="このウィジェットを閉じる（設定から再表示できます）"
          className="rounded-md p-1 text-faint hover:bg-danger-bg hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5">
        {loadError && (
          <p className="text-[11px] text-danger">読み込みエラー: {loadError}</p>
        )}
        {!loadError && !usage && (
          <p className="text-[11px] text-faint">読み込み中…</p>
        )}
        {!loadError && usage && !usage.available && (
          <p className="text-[11px] text-faint">{usage.reason}</p>
        )}
        {!loadError && usage && usage.available && usage.providers.length === 0 && (
          <p className="text-[11px] text-faint">プロバイダー情報がありません</p>
        )}
        {!loadError && usage && usage.available && usage.providers.length > 0 && (
          <ul className="space-y-2.5">
            {usage.providers.map((p) => (
              <ProviderRow key={p.id} p={p} now={now} />
            ))}
          </ul>
        )}
      </div>

      {usage?.available && usage.generatedAt && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[10px] text-faint">
          <span>更新 {timeAgo(usage.generatedAt)}</span>
          {isStale(usage.generatedAt, now) && (
            <span className="text-warning">古い可能性（CodexBar 停止中?）</span>
          )}
        </div>
      )}
    </div>
  );
}
