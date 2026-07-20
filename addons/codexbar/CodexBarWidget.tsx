"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  X,
} from "lucide-react";
import { cx, timeAgo } from "@/components/ui";
import { getJson } from "@/lib/client";
import {
  clampPercent,
  formatMonthlyTotal,
  formatPlanBadge,
  formatResetsIn,
  isStale,
  limitedCount,
  overallUsedPercent,
  percentTone,
  providerIconSrc,
  providerLabel,
  usageTone,
  worstProvider,
  type CodexBarCredits,
  type CodexBarProvider,
  type CodexBarUsage,
  type UsageTone,
} from "./lib/codexbar";
import { formatTokens, type CodexTokensResult } from "./lib/codex-tokens";
import { writeAddonEnabled } from "@/lib/addons/state";

export const CODEXBAR_ADDON_ID = "codexbar-usage";

const POLL_MS = 30_000;
const COLLAPSED_KEY = "webui:addon:codexbar:collapsed";
const LEGACY_COLLAPSED_KEY = "webui:plugin:codexbar:collapsed";
const PROVIDERS_KEY = "webui:addon:codexbar:providers";
const LEGACY_PROVIDERS_KEY = "webui:plugin:codexbar:providers";

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

function readMigratedItem(key: string, legacyKey: string): string | null {
  const saved = localStorage.getItem(key);
  if (saved !== null) return saved;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy === null) return null;
  localStorage.setItem(key, legacy);
  localStorage.removeItem(legacyKey);
  return legacy;
}

function loadCollapsed(): boolean {
  try {
    const saved = readMigratedItem(COLLAPSED_KEY, LEGACY_COLLAPSED_KEY);
    // An expanded fixed widget obscures the composer on phones and narrower
    // desktop windows. Keep it discoverable as a compact pill until the user
    // explicitly opens it, while preserving an existing preference.
    return saved === null ? true : saved === "1";
  } catch {
    return true;
  }
}
function saveCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
    localStorage.removeItem(LEGACY_COLLAPSED_KEY);
  } catch {
    /* ignore */
  }
}

/** Per-provider collapsed map: { [providerId]: true } means minimized. */
function loadProviderCollapsed(): Record<string, boolean> {
  try {
    const raw = readMigratedItem(PROVIDERS_KEY, LEGACY_PROVIDERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === true) out[k] = true;
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}
function saveProviderCollapsed(map: Record<string, boolean>) {
  try {
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(map));
    localStorage.removeItem(LEGACY_PROVIDERS_KEY);
  } catch {
    /* ignore */
  }
}

function OverallRow({
  percent,
  subscriptionTotalMonthlyUsd,
}: {
  percent: number;
  subscriptionTotalMonthlyUsd: number | null;
}) {
  const tone = percentTone(percent);
  return (
    <div className="mb-2.5 border-b border-border pb-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-text">全体</span>
        {subscriptionTotalMonthlyUsd !== null && subscriptionTotalMonthlyUsd > 0 && (
          <span
            className="shrink-0 rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted"
            title="サブスク合計（公開定価の概算）"
          >
            {formatMonthlyTotal(subscriptionTotalMonthlyUsd)}
          </span>
        )}
        <span className={cx("ml-auto font-mono", textClass[tone])}>
          {Math.round(percent)}%
        </span>
      </div>
      <UsageBar tone={tone} percent={percent} />
    </div>
  );
}

function ProviderIcon({ id, tone }: { id: string; tone: UsageTone }) {
  const [broken, setBroken] = useState(false);
  const src = providerIconSrc(id);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return <Activity className={cx("h-4 w-4 shrink-0", textClass[tone])} />;
}

function UsageBar({
  tone,
  percent,
}: {
  tone: UsageTone;
  percent: number | null;
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={cx("h-full rounded-full transition-all", barClass[tone])}
        style={{ width: `${clampPercent(percent)}%` }}
      />
    </div>
  );
}

function WindowRow({
  title,
  percent,
  resetsAt,
  now,
}: {
  title: string;
  percent: number | null;
  resetsAt: string | null;
  now: number;
}) {
  const tone = percentTone(percent);
  const resets = formatResetsIn(resetsAt, now);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-muted">{title}</span>
        <span className={cx("shrink-0 font-mono", textClass[tone])}>
          {percent === null ? "—" : `${Math.round(percent)}%`}
        </span>
      </div>
      <UsageBar tone={tone} percent={percent} />
      {resets && (
        <div className="text-right text-[10px] text-faint">リセット {resets}</div>
      )}
    </div>
  );
}

function formatCreditAmount(value: number): string {
  return `$${value.toFixed(2)}`;
}

function CreditsRow({ credits }: { credits: CodexBarCredits }) {
  const percent =
    credits.used !== null && credits.limit !== null && credits.limit > 0
      ? (credits.used / credits.limit) * 100
      : null;
  const tone = percentTone(percent);
  const amount =
    credits.used !== null && credits.limit !== null
      ? `${formatCreditAmount(credits.used)} / ${formatCreditAmount(credits.limit)}`
      : credits.used !== null
        ? formatCreditAmount(credits.used)
        : credits.limit !== null
          ? `上限 ${formatCreditAmount(credits.limit)}`
          : null;

  return (
    <div className="flex flex-col gap-0.5 border-t border-border pt-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-muted">
          {credits.title ?? "利用クレジット"}
        </span>
        {amount && <span className="shrink-0 font-mono text-text">{amount}</span>}
      </div>
      {percent !== null && (
        <>
          <UsageBar tone={tone} percent={percent} />
          <div className={cx("text-right text-[10px] font-mono", textClass[tone])}>
            {Math.round(percent)}%
          </div>
        </>
      )}
      {credits.balance !== null && (
        <div className="text-right text-[10px] text-faint">
          残高 {formatCreditAmount(credits.balance)}
        </div>
      )}
    </div>
  );
}

function ProviderRow({
  p,
  now,
  collapsed,
  onToggle,
}: {
  p: CodexBarProvider;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const tone = usageTone(p);
  const resets = formatResetsIn(p.resetsAt, now);
  const hasWindows = p.windows.length > 0;
  // Prefer last-good usage when present (matches CodexBar WinForms). Only treat
  // as a pure error card when there is nothing else to show.
  const showErrorOnly =
    !!p.error && !hasWindows && p.usedPercent === null && p.credits === null;
  const canExpand =
    showErrorOnly || hasWindows || p.usedPercent !== null || p.credits !== null;
  const label = providerLabel(p.id);
  const planBadge = formatPlanBadge(p.plan, p.planMonthlyUsd);

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/40 p-2">
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        aria-expanded={canExpand ? !collapsed : undefined}
        aria-label={
          canExpand ? `${label} を${collapsed ? "展開" : "最小化"}` : undefined
        }
        className={cx(
          "flex w-full items-center gap-2 text-xs",
          canExpand && "cursor-pointer rounded-md -mx-1 px-1 py-0.5 hover:bg-surface-3",
        )}
      >
        <ProviderIcon id={p.id} tone={showErrorOnly ? "danger" : tone} />
        <span className="min-w-0 flex-1 truncate font-semibold text-text">{label}</span>
        {planBadge && (
          <span
            className="max-w-28 shrink truncate rounded border border-border bg-surface-3 px-1 text-[10px] font-medium text-muted"
            title={`プラン: ${planBadge}`}
          >
            {planBadge}
          </span>
        )}
        {showErrorOnly ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-danger">
            <AlertTriangle className="h-3 w-3" /> エラー
          </span>
        ) : (
          <span className={cx("ml-auto shrink-0 font-mono", textClass[tone])}>
            {p.usedPercent === null ? "—" : `${Math.round(p.usedPercent)}%`}
          </span>
        )}
        {canExpand &&
          (collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
          ))}
      </button>

      {collapsed ? (
        showErrorOnly ? null : (
          <div className="pl-6">
            <UsageBar tone={tone} percent={p.usedPercent} />
          </div>
        )
      ) : showErrorOnly ? (
        <p className="pl-6 text-[10px] text-faint">{p.error}</p>
      ) : canExpand ? (
        <div className="flex flex-col gap-1.5 pl-6">
          {p.windows.map((w) => (
            <WindowRow
              key={w.id || w.title}
              title={w.title || "—"}
              percent={w.usedPercent}
              resetsAt={w.resetsAt}
              now={now}
            />
          ))}
          {!hasWindows && p.usedPercent !== null && (
            <div>
              <UsageBar tone={tone} percent={p.usedPercent} />
              {resets && (
                <div className="text-right text-[10px] text-faint">
                  リセット {resets}
                </div>
              )}
            </div>
          )}
          {p.credits && <CreditsRow credits={p.credits} />}
        </div>
      ) : (
        <div className="pl-6">
          <UsageBar tone={tone} percent={p.usedPercent} />
        </div>
      )}
    </li>
  );
}

export function CodexBarWidget() {
  const [usage, setUsage] = useState<CodexBarUsage | null>(null);
  const [tokens, setTokens] = useState<CodexTokensResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [providerCollapsed, setProviderCollapsed] = useState<Record<string, boolean>>(
    {},
  );
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getJson<CodexBarUsage>("/api/addons/codexbar/usage");
      if (!mounted.current) return;
      setUsage(data);
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
    // Token totals are best-effort and independent of the usage snapshot.
    try {
      const tok = await getJson<CodexTokensResult>("/api/addons/codexbar/tokens", {
        days: "1",
      });
      if (mounted.current) setTokens(tok);
    } catch {
      /* leave previous tokens value */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setCollapsed(loadCollapsed());
    setProviderCollapsed(loadProviderCollapsed());
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

  const toggleProvider = useCallback((id: string) => {
    setProviderCollapsed((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      saveProviderCollapsed(next);
      return next;
    });
  }, []);

  const worst = usage ? worstProvider(usage) : null;
  // Tone reflects the busiest provider so urgency isn't hidden, but the shown
  // value is the overall (mean) usage across providers, not just the max.
  const summaryTone: UsageTone = worst ? usageTone(worst) : "ok";
  const overall = usage ? overallUsedPercent(usage) : null;
  const limited = usage ? limitedCount(usage) : 0;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label="CodexBar 利用状況を開く"
        title="CodexBar 利用状況を開く（全体平均）"
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs shadow-lg hover:bg-surface-2"
      >
        <Activity className={cx("h-3.5 w-3.5", textClass[summaryTone])} />
        <span className="font-medium text-text">CodexBar</span>
        {overall !== null && (
          <span className="font-mono text-muted">全体 {Math.round(overall)}%</span>
        )}
        {limited > 0 && (
          <span className="rounded-full bg-danger-bg px-1.5 font-mono text-danger">
            {limited} 制限
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex max-h-[80vh] w-full min-w-0 flex-col rounded-xl border border-border bg-surface shadow-xl">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
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
          onClick={() => writeAddonEnabled(CODEXBAR_ADDON_ID, false)}
          title="このウィジェットを閉じる（設定から再表示できます）"
          className="rounded-md p-1 text-faint hover:bg-danger-bg hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {usage?.available && overall !== null && (
          <OverallRow
            percent={overall}
            subscriptionTotalMonthlyUsd={usage.subscriptionTotalMonthlyUsd}
          />
        )}
        {tokens?.available && tokens.totals.totalTokens > 0 && (
          <div
            className="mb-2.5 flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]"
            title={`${tokens.totals.totalTokens.toLocaleString()} tokens across ${tokens.sessions} sessions (last 24h)`}
          >
            <span className="text-muted">直近24h トークン</span>
            <span className="font-mono text-text">
              {formatTokens(tokens.totals.totalTokens)} · {tokens.sessions}
              <span className="text-faint">s</span>
            </span>
          </div>
        )}
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
              <ProviderRow
                key={p.id}
                p={p}
                now={now}
                collapsed={!!providerCollapsed[p.id]}
                onToggle={() => toggleProvider(p.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {usage?.available && usage.generatedAt && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[10px] text-faint">
          <span>更新 {timeAgo(usage.generatedAt)}</span>
          {isStale(usage.generatedAt, now) && (
            <span className="text-warning">古い可能性（CodexBar 停止中?）</span>
          )}
        </div>
      )}
    </div>
  );
}
