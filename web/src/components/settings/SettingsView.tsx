"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  User,
} from "lucide-react";
import { AgentsSettings } from "@/components/settings/AgentsSettings";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";
import { ProfilesSettings } from "@/components/settings/ProfilesSettings";
import { ProfileSyncSettings } from "@/components/settings/ProfileSyncSettings";
import { ProfileAgentsSyncSettings } from "@/components/settings/ProfileAgentsSyncSettings";
import { ProviderModelsSettings } from "@/components/settings/ProviderModelsSettings";
import { ConnectivitySettingsTab } from "./ConnectivitySettingsTab";
import { EngineSettingsTab } from "./EngineSettingsTab";
import { GitSettingsTab } from "./GitSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import { ModelRankingSettings } from "@/components/settings/ModelRankingSettings";
import { MemorySettings } from "@/components/settings/MemorySettings";
import { VisionSettings } from "@/components/settings/VisionSettings";
import { AddonSettings } from "@/components/addons/AddonSettings";
import { Button, cx, Spinner } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, timedFetch } from "@/lib/client";
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





export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("engine");
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [hostOk, setHostOk] = useState<boolean | null>(null);
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
  const [workflowModeEnabled, setWorkflowModeEnabled] = useState(false);
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
    };
  }, []);


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
          <GeneralSettingsTab
            hostOk={hostOk}
            workflowModeEnabled={workflowModeEnabled}
            setWorkflowModeEnabled={setWorkflowModeEnabled}
            setError={setError}
          />
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
