"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Check,
  Copy,
  Download,
  Monitor,
  Moon,
  Plus,
  Star,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";
import { AddProjectButton } from "@/components/AddProjectButton";
import { AgentsSettings } from "@/components/settings/AgentsSettings";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";
import { ProfilesSettings } from "@/components/settings/ProfilesSettings";
import { ProfileSyncSettings } from "@/components/settings/ProfileSyncSettings";
import { ProfileAgentsSyncSettings } from "@/components/settings/ProfileAgentsSyncSettings";
import { ProviderModelsSettings } from "@/components/settings/ProviderModelsSettings";
import { ModelRankingSettings } from "@/components/settings/ModelRankingSettings";
import { MemorySettings } from "@/components/settings/MemorySettings";
import { AddonSettings } from "@/components/addons/AddonSettings";
import { HostLogPanel } from "@/components/settings/HostLogPanel";
import { Badge, Button, cx, Spinner, timeAgo } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import { copyText } from "@/lib/clipboard";
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
import type { HealthDto, ProjectDto } from "@/lib/types";
import {
  clampHangTimeoutMs,
  DEFAULT_HANG_TIMEOUT_MS,
  MAX_HANG_TIMEOUT_MS,
  MIN_HANG_TIMEOUT_MS,
  readHangTimeoutFromServer,
  readHangTimeoutMs,
  syncHangTimeoutToServer,
  writeHangTimeoutMs,
} from "@/lib/hang-timeout";
import {
  COMMIT_AUTHOR_EMAIL_KEY,
  COMMIT_AUTHOR_NAME_KEY,
  COMMIT_AUTHOR_EMAIL_MAX_CHARS,
  COMMIT_AUTHOR_NAME_MAX_CHARS,
  isValidCommitAuthorEmail,
  isValidCommitAuthorName,
} from "@/lib/commit-identity-keys";

type OrphanDto = {
  id: string;
  displayName: string;
  absolutePath: string;
};

type StrayDto = { projectId: string; projectName: string; path: string };

type AccessInfo = {
  bind: string;
  port: number;
  localUrl: string;
  hint: string;
  addresses: {
    name: string;
    address: string;
    url: string;
    kind: "caddy" | "vpn" | "lan" | "other" | "local";
  }[];
  certificateUrls?: {
    name: string;
    address: string;
    url: string;
    kind: "vpn" | "lan" | "other";
  }[];
};

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
  | "memory";

type UpdateTarget = "webui" | "opencode" | "nextjs";

type UpdateState =
  | { target: UpdateTarget; kind: "running"; detail?: string }
  | { target: UpdateTarget; kind: "success"; message: string; detail?: string }
  | { target: UpdateTarget; kind: "error"; message: string; detail?: string }
  | null;

type UpdateAvailability = {
  available: boolean;
  current?: string;
  latest?: string;
  currentDate?: string;
  latestDate?: string;
  error?: string;
};

const RESTART_LABELS = {
  webui: "WebUI（フロントエンド）",
  opencode: "OpenCode（バックエンド）",
  all: "すべて",
} as const;
const RESTART_HEALTH_MAX_ATTEMPTS = 180;
const RESTART_HEALTH_INTERVAL_MS = 1000;
const RESTART_HEALTH_TIMEOUT_MS = 2500;

function restartHealthReady(
  target: "webui" | "opencode" | "all",
  health: HealthDto,
) {
  if (target === "webui") return health.webui?.ok === true;
  if (target === "opencode") return health.opencode?.ok === true;
  return health.webui?.ok === true && health.opencode?.ok === true;
}

function restartHealthTimeoutMessage(
  target: "webui" | "opencode" | "all",
  lastHealth: HealthDto | null,
) {
  if (target === "all" && lastHealth?.webui?.ok === true) {
    return "WebUI は復帰しましたが、OpenCode の起動確認が完了しませんでした。設定の接続状態またはトレイログを確認してください。";
  }
  if (target === "webui") {
    return "WebUI の再起動要求は受理されましたが、3分以内にヘルスチェックへ復帰しませんでした。ページを再読み込みし、続く場合はトレイログを確認してください。";
  }
  if (target === "opencode") {
    return "OpenCode の再起動要求は受理されましたが、3分以内に起動確認が完了しませんでした。トレイログを確認してください。";
  }
  return "再起動要求は受理されましたが、3分以内にヘルスチェックへ復帰しませんでした。ページを再読み込みし、続く場合はトレイログを確認してください。";
}

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
  const [restarting, setRestarting] = useState<"webui" | "opencode" | "all" | null>(
    null,
  );
  const [updating, setUpdating] = useState<UpdateTarget | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>(null);
  const [updateAvailability, setUpdateAvailability] = useState<{
    webui: UpdateAvailability;
    opencode: UpdateAvailability;
    nextjs: UpdateAvailability;
  } | null>(null);
  const [pendingRestart, setPendingRestart] = useState<"webui" | "opencode" | "all" | null>(
    null,
  );
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [orphans, setOrphans] = useState<OrphanDto[]>([]);
  const [stray, setStray] = useState<StrayDto[]>([]);
  const [newRoot, setNewRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingRoot, setDeletingRoot] = useState<string | null>(null);
  const [pendingRootDelete, setPendingRootDelete] = useState<string | null>(null);
  const [pendingProjectDelete, setPendingProjectDelete] =
    useState<ProjectDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [allowFirewallState, setAllowFirewallState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [costPrefs, setCostPrefs] = useState<CostDisplayPrefs>(() =>
    readCostDisplayPrefs(),
  );
  const [rateDraft, setRateDraft] = useState(() =>
    String(readCostDisplayPrefs().usdJpyRate),
  );
  const [hangTimeoutMinutes, setHangTimeoutMinutes] = useState(() =>
    String(readHangTimeoutMs() / 60_000),
  );
  const [commitAuthorName, setCommitAuthorName] = useState("");
  const [commitAuthorEmail, setCommitAuthorEmail] = useState("");
  const [commitIdentityError, setCommitIdentityError] = useState<string | null>(null);
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
  const restartingRef = useRef(false);
  const updatingRef = useRef<UpdateTarget | null>(null);
  const busyRef = useRef(false);
  const deletingRootRef = useRef<string | null>(null);
  const rootConfirmRef = useRef<HTMLDivElement | null>(null);
  const rootTriggerRef = useRef<HTMLElement | null>(null);
  const projectConfirmRef = useRef<HTMLDivElement | null>(null);
  const projectTriggerRef = useRef<HTMLElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      autoRateRequestGeneration.current += 1;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pendingRootDelete) {
      if (rootTriggerRef.current?.isConnected) rootTriggerRef.current.focus();
      rootTriggerRef.current = null;
      return;
    }

    rootConfirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPendingRootDelete(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingRootDelete]);

  useEffect(() => {
    if (!pendingProjectDelete) {
      if (projectTriggerRef.current?.isConnected) projectTriggerRef.current.focus();
      projectTriggerRef.current = null;
      return;
    }

    projectConfirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPendingProjectDelete(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingProjectDelete]);
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
    const [h, p, r, o, a, host, updates] = await Promise.allSettled([
      getJson<HealthDto>("/api/health"),
      getJson<{ projects: ProjectDto[] }>("/api/projects"),
      getJson<{ roots: string[] }>("/api/roots"),
      getJson<{ orphans: OrphanDto[]; stray: StrayDto[] }>(
        "/api/workspaces/orphans",
        { scan: "1" },
      ),
      getJson<AccessInfo>("/api/access"),
      timedFetch("/api/host", { timeoutMs: 1500 }).then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        return { ok: res.ok && Boolean(body.ok) };
      }),
      getJson<{
        webui: UpdateAvailability;
        opencode: UpdateAvailability;
        nextjs: UpdateAvailability;
      }>("/api/updates/status"),
    ]);
    if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
    if (h.status === "fulfilled") setHealth(h.value);
    if (p.status === "fulfilled") setProjects(p.value.projects ?? []);
    if (r.status === "fulfilled") setRoots(r.value.roots ?? []);
    if (o.status === "fulfilled") {
      setOrphans(o.value.orphans ?? []);
      setStray(o.value.stray ?? []);
    }
    if (a.status === "fulfilled") setAccess(a.value);
    if (host.status === "fulfilled") setHostOk(host.value.ok);
    else setHostOk(false);
    if (updates.status === "fulfilled") setUpdateAvailability(updates.value);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const requestRestart = (target: "webui" | "opencode" | "all") => {
    setError(null);
    setPendingRestart(target);
  };

  // The server-side hang watchdog reads the `hang-timeout` setting from the
  // database, but the value used to live only in localStorage. Seed the server
  // once so an existing user's configured threshold is honoured without them
  // having to re-save it. See docs/specs/hang-watchdog-server-side.md.
  useEffect(() => {
    const local = readHangTimeoutMs();
    // Only a customised local value needs migrating: the client and the
    // watchdog already agree on the default, so never write in that case.
    if (local === DEFAULT_HANG_TIMEOUT_MS) return;
    let cancelled = false;
    void (async () => {
      const stored = await readHangTimeoutFromServer();
      if (cancelled || stored !== null) return;
      await syncHangTimeoutToServer(local);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commitHangTimeout = () => {
    const minutes = Number(hangTimeoutMinutes);
    const milliseconds = clampHangTimeoutMs(
      (Number.isFinite(minutes) ? minutes : DEFAULT_HANG_TIMEOUT_MS / 60_000) * 60_000,
    );
    writeHangTimeoutMs(milliseconds);
    setHangTimeoutMinutes(String(milliseconds / 60_000));
    void syncHangTimeoutToServer(milliseconds);
  };

  // Commit author override: stored server-side because the commit API and the
  // worktree Git identity both resolve it on the host, not in the browser.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [name, email] = await Promise.allSettled([
        getJson<{ value: string | null }>(`/api/settings/${COMMIT_AUTHOR_NAME_KEY}`),
        getJson<{ value: string | null }>(`/api/settings/${COMMIT_AUTHOR_EMAIL_KEY}`),
      ]);
      if (cancelled) return;
      if (name.status === "fulfilled") setCommitAuthorName(name.value.value ?? "");
      if (email.status === "fulfilled") setCommitAuthorEmail(email.value.value ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commitIdentityField = async (
    key: string,
    raw: string,
    isValid: (value: string) => boolean,
    invalidMessage: string,
  ) => {
    const value = raw.trim();
    if (value.length > 0 && !isValid(value)) {
      setCommitIdentityError(invalidMessage);
      return;
    }
    setCommitIdentityError(null);
    try {
      await sendJson("PUT", `/api/settings/${key}`, { value });
    } catch (err) {
      if (mountedRef.current) {
        setCommitIdentityError(
          err instanceof Error ? err.message : "コミット作者の保存に失敗しました",
        );
      }
    }
  };

  const restartService = async (target: "webui" | "opencode" | "all") => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    setPendingRestart(null);
    setRestarting(target);
    setError(null);
    try {
      const res = await timedFetch("/api/host/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
        timeoutMs: 10_000,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      if (!res.ok && res.status !== 202) {
        throw new Error(
          [data.error, data.hint].filter(Boolean).join(" — ") ||
            "再起動に失敗しました",
        );
      }
      let success = false;
      let lastHealth: HealthDto | null = null;
      for (let i = 0; i < RESTART_HEALTH_MAX_ATTEMPTS; i += 1) {
        await new Promise((r) => setTimeout(r, RESTART_HEALTH_INTERVAL_MS));
        if (!mountedRef.current) return;
        try {
          const h = await timedFetch(`/api/health?restart=${Date.now()}`, {
            timeoutMs: RESTART_HEALTH_TIMEOUT_MS,
          });
          if (!h.ok) continue;
          const body = (await h.json().catch(() => ({}))) as HealthDto;
          lastHealth = body;
          if (restartHealthReady(target, body)) {
            success = true;
            break;
          }
        } catch {
          // The target may still be shutting down or starting up.
        }
      }
      if (!success) {
        throw new Error(restartHealthTimeoutMessage(target, lastHealth));
      }
      await refresh();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "再起動に失敗しました");
      }
    } finally {
      restartingRef.current = false;
      if (mountedRef.current) setRestarting(null);
    }
  };

  const updateService = async (target: UpdateTarget) => {
    if (updatingRef.current !== null) return;
    updatingRef.current = target;
    setUpdating(target);
    setUpdateState({ target, kind: "running" });
    setError(null);
    try {
      const timeoutMs =
        target === "nextjs" ? 200_000 : target === "webui" ? 400_000 : 130_000;
      const res = await timedFetch(`/api/updates/${target}`, {
        method: "POST",
        timeoutMs,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        mode?: "git" | "release";
        stdout?: string;
        stderr?: string;
        result?: { version?: unknown };
        version?: unknown;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "アップデートに失敗しました");
      }
      const detail = [data.stdout, data.stderr].filter(Boolean).join("\n").trim();
      if (!mountedRef.current) return;
      const message =
        target === "webui"
          ? data.mode === "release"
            ? "WebUI の最新版リリースを取得しました。必要に応じてビルド/再起動してください。"
            : "WebUI のリモート更新を取得しました。必要に応じてビルド/再起動してください。"
          : target === "opencode"
            ? `OpenCode CLI を更新しました${typeof data.result?.version === "string" ? `（${data.result.version}）` : ""}。反映には OpenCode の再起動が必要です。`
            : `Next.js を更新しました${typeof data.version === "string" ? `（${data.version}）` : ""}。反映には WebUI の再起動が必要です。`;
      setUpdateState({ target, kind: "success", message, detail: detail || undefined });
      await refresh();
    } catch (err) {
      if (mountedRef.current) setUpdateState({
        target,
        kind: "error",
        message: err instanceof Error ? err.message : "アップデートに失敗しました",
      });
    } finally {
      updatingRef.current = null;
      if (mountedRef.current) setUpdating(null);
    }
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

  const toggleFavorite = (p: ProjectDto) =>
    guard(async () => {
      await sendJson("PATCH", "/api/projects", {
        id: p.id,
        favorite: !p.favorite,
      });
    });

  const removeProject = (p: ProjectDto, confirmed = false) => {
    if (!confirmed) {
      projectTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPendingProjectDelete(p);
      return;
    }
    void guard(async () => {
      await sendJson("DELETE", "/api/projects", undefined, { id: p.id });
    });
  };

  const addRoot = () =>
    guard(async () => {
      if (!newRoot.trim()) return;
      await sendJson("POST", "/api/roots", { path: newRoot.trim() });
      setNewRoot("");
    });

  const removeRoot = async (r: string, confirmed = false) => {
    if (busyRef.current || deletingRootRef.current !== null) return;
    if (!confirmed) {
      rootTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPendingRootDelete(r);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    deletingRootRef.current = r;
    setDeletingRoot(r);
    setError(null);
    try {
      try {
        await sendJson("DELETE", "/api/roots", undefined, { path: r });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status?: unknown }).status
            : undefined;
        if (status === 404) {
          await refresh();
          throw new Error(`許可ルート「${r}」は既に削除済みです。`);
        }
        throw err;
      }
      await refresh();
      notifyTasksChanged();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "操作に失敗しました");
      }
    } finally {
      deletingRootRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) {
        setDeletingRoot(null);
        setBusy(false);
      }
    }
  };

  const cleanupOrphans = () =>
    guard(async () => {
      const data = await sendJson<{
        results?: { ok: boolean; error?: string }[];
        strayErrors?: string[];
      }>("POST", "/api/workspaces/orphans", { action: "cleanup" });
      const failed = data.results?.filter((r) => !r.ok) ?? [];
      const strayErrors = data.strayErrors ?? [];
      if (failed.length > 0 || strayErrors.length > 0) {
        throw new Error(
          [...failed.map((f) => f.error), ...strayErrors].join("; "),
        );
      }
      // R14#2: Refresh orphan list after successful cleanup to remove deleted items from UI
      await refresh();
    });

  const copyUrl = async (url: string) => {
    const ok = await copyText(url);
    if (!ok) return;
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopied(url);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      if (mountedRef.current) setCopied(null);
    }, 1500);
  };

  // Elevated (UAC) netsh call waits on the user's confirmation dialog, so the
  // timeout must be generous — much longer than the other host-control calls.
  const doAllowFirewall = async () => {
    setAllowFirewallState({ kind: "busy" });
    try {
      const data = await sendJson<{ alreadyExists?: boolean; port?: number }>(
        "POST",
        "/api/host/allow-firewall",
        {},
        undefined,
        { timeoutMs: 70_000 },
      );
      if (!mountedRef.current) return;
      const port = data.port ?? access?.port ?? 3000;
      setAllowFirewallState({
        kind: "success",
        message: data.alreadyExists
          ? `既に許可済みです（TCP ${port} 番）`
          : `ファイアウォールでポート ${port} 番を許可しました`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setAllowFirewallState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "ポート許可に失敗しました",
      });
    }
  };

  const kindLabel = (kind: string) =>
    kind === "caddy"
      ? "Caddy"
      : kind === "vpn"
        ? "VPN"
        : kind === "lan"
          ? "LAN"
          : kind === "local"
            ? "Local"
            : "その他";

  // Wi-Fi / Ethernet(LAN) の直接 IP リンクは表示せず、代わりに 127.0.0.1
  // (このPC自身からの動作確認用) を先頭に出す。VPN / Caddy はそのまま表示。
  const displayAddresses = (() => {
    const filtered = (access?.addresses ?? []).filter((a) => a.kind !== "lan");
    if (access?.localUrl) {
      filtered.unshift({
        name: "Localhost",
        address: "127.0.0.1",
        url: access.localUrl,
        kind: "local",
      });
    }
    return filtered;
  })();

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
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-text">接続状態</h3>
                    <p className="mt-1 text-xs text-faint">
                      OpenCode {health?.opencode.version ?? ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={health?.webui?.ok ? "success" : "danger"}>
                      {health?.webui?.ok ? "WebUI 接続中" : "WebUI 停止"}
                    </Badge>
                    <Badge tone={health?.opencode?.ok ? "success" : "danger"}>
                      {health?.opencode?.ok ? "OpenCode 接続中" : "OpenCode 停止"}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 p-4 md:grid-cols-2">
                  <div className="space-y-3 rounded-lg border border-border bg-bg/40 p-3">
                    <div>
                      <h3 className="text-xs font-semibold text-muted">再起動</h3>
                      <p className="mt-1 text-xs text-faint">
                        {hostOk
                          ? "トレイメニューの再起動操作と同じです。"
                          : "start-webui.bat（トレイホスト）経由の起動が必要です。"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        busy={restarting === "webui"}
                        disabled={hostOk !== true || restarting !== null}
                        onClick={() => requestRestart("webui")}
                      >
                        WebUI を再起動
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        busy={restarting === "opencode"}
                        disabled={hostOk !== true || restarting !== null}
                        onClick={() => requestRestart("opencode")}
                      >
                        OpenCode を再起動
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        busy={restarting === "all"}
                        disabled={hostOk !== true || restarting !== null}
                        onClick={() => requestRestart("all")}
                      >
                        すべて再起動
                      </Button>
                    </div>
                    {pendingRestart && !restarting && (
                      <div
                        role="dialog"
                        aria-live="polite"
                        aria-label="再起動の確認"
                        className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning"
                      >
                        <p className="font-medium">
                          {RESTART_LABELS[pendingRestart]}を再起動しますか？
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            onClick={() => void restartService(pendingRestart)}
                          >
                            再起動する
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setPendingRestart(null)}
                          >
                            キャンセル
                          </Button>
                        </div>
                      </div>
                    )}
                    <p className="min-h-4 text-xs text-muted" role="status" aria-live="polite">
                      {restarting
                        ? `${RESTART_LABELS[restarting]}を再起動しています…`
                        : null}
                    </p>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border bg-bg/40 p-3">
                    <div>
                      <h3 className="text-xs font-semibold text-muted">アップデート</h3>
                      <p className="mt-1 text-xs text-faint">
                        WebUI は <code>git pull --ff-only</code>、OpenCode CLI は upgrade API、Next.js は{" "}
                        <code>npm install next@latest</code> を実行します（いずれも手動操作。起動時には自動実行されません）。
                      </p>
                    </div>
                    {updateAvailability &&
                      (updateAvailability.webui.available ||
                        updateAvailability.opencode.available ||
                        updateAvailability.nextjs.available) && (
                      <div
                        className="rounded-md border border-warning/30 bg-warning-bg px-2 py-1.5 text-[11px] leading-snug text-warning"
                        role="status"
                        aria-live="polite"
                      >
                        <p className="font-medium">利用可能なアップデート</p>
                        <ul className="mt-0.5 list-disc pl-4">
                          {updateAvailability.webui.available && (
                            <li>
                              WebUI: コミット {updateAvailability.webui.current ?? "不明"}（{updateAvailability.webui.currentDate ?? "日時不明"}） → {updateAvailability.webui.latest ?? "不明"}（{updateAvailability.webui.latestDate ?? "日時不明"}）
                            </li>
                          )}
                          {updateAvailability.opencode.available && (
                            <li>
                              OpenCode CLI: バージョン {updateAvailability.opencode.current ?? "不明"} → {updateAvailability.opencode.latest ?? "不明"}
                            </li>
                          )}
                          {updateAvailability.nextjs.available && (
                            <li>
                              Next.js: バージョン {updateAvailability.nextjs.current ?? "不明"} → {updateAvailability.nextjs.latest ?? "不明"}
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        busy={updating === "webui"}
                        disabled={updating !== null || restarting !== null}
                        onClick={() => void updateService("webui")}
                      >
                        WebUI を更新
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        busy={updating === "opencode"}
                        disabled={updating !== null || restarting !== null || health?.opencode?.ok !== true}
                        onClick={() => void updateService("opencode")}
                      >
                        OpenCode CLI を更新
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        busy={updating === "nextjs"}
                        disabled={updating !== null || restarting !== null}
                        onClick={() => void updateService("nextjs")}
                      >
                        Next.js を更新
                      </Button>
                    </div>
                    {updateState && (
                      <div
                        className={cx(
                          "rounded-md border px-2 py-1.5 text-[11px] leading-snug",
                          updateState.kind === "error"
                            ? "border-danger/30 bg-danger-bg text-diff-del-text"
                            : updateState.kind === "success"
                              ? "border-success/30 bg-success-bg text-success"
                              : "border-working/30 bg-working-bg text-working",
                        )}
                        role="status"
                        aria-live="polite"
                      >
                        <p className="font-medium">
                          {updateState.kind === "running"
                            ? `${
                                updateState.target === "webui"
                                  ? "WebUI"
                                  : updateState.target === "opencode"
                                    ? "OpenCode CLI"
                                    : "Next.js"
                              } をアップデートしています…`
                            : updateState.message}
                        </p>
                        {updateState.detail && (
                          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-bg/60 px-1.5 py-1 font-mono text-[10px] leading-snug text-muted">
                            {updateState.detail}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
          </section>
        )}

        {activeTab === "general" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">実行</h2>
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

        {activeTab === "git" && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">コミット作者</h2>
            <div className="rounded-xl border border-border bg-surface px-4 py-3">
              <p className="text-[11px] text-faint">
                未設定の場合は実行エージェント名（例:
                <code className="mx-1 font-mono">build &lt;build@opencode.local&gt;</code>）
                で記録されます。GitHub などに push するリポジトリでは、ここに実ユーザーの名前とメールアドレスを設定してください。
              </p>
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="w-28 shrink-0 text-sm text-muted">名前</span>
                  <input
                    type="text"
                    value={commitAuthorName}
                    maxLength={COMMIT_AUTHOR_NAME_MAX_CHARS}
                    placeholder="エージェント名を使用"
                    aria-label="コミット作者名"
                    onChange={(event) => setCommitAuthorName(event.target.value)}
                    onBlur={() =>
                      void commitIdentityField(
                        COMMIT_AUTHOR_NAME_KEY,
                        commitAuthorName,
                        isValidCommitAuthorName,
                        "コミット作者名に使用できない文字が含まれています",
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="h-9 w-full max-w-[22rem] rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
                  />
                </label>
                <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="w-28 shrink-0 text-sm text-muted">メールアドレス</span>
                  <input
                    type="email"
                    value={commitAuthorEmail}
                    maxLength={COMMIT_AUTHOR_EMAIL_MAX_CHARS}
                    placeholder="エージェント名@opencode.local を使用"
                    aria-label="コミット作者メールアドレス"
                    onChange={(event) => setCommitAuthorEmail(event.target.value)}
                    onBlur={() =>
                      void commitIdentityField(
                        COMMIT_AUTHOR_EMAIL_KEY,
                        commitAuthorEmail,
                        isValidCommitAuthorEmail,
                        "コミット作者メールアドレスの形式が不正です",
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="h-9 w-full max-w-[22rem] rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
                  />
                </label>
              </div>
              {commitIdentityError && (
                <p className="mt-2 text-[11px] text-danger" role="alert">
                  {commitIdentityError}
                </p>
              )}
              <p className="mt-2 text-[11px] text-faint">
                設定後に作成したワークスペース、および以降のコミットに適用されます。
              </p>
            </div>
          </section>
        )}

        {activeTab === "project" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">プロジェクト</h2>
              <div className="mb-3">
                <AddProjectButton onAdded={() => void refresh()} />
              </div>
              {pendingProjectDelete && (
                <div
                  ref={projectConfirmRef}
                  role="alertdialog"
                  aria-label="プロジェクト削除の確認"
                  aria-describedby="project-delete-confirm-description"
                  className="mb-3 rounded-xl border border-danger/30 bg-danger-bg px-3 py-3 text-sm text-danger"
                >
                  <p id="project-delete-confirm-description">
                    プロジェクト「{pendingProjectDelete.name}」を削除しますか？
                    <br />
                    関連タスクとworktreeも削除されます。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      busy={busy}
                      onClick={() => {
                        const project = pendingProjectDelete;
                        projectTriggerRef.current = null;
                        setPendingProjectDelete(null);
                        removeProject(project, true);
                      }}
                    >
                      削除する
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingProjectDelete(null)}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              )}
              <ul className="space-y-2">
                {projects.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate font-mono text-xs text-faint">
                        {p.rootPath}
                      </p>
                    </div>
                    {p.lastOpenedAt && (
                      <span className="hidden text-xs text-faint sm:inline">
                        {timeAgo(p.lastOpenedAt)}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${p.name}を${p.favorite ? "お気に入りから外す" : "お気に入りに追加"}`}
                      title="お気に入り"
                      onClick={() => void toggleFavorite(p)}
                      className="cursor-pointer rounded-lg p-2 text-faint hover:bg-surface-2"
                    >
                      <Star
                        className={
                          p.favorite
                            ? "h-4 w-4 fill-warning text-warning"
                            : "h-4 w-4"
                        }
                      />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${p.name}を削除`}
                      title="プロジェクトを削除"
                      onClick={() => void removeProject(p)}
                      className="cursor-pointer rounded-lg p-2 text-faint hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                {projects.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint">
                    プロジェクトがありません
                  </li>
                )}
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">
                許可ルート（allowlist）
              </h2>
              <div className="mb-3 flex gap-2">
                <input
                  value={newRoot}
                  onChange={(e) => setNewRoot(e.target.value)}
                  aria-label="追加する許可ルート"
                  placeholder="C:\path\to\allow"
                  className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addRoot();
                  }}
                />
                <Button busy={busy} onClick={() => void addRoot()}>
                  <Plus className="h-4 w-4" />
                  許可
                </Button>
              </div>
              {pendingRootDelete && (
                <div
                  ref={rootConfirmRef}
                  role="alertdialog"
                  aria-label="許可ルート削除の確認"
                  aria-describedby="root-delete-confirm-description"
                  className="mb-3 rounded-xl border border-danger/30 bg-danger-bg px-3 py-3 text-sm text-danger"
                >
                  <p id="root-delete-confirm-description">
                    許可ルート「{pendingRootDelete}」を削除しますか？
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      busy={deletingRoot === pendingRootDelete}
                      onClick={() => {
                        const root = pendingRootDelete;
                        rootTriggerRef.current = null;
                        setPendingRootDelete(null);
                        void removeRoot(root, true);
                      }}
                    >
                      削除する
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingRootDelete(null)}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              )}
              <ul className="space-y-1">
                {roots.map((r) => (
                  <li
                    key={r}
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-muted"
                  >
                    <span className="truncate text-text">{r}</span>
                    <button
                      type="button"
                      disabled={busy || deletingRoot !== null}
                      aria-label={`${r}を削除`}
                      aria-busy={deletingRoot === r}
                      onClick={() => void removeRoot(r)}
                      className="min-h-6 min-w-6 shrink-0 rounded-lg p-1 text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
                    >
                      {deletingRoot === r ? "削除中…" : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {(orphans.length > 0 || stray.length > 0) && (
              <section>
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-warning">
                      要復旧の Workspace
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      worktree 削除に失敗した残骸です。フォルダが既に無いものは設定を開いたときに自動削除されます。
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    busy={busy}
                    disabled={orphans.length === 0 && stray.length === 0}
                    onClick={() => void cleanupOrphans()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    orphan を掃除
                  </Button>
                </div>
                <ul className="space-y-1 text-sm">
                  {orphans.map((o) => (
                    <li
                      key={o.id}
                      className="truncate rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning"
                    >
                      {o.displayName} · {o.absolutePath}
                    </li>
                  ))}
                  {stray.map((s) => (
                    <li
                      key={s.path}
                      className="truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"
                    >
                      stray ({s.projectName}): {s.path}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {activeTab === "connectivity" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">
                スマホ / VPN アクセス
              </h2>
              <p className="mb-3 text-xs text-faint">
                {access?.hint ??
                  "VPN 接続後、PC の VPN アドレス:3000 をスマホブラウザで開きます。"}
              </p>
              <ul className="space-y-2">
                {displayAddresses.map((a) => (
                  <li
                    key={`${a.name}-${a.address}`}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-nowrap"
                  >
                    <Badge
                      tone={
                        a.kind === "caddy"
                          ? "warning"
                          : a.kind === "vpn"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {kindLabel(a.kind)}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-mono text-sm text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                      >
                        {a.url}
                      </a>
                      <p className="truncate text-[11px] text-faint">{a.name}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="URL をコピー"
                      aria-label={copied === a.url ? "URLをコピー済み" : "URLをコピー"}
                      onClick={() => void copyUrl(a.url)}
                    >
                      {copied === a.url ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                ))}
                {access && displayAddresses.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint">
                    利用可能なネットワークアドレスがありません
                  </li>
                )}
              </ul>
              {(access?.certificateUrls?.length ?? 0) > 0 && (
                <div className="mt-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-muted">
                        信頼証明書
                      </p>
                      <p className="mt-0.5 text-[11px] text-faint">
                        Caddy の HTTPS 証明書警告を消すため、端末にルート CA
                        をインストールしてください。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {access?.certificateUrls?.map((cert) => (
                        <a
                          key={`${cert.name}-${cert.address}`}
                          href={cert.url}
                          download="caddy-root.crt"
                          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          {kindLabel(cert.kind)} 証明書DL
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  busy={allowFirewallState.kind === "busy"}
                  disabled={allowFirewallState.kind === "busy"}
                  onClick={() => void doAllowFirewall()}
                >
                  ポートを許可
                </Button>
                {allowFirewallState.kind === "success" && (
                  <span className="text-xs text-success">
                    {allowFirewallState.message}
                  </span>
                )}
                {allowFirewallState.kind === "error" && (
                  <span role="alert" className="text-xs text-danger">
                    {allowFirewallState.message}
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-faint">
                同一ネットワークでも開けない場合は Windows ファイアウォールが原因です。上のボタンでポートを許可できます（管理者権限の確認ダイアログが表示されます）。
                手動で行う場合は管理者で{" "}
                <code className="rounded bg-surface-2 px-1">
                  scripts\allow-firewall-3000.bat
                </code>{" "}
                を実行するか、PowerShell（管理者）で:
                <br />
                <code className="mt-1 block break-all rounded bg-surface-2 px-1 py-0.5">
                  netsh advfirewall firewall add rule name=&quot;OpenCode WebUI&quot;
                  dir=in action=allow protocol=TCP localport=
                  {access?.port ?? 3000}
                </code>
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">Remote Workspace</h2>
              <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                未実装（501）。VPN + ローカルパスで代替してください。
              </p>
            </section>
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
      </main>
      </div>
    </div>
  );
}
