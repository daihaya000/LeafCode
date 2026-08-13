"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Monitor,
  Moon,
  Sun,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";
import { AgentsSettings } from "@/components/settings/AgentsSettings";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";
import { ProfilesSettings } from "@/components/settings/ProfilesSettings";
import { ProfileSyncSettings } from "@/components/settings/ProfileSyncSettings";
import { ProfileAgentsSyncSettings } from "@/components/settings/ProfileAgentsSyncSettings";
import { ProviderModelsSettings } from "@/components/settings/ProviderModelsSettings";
import { ConnectivitySettingsTab } from "./ConnectivitySettingsTab";
import { EngineSettingsTab } from "./EngineSettingsTab";
import { GitSettingsTab } from "./GitSettingsTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import { ModelRankingSettings } from "@/components/settings/ModelRankingSettings";
import { MemorySettings } from "@/components/settings/MemorySettings";
import { VisionSettings } from "@/components/settings/VisionSettings";
import { AddonSettings } from "@/components/addons/AddonSettings";
import { HostLogPanel } from "@/components/settings/HostLogPanel";
import { Button, cx, Spinner } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
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
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";
import { useMobileScrollTarget } from "@/components/shell/MobileScrollTargetContext";
import {
  type AuthConfig,
  deleteAuthUser,
  fetchAuthConfig,
  listAuthUsers,
  type AuthUser,
  setWindowsAuthEnabled,
  upsertAuthUser,
} from "@/lib/auth";
import type { HealthDto, ProjectDto, UpdateAvailability } from "@/lib/types";
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

type OrphanDto = {
  id: string;
  displayName: string;
  absolutePath: string;
};

type StrayDto = { projectId: string; projectName: string; path: string };


type SettingsTab =
  | "engine"
  | "general"
  | "project"
  | "connectivity"
  | "git"
  | "skills"
  | "mcp"
  | "plugins"
  | "addons"
  | "agents"
  | "providers"
  | "ranking"
  | "profiles"
  | "users"
  | "memory"
  | "vision";




function ThemeSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current = theme ?? "system";
  const resolved = resolvedTheme === "dark" ? "ダーク" : "ライト";
  const options = [
    { key: "light", label: "ライト", description: "明るい配色で固定", icon: Sun },
    { key: "dark", label: "ダーク", description: "暗い配色で固定", icon: Moon },
    { key: "system", label: "システム", description: "OS の設定に合わせる", icon: Monitor },
  ] as const;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted">テーマ</h2>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-text">表示テーマ</h3>
          <p className="mt-1 text-xs text-faint">
            左サイドバーから移動したテーマ切替です。現在の表示は{" "}
            {mounted ? resolved : "読み込み中"} です。
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
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
      </div>
    </section>
  );
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("engine");
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [hostOk, setHostOk] = useState<boolean | null>(null);
  const [autoOpenBrowser, setAutoOpenBrowser] = useState(false);
  const [browserConfigBusy, setBrowserConfigBusy] = useState(false);
  const [updateAvailability, setUpdateAvailability] = useState<{
    webui: UpdateAvailability;
    opencode: UpdateAvailability;
    nextjs: UpdateAvailability;
  } | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectDto[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [orphans, setOrphans] = useState<OrphanDto[]>([]);
const [stray, setStray] = useState<StrayDto[]>([]);
const [busy, setBusy] = useState(false);
const [error, setError] = useState<string | null>(null);
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
  const [workflowModeEnabled, setWorkflowModeEnabled] = useState(false);
  const [workflowModeBusy, setWorkflowModeBusy] = useState(false);
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [fxStatus, setFxStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; rate: number; asOf: string }
    | { kind: "error" }
  >({ kind: "idle" });
  const autoRateRequestGeneration = useRef(0);
  const mountedRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      autoRateRequestGeneration.current += 1;
    };
  }, []);

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

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    const [h, p, r, o, host, updates, ap] = await Promise.allSettled([
      getJson<HealthDto>("/api/health"),
      getJson<{ projects: ProjectDto[] }>("/api/projects"),
      getJson<{ roots: string[] }>("/api/roots"),
      getJson<{ orphans: OrphanDto[]; stray: StrayDto[] }>(
        "/api/workspaces/orphans",
        { scan: "1" },
      ),
      timedFetch("/api/host", { timeoutMs: 1500 }).then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        return { ok: res.ok && Boolean(body.ok) };
      }),
      getJson<{
        webui: UpdateAvailability;
        opencode: UpdateAvailability;
        nextjs: UpdateAvailability;
      }>("/api/updates/status"),
      getJson<{ projects: ProjectDto[] }>("/api/projects/archived"),
    ]);
    if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
    if (h.status === "fulfilled") {
      setHealth(h.value);
      setWorkflowModeEnabled(h.value.workflowModeEnabled === true);
    }
    if (p.status === "fulfilled") setProjects(p.value.projects ?? []);
    if (r.status === "fulfilled") setRoots(r.value.roots ?? []);
    if (o.status === "fulfilled") {
      setOrphans(o.value.orphans ?? []);
      setStray(o.value.stray ?? []);
    }
    if (host.status === "fulfilled") setHostOk(host.value.ok);
    else setHostOk(false);
    if (updates.status === "fulfilled") setUpdateAvailability(updates.value);
    if (ap.status === "fulfilled")
      setArchivedProjects(ap.value.projects ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeTab !== "general") return;
    void getJson<{ autoOpenBrowser?: boolean }>("/api/host/browser-config")
      .then((config) => setAutoOpenBrowser(config.autoOpenBrowser === true))
      .catch(() => {});
  }, [activeTab]);

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

  const refreshAuthUsers = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const [users, config] = await Promise.all([listAuthUsers(), fetchAuthConfig()]);
      setAuthUsers(users);
      setAuthConfig(config);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "ユーザー一覧の取得に失敗しました");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const toggleWindowsAuth = async (enabled: boolean) => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthSuccess(null);
    const result = await setWindowsAuthEnabled(enabled);
    setAuthBusy(false);
    if (!result.ok) {
      setAuthError(result.error);
      return;
    }
    setAuthConfig(result.config);
    setAuthSuccess(
      enabled
        ? "Windows アカウントでのログインを有効にしました"
        : "Windows アカウントでのログインを無効にしました",
    );
  };

  useEffect(() => {
    if (activeTab === "users") {
      void refreshAuthUsers();
    }
  }, [activeTab, refreshAuthUsers]);

  const addUser = async () => {
    const username = newUsername.trim();
    const password = newPassword;
    if (!username || !password) {
      setAuthError("ユーザー名とパスワードを入力してください");
      return;
    }
    if (password.length < 4) {
      setAuthError("パスワードは 4 文字以上にしてください");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    setAuthSuccess(null);
    const result = await upsertAuthUser(username, password);
    setAuthBusy(false);
    if (!result.ok) {
      setAuthError(result.error);
      return;
    }
    setAuthSuccess(`ユーザー「${username}」を保存しました`);
    setNewUsername("");
    setNewPassword("");
    await refreshAuthUsers();
  };

  const removeUser = async (username: string) => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthSuccess(null);
    const result = await deleteAuthUser(username);
    setAuthBusy(false);
    if (!result.ok) {
      setAuthError(result.error);
      return;
    }
    setAuthSuccess(`ユーザー「${username}」を削除しました`);
    await refreshAuthUsers();
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


  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
        notifyTasksChanged();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "操作に失敗しました");
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh],
  );



  const requiresAttention = orphans.length + stray.length;
  const setScrollTarget = useMobileScrollTarget();

  const tabs: { key: SettingsTab; label: string; badge?: number }[] = [
    { key: "engine", label: "エンジン" },
    { key: "general", label: "全般" },
    { key: "profiles", label: "プロファイル" },
    {
      key: "project",
      label: "プロジェクト",
      badge: requiresAttention > 0 ? requiresAttention : undefined,
    },
    { key: "connectivity", label: "接続" },
    { key: "git", label: "Git" },
    { key: "providers", label: "プロバイダー/モデル" },
    { key: "ranking", label: "コスパランキング" },
    { key: "agents", label: "エージェント" },
    { key: "skills", label: "スキル" },
    { key: "mcp", label: "MCP" },
    { key: "plugins", label: "プラグイン" },
    { key: "addons", label: "アドオン" },
    { key: "users", label: "ユーザー" },
    { key: "memory", label: "メモリ" },
    { key: "vision", label: "画像解析" },
  ];
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement>>>({});
  const moveTab = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length]!;
    setActiveTab(next.key);
    tabRefs.current[next.key]?.focus();
  };
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTab(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTab(tabs.length - 1);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MobileMenuHeader />
      <div
        ref={setScrollTarget}
        className="min-h-0 flex-1 overflow-y-auto"
      >
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-14 items-center">
            <h1 className="text-sm font-semibold">設定</h1>
          </div>
          <div className="relative">
            <div
              role="tablist"
              aria-label="設定カテゴリ"
              tabIndex={0}
              className="flex gap-x-2 overflow-x-auto rounded-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:flex-wrap sm:overflow-visible"
            >
            {tabs.map((t, index) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`settings-tab-${t.key}`}
                ref={(element) => {
                  if (element) tabRefs.current[t.key] = element;
                  else delete tabRefs.current[t.key];
                }}
                aria-selected={activeTab === t.key}
                aria-controls={`settings-panel-${t.key}`}
                tabIndex={activeTab === t.key ? 0 : -1}
                onClick={() => setActiveTab(t.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={cx(
                  "shrink-0 cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
                  activeTab === t.key
                    ? "border-primary text-text"
                    : "border-transparent text-faint hover:text-muted",
                )}
              >
                {t.label}
                {Boolean(t.badge) && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/20 px-1 text-[10px] font-semibold text-warning">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-md bg-gradient-to-l from-bg to-transparent sm:hidden"
            />
          </div>
        </div>
      </header>

      <main
        id={`settings-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
        tabIndex={0}
        className="mx-auto max-w-6xl space-y-8 px-4 py-8 pb-[max(6rem,env(safe-area-inset-bottom))]"
      >
        {error && (
          <p
            className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-diff-del-text"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </p>
        )}

        {activeTab === "engine" && (
          <EngineSettingsTab
            health={health}
            hostOk={hostOk}
            refresh={refresh}
            setError={setError}
            updateAvailability={updateAvailability}
          />
        )}

        {activeTab === "general" && (
          <>
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
              <h2 className="mb-3 text-sm font-semibold text-muted">実行</h2>
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

            <ThemeSettings />
            <HostLogPanel />
          </>
        )}




        {(activeTab === "skills" ||
          activeTab === "mcp" ||
          activeTab === "plugins") && <ExtensionsSettings activeSection={activeTab} />}

        {activeTab === "addons" && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">アドオン</h2>
            <p className="mb-3 text-xs text-faint">
              サイドバーに表示するウィジェットの有効/無効を切り替えます。
              OpenCode 本体のプラグインとは別物です。
            </p>
            <AddonSettings />
          </section>
        )}

        {activeTab === "project" && (
          <ProjectSettingsTab
            projects={projects}
            archivedProjects={archivedProjects}
            roots={roots}
            orphans={orphans}
            stray={stray}
            busy={busy}
            setBusy={setBusy}
            refresh={refresh}
            guard={guard}
            setError={setError}
          />
        )}

        {activeTab === "git" && <GitSettingsTab />}

        {activeTab === "connectivity" && <ConnectivitySettingsTab />}

        {activeTab === "agents" && <AgentsSettings />}

        {activeTab === "profiles" && (
          <>
            <ProfilesSettings />
            <ProfileSyncSettings />
            <ProfileAgentsSyncSettings />
          </>
        )}

        {activeTab === "providers" && <ProviderModelsSettings />}

        {activeTab === "ranking" && <ModelRankingSettings />}

        {activeTab === "users" && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">ユーザー管理</h2>
            <p className="mb-3 text-xs text-faint">
              ログインが必要なのは LAN / リモートからのアクセスだけです。127.0.0.1 （このPC）
              からはログインなしで利用できます。
            </p>

            <div className="mb-4 rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-text">Windows アカウントでログイン</h3>
              <p className="mb-3 text-xs text-faint">
                このPCの Windows ユーザー名とパスワードでログインできるようにします。
                {authConfig?.windowsAuthSupported === false &&
                  " このホストは Windows ではないため利用できません。"}
              </p>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Windows アカウントでのログインを許可"
                  checked={authConfig?.windowsAuth === true}
                  disabled={authBusy || authConfig === null || !authConfig.windowsAuthSupported}
                  onChange={(e) => void toggleWindowsAuth(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-xs text-muted">
                  許可する
                  <span className="mt-1 block text-faint">
                    有効にすると、LAN の端末から Windows のパスワードがこのPCへ送信されます。
                    また、ログイン失敗は Windows のアカウントロックアウトにも数えられます
                    （5 回失敗すると 5 分間ロックして保護します）。
                  </span>
                </span>
              </label>
            </div>

            <p className="mb-3 text-xs text-faint">
              WebUI 専用のユーザーを追加・変更・削除します。パスワードは 4 文字以上です。
            </p>

            <div className="mb-4 rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-text">ユーザーを追加 / パスワード変更</h3>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="ユーザー名"
                  aria-label="新規ユーザー名"
                  autoComplete="username"
                  className="h-10 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="パスワード（4 文字以上）"
                  aria-label="新規パスワード"
                  autoComplete="new-password"
                  className="h-10 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
                />
                <Button
                  busy={authBusy}
                  disabled={authBusy || !newUsername.trim() || newPassword.length < 4}
                  onClick={() => void addUser()}
                >
                  保存
                </Button>
              </div>
              {authError && (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {authError}
                </p>
              )}
              {authSuccess && (
                <p className="mt-2 text-xs text-success" role="status">
                  {authSuccess}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-text">登録済みユーザー</h3>
              {authBusy && authUsers.length === 0 ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : (
                <ul className="space-y-2">
                  {authUsers.map((u) => (
                    <li
                      key={u.username}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted" />
                        <span className="text-sm font-medium">{u.username}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            u.role === "admin"
                              ? "bg-primary/10 text-primary"
                              : "bg-surface text-faint"
                          }`}
                        >
                          {u.role === "admin" ? "管理者" : "一般"}
                        </span>
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        busy={authBusy}
                        disabled={authBusy}
                        onClick={() => void removeUser(u.username)}
                      >
                        削除
                      </Button>
                    </li>
                  ))}
                  {authUsers.length === 0 && (
                    <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-faint">
                      ユーザーが登録されていません
                    </li>
                  )}
                </ul>
              )}
            </div>
          </section>
        )}

        {activeTab === "memory" && <MemorySettings />}
        {activeTab === "vision" && <VisionSettings />}
      </main>
      </div>
    </div>
  );
}
