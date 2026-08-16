import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Moon, Palette, Shell, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cx } from "@/components/ui";
import { NotificationSoundSettings } from "@/components/settings/NotificationSoundSettings";
import {
  CUSTOM_THEME_DEFAULT_TOKENS,
  CUSTOM_THEME_PARTS,
  clearCustomThemeTokens,
  dispatchCustomThemeChanged,
  resolveCustomThemeTokens,
  writeCustomThemeTokens,
} from "@/lib/custom-theme";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import {
  clampUsdJpyRate,
  DEFAULT_USD_JPY_RATE,
  formatCost,
  readCostDisplayPrefs,
  writeCostDisplayPrefs,
  type CostCurrency,
  type CostDisplayPrefs,
} from "@/lib/currency";
import {
  clampHangTimeoutMs,
  DEFAULT_HANG_TIMEOUT_MS,
  MAX_HANG_TIMEOUT_MS,
  MIN_HANG_TIMEOUT_MS,
  readHangTimeoutMs,
  subscribeHangTimeout,
  syncHangTimeoutToServer,
  writeHangTimeoutMs,
} from "@/lib/hang-timeout";
import {
  DEFAULT_TOKEN_SAVING_THRESHOLD,
  MAX_TOKEN_SAVING_THRESHOLD,
  MIN_TOKEN_SAVING_THRESHOLD,
  readTokenSavingMode,
  readTokenSavingThreshold,
  subscribeTokenSaving,
  syncTokenSavingToServer,
  writeTokenSavingMode,
  writeTokenSavingThreshold,
  type TokenSavingMode,
} from "@/lib/token-saving-settings";

interface GeneralSettingsTabProps {
  hostOk: boolean | null;
  workflowModeEnabled: boolean;
  setWorkflowModeEnabled: (enabled: boolean) => void;
  setError: (error: string | null) => void;
}

function CustomThemeEditor() {
  const [tokens, setTokens] = useState<Record<string, string>>(() =>
    resolveCustomThemeTokens(),
  );

  const update = (key: string, value: string) => {
    setTokens((prev) => {
      const next = { ...prev, [key]: value };
      writeCustomThemeTokens(next);
      dispatchCustomThemeChanged();
      return next;
    });
  };

  const reset = () => {
    setTokens({ ...CUSTOM_THEME_DEFAULT_TOKENS });
    clearCustomThemeTokens();
    dispatchCustomThemeChanged();
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2/60 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted">カスタムテーマの色</h4>
        <button
          type="button"
          onClick={reset}
          className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          デフォルトに戻す
        </button>
      </div>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {CUSTOM_THEME_PARTS.map(({ key, label }) => (
          <label
            key={key}
            className="flex min-w-0 items-center gap-2 text-xs text-muted"
          >
            <input
              type="color"
              value={tokens[key] ?? ""}
              onChange={(e) => update(key, e.target.value)}
              aria-label={`${label}の色`}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            <span className="shrink-0">{label}</span>
            <code className="ml-auto min-w-0 truncate font-mono text-[10px] text-faint">
              {tokens[key]}
            </code>
          </label>
        ))}
      </div>
      <p className="mt-2.5 text-[11px] text-faint">
        変更は即座に反映され、自動で保存されます（リビルド不要）。
      </p>
    </div>
  );
}

export function ThemeSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current = theme ?? "system";
  const resolved =
    resolvedTheme === "dark"
      ? "ダーク"
      : resolvedTheme === "oyster"
        ? "オフホワイト（オイスター）"
        : resolvedTheme === "custom"
          ? "カスタム"
          : "ライト";
  const options = [
    { key: "light", label: "ライト", description: "明るい配色で固定", icon: Sun },
    { key: "dark", label: "ダーク", description: "暗い配色で固定", icon: Moon },
    {
      key: "oyster",
      label: "オフホワイト",
      description: "温かみのあるオイスター系の明るい配色",
      icon: Shell,
    },
    {
      key: "custom",
      label: "カスタム",
      description: "各パーツの色を自由に指定",
      icon: Palette,
    },
    { key: "system", label: "システム", description: "OS の設定に合わせる", icon: Monitor },
  ] as const;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted">外観</h2>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-text">表示テーマ</h3>
          <p className="mt-1 text-xs text-faint">
            現在の表示は {mounted ? resolved : "読み込み中"} です。
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {options.map((option) => {
            const Icon = option.icon;
            const active = mounted && current === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme(option.key)}
                className={cx(
                  "flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-text"
                    : "border-border bg-bg/40 text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {mounted && current === "custom" && <CustomThemeEditor />}
      </div>
    </section>
  );
}

/**
 * Settings の「全般」タブ（REFACTORING_PLAN 5-c / IMPROVEMENT 1-1）。
 * 表示（外観 / コスト表示）→ 動作（起動 / タスク実行）の順に並べる。
 * ホストログと許可ルートは SettingsView 側でこの下に描画する。
 */
export function GeneralSettingsTab({
  hostOk,
  workflowModeEnabled,
  setWorkflowModeEnabled,
  setError,
}: GeneralSettingsTabProps) {
  const [autoOpenBrowser, setAutoOpenBrowser] = useState(false);
  const [browserConfigBusy, setBrowserConfigBusy] = useState(false);
  const [workflowModeBusy, setWorkflowModeBusy] = useState(false);
  const [costPrefs, setCostPrefs] = useState<CostDisplayPrefs>(() =>
    readCostDisplayPrefs(),
  );
  const [rateDraft, setRateDraft] = useState(() =>
    String(readCostDisplayPrefs().usdJpyRate),
  );
  const [hangTimeoutMinutes, setHangTimeoutMinutes] = useState(() =>
    String(readHangTimeoutMs() / 60_000),
  );
  const [tokenSavingMode, setTokenSavingMode] = useState<TokenSavingMode>(
    () => readTokenSavingMode(),
  );
  const [tokenSavingThreshold, setTokenSavingThreshold] = useState(() =>
    String(readTokenSavingThreshold()),
  );
  const [fxStatus, setFxStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; rate: number; asOf: string }
    | { kind: "error" }
  >({ kind: "idle" });
  const autoRateRequestGeneration = useRef(0);

  useEffect(() => {
    const prefs = readCostDisplayPrefs();
    setCostPrefs(prefs);
    setRateDraft(String(prefs.usdJpyRate));
  }, []);

  const applyCostPrefs = useCallback((next: CostDisplayPrefs) => {
    setCostPrefs(next);
    setRateDraft(String(next.usdJpyRate));
    writeCostDisplayPrefs(next);
  }, []);

  const refreshAutoRate = useCallback(async () => {
    const requestGeneration = ++autoRateRequestGeneration.current;
    setFxStatus({ kind: "loading" });
    try {
      const res = await timedFetch("/api/fx/usd-jpy");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rate?: unknown; asOf?: unknown };
      const rate =
        typeof data.rate === "number"
          ? data.rate
          : typeof data.rate === "string"
            ? Number(data.rate)
            : Number.NaN;
      if (!Number.isFinite(rate) || typeof data.asOf !== "string") {
        throw new Error("Invalid FX response");
      }
      if (requestGeneration !== autoRateRequestGeneration.current) return;
      const latest = readCostDisplayPrefs();
      if (latest.rateMode !== "auto") return;
      applyCostPrefs({ ...latest, rateMode: "auto", usdJpyRate: rate });
      setFxStatus({ kind: "ok", rate, asOf: data.asOf });
    } catch {
      if (requestGeneration === autoRateRequestGeneration.current) {
        setFxStatus({ kind: "error" });
      }
    }
  }, [applyCostPrefs]);

  const setCurrency = (currency: CostCurrency) => {
    applyCostPrefs({ ...costPrefs, currency });
  };

  const setRateMode = (rateMode: CostDisplayPrefs["rateMode"]) => {
    applyCostPrefs({ ...costPrefs, rateMode });
    if (rateMode === "auto") void refreshAutoRate();
  };

  const setShowUsdSuffix = (showUsdSuffix: boolean) => {
    applyCostPrefs({ ...costPrefs, showUsdSuffix });
  };

  const commitRate = () => {
    const n = Number(rateDraft);
    // Clamp before saving to match the clamp applied when reading back (R9#2).
    // Without this, out-of-range values are saved as-is but displayed clamped,
    // causing a mismatch between the input and the actual rate used.
    const usdJpyRate = clampUsdJpyRate(Number.isFinite(n) ? n : DEFAULT_USD_JPY_RATE);
    setRateDraft(String(usdJpyRate));
    applyCostPrefs({ ...costPrefs, rateMode: "manual", usdJpyRate });
  };

  useEffect(() => {
    if (readCostDisplayPrefs().rateMode === "auto") void refreshAutoRate();
  }, [refreshAutoRate]);

  useEffect(() => {
    void getJson<{ autoOpenBrowser?: boolean }>("/api/host/browser-config")
      .then((config) => setAutoOpenBrowser(config.autoOpenBrowser === true))
      .catch(() => {});
  }, []);

  const toggleAutoOpenBrowser = async (enabled: boolean) => {
    setBrowserConfigBusy(true);
    try {
      const result = await sendJson<{ ok?: boolean; autoOpenBrowser?: boolean; error?: string }>(
        "POST",
        "/api/host/browser-config",
        { autoOpenBrowser: enabled },
      );
      if (!result.ok) throw new Error(result.error || "保存に失敗しました");
      setAutoOpenBrowser(result.autoOpenBrowser === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ブラウザ起動設定の保存に失敗しました");
    } finally {
      setBrowserConfigBusy(false);
    }
  };

  const toggleWorkflowMode = async (enabled: boolean) => {
    setWorkflowModeBusy(true);
    try {
      await sendJson("PUT", "/api/settings/workflow-mode", {
        value: enabled ? "1" : "",
      });
      setWorkflowModeEnabled(enabled);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ワークフロー設定の保存に失敗しました",
      );
    } finally {
      setWorkflowModeBusy(false);
    }
  };

  useEffect(
    () =>
      subscribeHangTimeout(() =>
        setHangTimeoutMinutes(String(readHangTimeoutMs() / 60_000)),
      ),
    [],
  );

  useEffect(
    () =>
      subscribeTokenSaving(() => {
        setTokenSavingMode(readTokenSavingMode());
        setTokenSavingThreshold(String(readTokenSavingThreshold()));
      }),
    [],
  );

  const commitTokenSavingMode = (mode: TokenSavingMode) => {
    setTokenSavingMode(mode);
    writeTokenSavingMode(mode);
    void syncTokenSavingToServer(mode, readTokenSavingThreshold());
  };

  const commitTokenSavingThreshold = () => {
    const n = Number(tokenSavingThreshold);
    const clamped = Number.isFinite(n)
      ? Math.min(
          MAX_TOKEN_SAVING_THRESHOLD,
          Math.max(MIN_TOKEN_SAVING_THRESHOLD, Math.round(n)),
        )
      : DEFAULT_TOKEN_SAVING_THRESHOLD;
    writeTokenSavingThreshold(clamped);
    setTokenSavingThreshold(String(clamped));
    void syncTokenSavingToServer(readTokenSavingMode(), clamped);
  };

  const commitHangTimeout = () => {
    const minutes = Number(hangTimeoutMinutes);
    const milliseconds = clampHangTimeoutMs(
      (Number.isFinite(minutes) ? minutes : DEFAULT_HANG_TIMEOUT_MS / 60_000) * 60_000,
    );
    writeHangTimeoutMs(milliseconds);
    setHangTimeoutMinutes(String(milliseconds / 60_000));
    void syncHangTimeoutToServer(milliseconds);
  };

  return (
    <>
      <ThemeSettings />
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted">コスト表示</h2>
        <p className="mb-3 text-xs text-faint">
          OpenCode のコストは USD 基準です。日本円は自動（当日レート）または手動レートで換算します。
        </p>
        <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "USD" as const, label: "米ドル ($)" },
                { value: "JPY" as const, label: "日本円 (¥)" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={costPrefs.currency === opt.value}
                onClick={() => setCurrency(opt.value)}
                className={
                  costPrefs.currency === opt.value
                    ? "rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent"
                    : "rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "auto" as const, label: "自動（本日）" },
                { value: "manual" as const, label: "手動" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={costPrefs.rateMode === opt.value}
                onClick={() => setRateMode(opt.value)}
                className={
                  costPrefs.rateMode === opt.value
                    ? "rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent"
                    : "rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 text-xs text-muted">USD/JPY レート</span>
            <input
              type="number"
              min={1}
              max={1000}
              step={0.1}
              value={rateDraft}
              aria-label="USD/JPY レート"
              disabled={costPrefs.rateMode === "auto"}
              onChange={(e) => setRateDraft(e.target.value)}
              onBlur={() => commitRate()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              className="h-9 w-full max-w-[10rem] rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
            />
            <span className="text-[11px] text-faint">
              例:{" "}
              {formatCost(0.1542, {
                currency: "JPY",
                rateMode: costPrefs.rateMode,
                usdJpyRate: Number(rateDraft) || costPrefs.usdJpyRate,
                showUsdSuffix: costPrefs.showUsdSuffix,
              })}
            </span>
          </label>
          {costPrefs.currency === "JPY" && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={costPrefs.showUsdSuffix}
                onChange={(e) => setShowUsdSuffix(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              <span>USD ($) を併記</span>
            </label>
          )}
          {costPrefs.rateMode === "auto" && (
            <p className="text-[11px] text-faint">
              {fxStatus.kind === "loading" && "読み込み中…"}
              {fxStatus.kind === "ok" &&
                `本日 ${fxStatus.rate}円（${fxStatus.asOf}）`}
              {fxStatus.kind === "error" &&
                `取得失敗 — 既存レート ${costPrefs.usdJpyRate} を使用`}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted">起動</h2>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <label className="flex items-start gap-3 text-sm text-muted">
            <input
              type="checkbox"
              checked={autoOpenBrowser}
              disabled={browserConfigBusy || hostOk !== true}
              onChange={(event) => void toggleAutoOpenBrowser(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span>
              <span className="block text-text">EXE 起動時にブラウザを自動で開く</span>
              <span className="mt-1 block text-xs text-faint">
                デフォルトはオフです。設定は次回の EXE 起動から反映されます。
              </span>
            </span>
          </label>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted">タスク実行</h2>
        <div className="mb-6 rounded-xl border border-border bg-surface px-4 py-3">
          <label className="flex items-start gap-3 text-sm text-muted">
            <input
              type="checkbox"
              checked={workflowModeEnabled}
              disabled={workflowModeBusy}
              onChange={(event) => void toggleWorkflowMode(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span>
              <span className="block text-text">ワークフロー機能を有効化</span>
              <span className="mt-1 block text-xs text-faint">
                デフォルトはオフです。オンにするとホーム画面の開始モードで「Workflowで開始」を選べるようになります（Implement → Review の固定フロー）。即時反映されます。
              </span>
            </span>
          </label>
        </div>
        <div className="mb-6 rounded-xl border border-border bg-surface px-4 py-3">
          <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 text-sm text-muted">ハング判定時間</span>
            <input
              type="number"
              min={MIN_HANG_TIMEOUT_MS / 60_000}
              max={MAX_HANG_TIMEOUT_MS / 60_000}
              step={0.5}
              value={hangTimeoutMinutes}
              aria-label="ハング判定時間"
              onChange={(event) => setHangTimeoutMinutes(event.target.value)}
              onBlur={commitHangTimeout}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-9 w-full max-w-[10rem] rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
              aria-describedby="hang-timeout-help"
            />
            <span className="text-xs text-faint">分</span>
          </label>
          <p id="hang-timeout-help" className="mt-2 text-[11px] text-faint">
            応答がない状態がこの時間続いた場合、自動停止して同じ処理を1回だけ再開します（0.17〜30分）。
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <h3 className="text-sm font-semibold text-text">トークン節約</h3>
          <p className="mt-1 text-xs text-faint">
            コンテキスト使用量が閾値に達したときの動作を選択します。手動送信時のみ動作し、Goal Loopには適用されません。
          </p>
          <label className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 text-sm text-muted">動作</span>
            <select
              value={tokenSavingMode}
              aria-label="トークン節約モード"
              onChange={(event) => {
                const mode = event.target.value;
                if (mode === "off" || mode === "suggest" || mode === "auto") {
                  commitTokenSavingMode(mode);
                }
              }}
              className="h-9 w-full max-w-[14rem] rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-border-strong"
            >
              <option value="off">オフ</option>
              <option value="suggest">提案</option>
              <option value="auto">自動compact</option>
            </select>
          </label>
          <label className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 text-sm text-muted">コンテキスト使用率の閾値</span>
            <input
              type="number"
              min={MIN_TOKEN_SAVING_THRESHOLD}
              max={MAX_TOKEN_SAVING_THRESHOLD}
              step={1}
              value={tokenSavingThreshold}
              aria-label="コンテキスト使用率の閾値"
              onChange={(event) => setTokenSavingThreshold(event.target.value)}
              onBlur={commitTokenSavingThreshold}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-9 w-full max-w-[10rem] rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
              aria-describedby="token-saving-threshold-help"
            />
            <span className="text-xs text-faint">%</span>
          </label>
          <p id="token-saving-threshold-help" className="mt-2 text-[11px] text-faint">
            {tokenSavingMode === "off"
              ? "オフの場合は閾値に関わらず自動compactしません。"
              : tokenSavingMode === "suggest"
                ? `使用率が${readTokenSavingThreshold()}%に達したらcompactを提案します（${MIN_TOKEN_SAVING_THRESHOLD}〜${MAX_TOKEN_SAVING_THRESHOLD}%）。`
                : `使用率が${readTokenSavingThreshold()}%に達したら送信前にcompactを自動実行します（${MIN_TOKEN_SAVING_THRESHOLD}〜${MAX_TOKEN_SAVING_THRESHOLD}%）。`}
          </p>
        </div>
      </section>
      <NotificationSoundSettings />
    </>
  );
}
