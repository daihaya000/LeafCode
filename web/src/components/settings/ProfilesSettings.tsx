"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import { restartOpencodeAndWait } from "@/lib/opencode-restart";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

type ProfileDto = {
  id: string;
  name: string;
  path: string;
  external?: true;
  active: boolean;
  exists: boolean;
};

type MigrationInfo = {
  needed: boolean;
  sourcePath: string;
  estimatedBytes: number;
};

type ListResponse = {
  profiles: ProfileDto[];
  activeId: string | null;
  linkState: "link" | "realdir" | "missing";
  canSwitch: boolean;
  reason?: string;
  migration?: MigrationInfo;
};

type JobResponse = {
  state: "running" | "done" | "error";
  copied: number;
  total: number;
  note?: string;
  error?: string;
};

type LoadState = "loading" | "ready" | "error";
type ProfileSetupSettings = {
  browserBridge: boolean;
  cursorAcp: boolean;
  claudeAuth: boolean;
  commandcodeAuth: boolean;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function useHostStatus() {
  const [hostOk, setHostOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await timedFetch("/api/host", { timeoutMs: 1500 });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (!cancelled) setHostOk(res.ok && Boolean(body.ok));
      } catch {
        if (!cancelled) setHostOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return hostOk;
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export function ProfilesSettings() {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<ListResponse | null>(null);
  const [setupSettings, setSetupSettings] = useState<ProfileSetupSettings | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<ProfileDto | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createFrom, setCreateFrom] = useState<"empty" | string>("empty");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [unregisterConfirm, setUnregisterConfirm] = useState<ProfileDto | null>(null);
  const hostOk = useHostStatus();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);
  const loadRequestRef = useRef(0);
  const actionBusyRef = useRef<string | null>(null);
  const busyIdRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(
    switchConfirm !== null || unregisterConfirm !== null || restarting,
  );

  useEffect(() => {
    const isOpen = switchConfirm !== null || unregisterConfirm !== null;
    if (!isOpen) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const getFocusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    getFocusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (actionBusyRef.current === null && busyIdRef.current === null) {
          setSwitchConfirm(null);
          setUnregisterConfirm(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [switchConfirm, unregisterConfirm]);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    try {
      const [result, settings] = await Promise.all([
        getJson<ListResponse>("/api/profiles"),
        getJson<ProfileSetupSettings>("/api/profiles/settings"),
      ]);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setData(result);
      setSetupSettings(settings);
      setState("ready");
    } catch {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setState("error");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, [load]);

  // Poll job progress
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || !mountedRef.current) return;
      try {
        const j = await getJson<JobResponse>(`/api/profiles/jobs/${jobId}`);
        if (cancelled || !mountedRef.current) return;
        setJob(j);
        if (j.state !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setJobId(null);
          void load();
        }
      } catch {
        /* keep polling */
      }
    };
    pollRef.current = setInterval(poll, 800);
    void poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobId, load]);

  const doSwitch = useCallback(
    async (profile: ProfileDto) => {
      if (busyIdRef.current !== null || actionBusyRef.current !== null) return;
      setSwitchConfirm(null);
      busyIdRef.current = profile.id;
      setBusyId(profile.id);
      setRestartError(null);
      try {
        await sendJson("POST", `/api/profiles/${profile.id}/activate`, {});
        if (!mountedRef.current) return;
        // Unknown host status should not silently skip the required restart;
        // only a confirmed unavailable host falls back to manual restart.
        if (hostOk !== false) {
          setRestarting(true);
          await restartOpencodeAndWait();
          if (!mountedRef.current) return;
        }
        await load();
      } catch (err) {
        if (!mountedRef.current) return;
        setRestartError(
          err instanceof Error ? err.message : "切り替えに失敗しました",
        );
      } finally {
        if (busyIdRef.current === profile.id) {
          busyIdRef.current = null;
          if (mountedRef.current) {
            setBusyId(null);
            setRestarting(false);
          }
        }
      }
    },
    [hostOk, load],
  );

  const doMigrate = useCallback(async () => {
    if (actionBusyRef.current !== null || busyIdRef.current !== null) return;
    actionBusyRef.current = "migrate";
    setActionBusy("migrate");
    setActionError(null);
    try {
      const res = await sendJson<{ jobId: string }>("POST", "/api/profiles/migrate", {});
      if (!mountedRef.current) return;
      setJobId(res.jobId);
      setJob({ state: "running", copied: 0, total: 0 });
    } catch (err) {
      if (!mountedRef.current) return;
      setActionError(err instanceof Error ? err.message : "移行を開始できませんでした");
    } finally {
      if (actionBusyRef.current === "migrate") {
        actionBusyRef.current = null;
        if (mountedRef.current) setActionBusy(null);
      }
    }
  }, []);

  const doCreate = useCallback(async () => {
    if (!createName.trim() || actionBusyRef.current !== null || busyIdRef.current !== null) return;
    actionBusyRef.current = "create";
    setActionBusy("create");
    setActionError(null);
    try {
      const res = await sendJson<{ jobId?: string; id?: string }>(
        "POST",
        "/api/profiles",
        { name: createName, from: createFrom },
      );
      if (!mountedRef.current) return;
      setCreateOpen(false);
      setCreateName("");
      setCreateFrom("empty");
      if (res.jobId) {
        setJobId(res.jobId);
        setJob({ state: "running", copied: 0, total: 0 });
      } else {
        await load();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setActionError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      if (actionBusyRef.current === "create") {
        actionBusyRef.current = null;
        if (mountedRef.current) setActionBusy(null);
      }
    }
  }, [createFrom, createName, load]);

  const updateSetupSetting = useCallback(
    async (key: keyof ProfileSetupSettings, value: boolean) => {
      if (!setupSettings || actionBusyRef.current !== null || busyIdRef.current !== null) return;
      const operation = `setup:${key}`;
      actionBusyRef.current = operation;
      setActionBusy(operation);
      const next = { ...setupSettings, [key]: value };
      setSetupSettings(next);
      setActionError(null);
      try {
        const saved = await sendJson<ProfileSetupSettings>(
          "PUT",
          "/api/profiles/settings",
          next,
        );
        if (!mountedRef.current) return;
        setSetupSettings(saved);
      } catch (err) {
        if (!mountedRef.current) return;
        setSetupSettings(setupSettings);
        setActionError(
          err instanceof Error ? err.message : "自動セットアップ設定を保存できませんでした",
        );
      } finally {
        if (actionBusyRef.current === operation) {
          actionBusyRef.current = null;
          if (mountedRef.current) setActionBusy(null);
        }
      }
    },
    [setupSettings],
  );

  const doRename = useCallback(
    async (id: string) => {
      if (!renameValue.trim() || actionBusyRef.current !== null || busyIdRef.current !== null) return;
      const operation = `rename:${id}`;
      actionBusyRef.current = operation;
      setActionBusy(operation);
      setActionError(null);
      try {
        await sendJson("PATCH", `/api/profiles/${id}`, { name: renameValue });
        if (!mountedRef.current) return;
        setRenameId(null);
        setRenameValue("");
        await load();
      } catch (err) {
        if (!mountedRef.current) return;
        setActionError(err instanceof Error ? err.message : "名前変更に失敗しました");
      } finally {
        if (actionBusyRef.current === operation) {
          actionBusyRef.current = null;
          if (mountedRef.current) setActionBusy(null);
        }
      }
    },
    [load, renameValue],
  );

  const doDelete = useCallback(
    async (profile: ProfileDto) => {
      if (actionBusyRef.current !== null || busyIdRef.current !== null) return;
      setUnregisterConfirm(null);
      const operation = `delete:${profile.id}`;
      actionBusyRef.current = operation;
      setActionBusy(operation);
      setActionError(null);
      try {
        await sendJson("DELETE", `/api/profiles/${profile.id}`, {});
        if (!mountedRef.current) return;
        await load();
      } catch (err) {
        if (!mountedRef.current) return;
        setActionError(err instanceof Error ? err.message : "ゴミ箱への移動に失敗しました");
      } finally {
        if (actionBusyRef.current === operation) {
          actionBusyRef.current = null;
          if (mountedRef.current) setActionBusy(null);
        }
      }
    },
    [load],
  );

  const applyDependencies = useCallback(async (profile: ProfileDto) => {
    if (actionBusyRef.current !== null || busyIdRef.current !== null) return;
    const operation = `dependencies:${profile.id}`;
    actionBusyRef.current = operation;
    setActionBusy(operation);
    setActionError(null);
    try {
      const result = await sendJson<{ installed: string[] }>("POST", `/api/profiles/${profile.id}/dependencies`, {});
      if (!mountedRef.current) return;
      if (result.installed.length > 0) {
        setActionError(profile.active ? "WebUI依存を追加しました。OpenCode hostを再起動してください。" : "WebUI依存を追加しました。");
      }
      } catch (err) {
        if (!mountedRef.current) return;
        setActionError(err instanceof Error ? err.message : "WebUI依存の適用に失敗しました");
    } finally {
      if (actionBusyRef.current === operation) {
        actionBusyRef.current = null;
        if (mountedRef.current) setActionBusy(null);
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // render states
  // -------------------------------------------------------------------------

  if (state === "loading") {
    return (
      <p aria-busy="true" className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
        プロファイルを読み込んでいます…
      </p>
    );
  }

  if (state === "error" || !data) {
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-4 text-sm text-danger">
        <p className="text-muted">プロファイルを取得できませんでした。</p>
        <Button variant="secondary" className="mt-2" onClick={() => void load()}>
          再試行
        </Button>
      </div>
    );
  }

  const { profiles, canSwitch, reason, migration } = data;
  const jobRunning = job?.state === "running";

  const activeProfile = profiles.find((profile) => profile.active);

  return (
    <section aria-label="プロファイル" className="space-y-4 pb-6">
      <header className="rounded-2xl border border-border bg-surface px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Workspace identity</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-text">プロファイル</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              作業環境を分けて、設定・認証・連携を安全に切り替えます。アクティブな環境はすべての新しいセッションに適用されます。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-56">
            <div className="rounded-xl border border-border bg-bg px-3 py-2.5">
              <span className="block text-muted">登録数</span>
              <strong className="mt-0.5 block text-base text-text">{profiles.length}</strong>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
              <span className="block text-muted">現在の環境</span>
              <strong className="mt-0.5 block truncate text-base text-text">{activeProfile?.name ?? "未設定"}</strong>
            </div>
          </div>
        </div>
      </header>

      {/* Cannot-switch banner */}
      {reason && (
        <div role="alert" className="mb-4 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
          {reason}
        </div>
      )}

      {/* Migration card */}
      {migration?.needed && !jobRunning && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-text">dataDir への移行</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">
            現在の設定（約 {formatBytes(migration.estimatedBytes)}）を{" "}
            <code className="font-mono">%APPDATA%\opencode-webui\profiles\default</code>{" "}
            に複製し、リンクを切り替えます。コピー元は削除されません。
              </p>
            </div>
            <Button
              className="shrink-0"
              onClick={() => void doMigrate()}
              disabled={jobRunning || actionBusy !== null || busyId !== null}
              busy={actionBusy === "migrate"}
            >
              移行を開始
            </Button>
          </div>
        </div>
      )}

      {/* Job progress */}
      {job && (
        <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3" aria-live="polite">
          {job.state === "running" && (
            <>
              <p className="text-sm text-muted">
                複製中… {job.copied} / {job.total > 0 ? job.total : "?"} ファイル
              </p>
              {job.total > 0 && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, (job.copied / job.total) * 100)}%` }}
                  />
                </div>
              )}
            </>
          )}
          {job.state === "done" && (
            <p className="text-sm text-success">
              完了しました。{job.note && ` ${job.note}`}
            </p>
          )}
          {job.state === "error" && (
            <p role="alert" className="text-sm text-danger">{job.error ?? "エラーが発生しました"}</p>
          )}
        </div>
      )}

      {/* Restart error */}
      {restartError && (
        <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {restartError}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {/* Host unavailable notice */}
      {hostOk === false && (
        <p className="mb-4 text-xs text-faint">
          トレイホストが利用できないため、切替後の OpenCode 自動再起動は行われません。手動で再起動してください。
        </p>
      )}

      {setupSettings && (
        <fieldset
          className="rounded-2xl border border-border bg-surface px-5 py-4 shadow-sm"
          aria-busy={actionBusy?.startsWith("setup:") || undefined}
        >
          <legend className="px-1 text-sm font-semibold text-text">新規作成時のセットアップ</legend>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            新規作成・複製時にWebUI連携用の依存ファイルと設定を自動配置します。
          </p>
          <div className="mt-3 grid gap-2 lg:grid-cols-4">
            {([
              ["browserBridge", "Browser Bridge", "ブラウザ操作用のMCPを追加"],
              ["cursorAcp", "Cursor CLI Proxy", "Cursor連携プラグインとプロバイダーを追加"],
              ["claudeAuth", "Claude CLI Proxy", "Claudeサブスクリプション認証プラグインを追加"],
              ["commandcodeAuth", "CommandCode CLI Proxy", "CommandCode CLI経由の認証・ローカルプロキシを追加"],
            ] as const).map(([key, label, description]) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  checked={setupSettings[key]}
                  disabled={actionBusy !== null || busyId !== null}
                  onChange={(event) => void updateSetupSetting(key, event.target.checked)}
                  aria-label={`${label}の自動セットアップ`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{label}</span>
                  <span className="block text-xs text-muted">{description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">登録済みプロファイル</h3>
          <p className="mt-0.5 text-xs text-muted">使用する環境を選び、必要に応じて名前や連携を管理します。</p>
        </div>
        {!createOpen && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={jobRunning || actionBusy !== null || busyId !== null}
          >
            新規作成
          </Button>
        )}
      </div>

      {/* Profile list — desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface shadow-sm sm:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-bg/70">
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="w-1/5 px-5 py-3 font-semibold">名前</th>
              <th scope="col" className="px-5 py-3 font-semibold">保存先</th>
              <th scope="col" className="w-32 px-5 py-3 font-semibold">状態</th>
              <th scope="col" className="w-60 px-5 py-3 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const busy = busyId === p.id;
              return (
                <tr key={p.id} aria-busy={busy || undefined} className="border-b border-border last:border-0 align-top transition-colors hover:bg-surface-2/60">
                  <td className="px-5 py-3.5">
                    {renameId === p.id ? (
                      <input
                        autoFocus
                        className="w-full rounded border border-border bg-bg px-2 py-1 text-sm text-text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void doRename(p.id);
                          if (e.key === "Escape") setRenameId(null);
                        }}
                        aria-label={`${p.name} の新しい名前`}
                      />
                    ) : (
                      <span className="font-medium text-text">{p.name}</span>
                    )}
                  </td>
                  <td className="truncate px-5 py-3.5 font-mono text-xs text-muted" title={p.path}>
                    {p.path}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {p.active && <Badge tone="working">アクティブ</Badge>}
                      {p.external && <Badge tone="neutral">dataDir 外</Badge>}
                      {!p.exists && <Badge tone="danger">不在</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      {!p.active && p.exists && canSwitch && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="justify-center"
                          aria-label={`${p.name}に切り替え`}
                          disabled={busy || jobRunning || restarting || actionBusy !== null}
                          onClick={() => setSwitchConfirm(p)}
                        >
                          切り替え
                        </Button>
                      )}
                      {p.exists && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-center"
                          aria-label={`${p.name}にWebUI依存を適用`}
                          busy={actionBusy === `dependencies:${p.id}`}
                          disabled={jobRunning || actionBusy !== null || busyId !== null}
                          onClick={() => void applyDependencies(p)}
                        >
                          連携を適用
                        </Button>
                      )}
                      {renameId === p.id ? (
                        <Button
                          size="sm"
                          className="justify-center"
                          aria-label={`${p.name}の名前を保存`}
                          busy={actionBusy === `rename:${p.id}`}
                          disabled={actionBusy !== null || busyId !== null || !renameValue.trim()}
                          onClick={() => void doRename(p.id)}
                        >
                          保存
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-center"
                          aria-label={`${p.name}の名前を変更`}
                          disabled={jobRunning || actionBusy !== null || busyId !== null}
                          onClick={() => {
                            setRenameId(p.id);
                            setRenameValue(p.name);
                          }}
                        >
                          名前を変更
                        </Button>
                      )}
                      {!p.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-center"
                          aria-label={`${p.name}をゴミ箱へ移動`}
                          disabled={jobRunning || actionBusy !== null || busyId !== null}
                          onClick={() => setUnregisterConfirm(p)}
                        >
                          ゴミ箱へ移動
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Profile list — mobile cards */}
      <ul className="space-y-3 sm:hidden">
        {profiles.map((p) => {
          const busy = busyId === p.id;
          return (
            <li key={p.id} aria-busy={busy || undefined} className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{p.name}</span>
                {p.active && <Badge tone="working">アクティブ</Badge>}
                {p.external && <Badge tone="neutral">dataDir 外</Badge>}
                {!p.exists && <Badge tone="danger">不在</Badge>}
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted">{p.path}</p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {!p.active && p.exists && canSwitch && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-center"
                    aria-label={`${p.name}に切り替え`}
                    disabled={busy || jobRunning || restarting || actionBusy !== null}
                    onClick={() => setSwitchConfirm(p)}
                  >
                    切り替え
                  </Button>
                )}
                {p.exists && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-center"
                    aria-label={`${p.name}にWebUI依存を適用`}
                    busy={actionBusy === `dependencies:${p.id}`}
                    disabled={jobRunning || actionBusy !== null || busyId !== null}
                    onClick={() => void applyDependencies(p)}
                  >
                    連携を適用
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-center"
                  aria-label={`${p.name}の名前を変更`}
                  disabled={jobRunning || actionBusy !== null || busyId !== null}
                  onClick={() => {
                    setRenameId(p.id);
                    setRenameValue(p.name);
                  }}
                >
                  名前を変更
                </Button>
                {!p.active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-center"
                    aria-label={`${p.name}をゴミ箱へ移動`}
                    disabled={jobRunning || actionBusy !== null || busyId !== null}
                    onClick={() => setUnregisterConfirm(p)}
                  >
                    ゴミ箱へ移動
                  </Button>
                )}
              </div>
              {renameId === p.id && (
                <div className="mt-2 flex gap-1">
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-sm text-text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void doRename(p.id);
                      if (e.key === "Escape") setRenameId(null);
                    }}
                    aria-label={`${p.name} の新しい名前`}
                  />
                  <Button
                    size="sm"
                    busy={actionBusy === `rename:${p.id}`}
                    disabled={actionBusy !== null || busyId !== null || !renameValue.trim()}
                    onClick={() => void doRename(p.id)}
                  >
                    保存
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Create button */}
      <div className="mt-3">
        {createOpen && (
          <div className="rounded-2xl border border-primary/30 bg-surface px-5 py-4 shadow-sm">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-text">新しいプロファイルを作成</h3>
              <p className="mt-0.5 text-xs text-muted">空の環境、または既存環境を複製して始められます。</p>
            </div>
            <label className="block text-xs font-medium text-muted" htmlFor="profile-name">名前</label>
            <input
              id="profile-name"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="例: 実験用"
            />
            <label className="mt-3 block text-xs font-medium text-muted" htmlFor="profile-from">作成元</label>
            <select
              id="profile-from"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={createFrom}
              onChange={(e) => setCreateFrom(e.target.value)}
            >
              <option value="empty">空（自動セットアップ設定を適用）</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} を複製（.git 除外・node_modules 複製）
                </option>
              ))}
            </select>
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                busy={actionBusy === "create"}
                disabled={!createName.trim() || jobRunning || actionBusy !== null || busyId !== null}
                onClick={() => void doCreate()}
              >
                作成
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
                キャンセル
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Switch confirmation dialog */}
      {switchConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="プロファイル切替の確認"
        >
          <div ref={dialogRef} className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-text">
              「{switchConfirm.name}」に切り替えますか？
            </h3>
            <p className="mt-2 text-sm text-muted">
              OpenCode が再起動され、<strong className="text-text">進行中のタスクは中断されます</strong>。
              切替は WebUI・エンジン・ターミナルのすべてに影響します。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" disabled={busyId !== null} onClick={() => setSwitchConfirm(null)}>キャンセル</Button>
              <Button busy={busyId === switchConfirm.id} disabled={actionBusy !== null} onClick={() => void doSwitch(switchConfirm)}>切り替える</Button>
            </div>
          </div>
        </div>
      )}

      {/* Unregister confirmation dialog */}
      {unregisterConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="プロファイル削除（ゴミ箱へ移動）の確認"
        >
          <div ref={dialogRef} className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-text">
              「{unregisterConfirm.name}」をゴミ箱へ移動しますか？
            </h3>
            <p className="mt-2 text-sm text-muted">
              実体ディレクトリ（<code className="font-mono text-xs">{unregisterConfirm.path}</code>）を
              <strong className="text-text">ゴミ箱へ移動</strong>します。ゴミ箱から復元できる場合があります。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" disabled={actionBusy !== null} onClick={() => setUnregisterConfirm(null)}>キャンセル</Button>
              <Button
                variant="danger"
                busy={actionBusy === `delete:${unregisterConfirm.id}`}
                disabled={busyId !== null}
                onClick={() => void doDelete(unregisterConfirm)}
              >
                ゴミ箱へ移動
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Restarting overlay */}
      {restarting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" aria-live="assertive">
          <div className="rounded-2xl border border-border bg-surface px-8 py-6 text-center shadow-xl">
            <p className="text-sm text-muted" aria-busy="true">OpenCode を再起動しています…</p>
          </div>
        </div>
      )}
    </section>
  );
}
