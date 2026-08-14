import { useEffect, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { timedFetch } from "@/lib/client";
import {
  isOpenCodeApiGeneration,
  readOpenCodeApiGeneration,
  readOpenCodeApiGenerationFromServer,
  subscribeOpenCodeApiGeneration,
  syncOpenCodeApiGenerationToServer,
  writeOpenCodeApiGeneration,
  type OpenCodeApiGeneration,
} from "@/lib/opencode-generation";
import type { HealthDto, UpdateAvailability, UpdateState, UpdateTarget } from "@/lib/types";

const RESTART_LABELS = {
  webui: "WebUI（フロントエンド）",
  opencode: "LeafCode（バックエンド）",
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
    return "WebUI は復帰しましたが、LeafCode の起動確認が完了しませんでした。設定の接続状態またはトレイログを確認してください。";
  }
  if (target === "webui") {
    return "WebUI の再起動要求は受理されましたが、3分以内にヘルスチェックへ復帰しませんでした。ページを再読み込みし、続く場合はトレイログを確認してください。";
  }
  if (target === "opencode") {
    return "LeafCode の再起動要求は受理されましたが、3分以内に起動確認が完了しませんでした。トレイログを確認してください。";
  }
  return "再起動要求は受理されましたが、3分以内にヘルスチェックへ復帰しませんでした。ページを再読み込みし、続く場合はトレイログを確認してください。";
}

interface EngineSettingsTabProps {
  health: HealthDto | null;
  hostOk: boolean | null;
  refresh: () => Promise<void>;
  setError: (error: string | null) => void;
  updateAvailability: {
    webui: UpdateAvailability;
    opencode: UpdateAvailability;
    nextjs: UpdateAvailability;
  } | null;
}

/**
 * Settings の「エンジン」タブ（REFACTORING_PLAN 5-c / IMPROVEMENT 1-1）。
 * 接続状態・再起動・アップデート・API 生成方式を自己完結で管理する。
 */
export function EngineSettingsTab({
  health,
  hostOk,
  refresh,
  setError,
  updateAvailability,
}: EngineSettingsTabProps) {
  const [restarting, setRestarting] = useState<"webui" | "opencode" | "all" | null>(
    null,
  );
  const [updating, setUpdating] = useState<UpdateTarget | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>(null);
  const [pendingRestart, setPendingRestart] = useState<"webui" | "opencode" | "all" | null>(
    null,
  );
  const [apiGeneration, setApiGeneration] = useState<OpenCodeApiGeneration>(
    () => readOpenCodeApiGeneration(),
  );
  const [apiGenerationBusy, setApiGenerationBusy] = useState(false);
  const restartingRef = useRef(false);
  const updatingRef = useRef<UpdateTarget | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeOpenCodeApiGeneration(() =>
        setApiGeneration(readOpenCodeApiGeneration()),
      ),
    [],
  );

  // Hydrate the durable server copy into localStorage so the browser follows
  // the value another browser may have persisted (e.g. after a reinstall).
  useEffect(() => {
    let cancelled = false;
    void readOpenCodeApiGenerationFromServer().then((fromServer) => {
      if (cancelled || !isOpenCodeApiGeneration(fromServer)) return;
      writeOpenCodeApiGeneration(fromServer);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestRestart = (target: "webui" | "opencode" | "all") => {
    setError(null);
    setPendingRestart(target);
  };

  const changeApiGeneration = (generation: OpenCodeApiGeneration) => {
    if (apiGenerationBusy || generation === apiGeneration) return;
    setApiGenerationBusy(true);
    setApiGeneration(generation);
    writeOpenCodeApiGeneration(generation);
    void syncOpenCodeApiGenerationToServer(generation).finally(() => {
      setApiGenerationBusy(false);
    });
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
            ? `LeafCode CLI を更新しました${typeof data.result?.version === "string" ? `（${data.result.version}）` : ""}。反映には LeafCode の再起動が必要です。`
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

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text">接続状態</h3>
              <p className="mt-1 text-xs text-faint">
                LeafCode {health?.opencode.version ?? ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={health?.webui?.ok ? "success" : "danger"}>
                {health?.webui?.ok ? "WebUI 接続中" : "WebUI 停止"}
              </Badge>
              <Badge tone={health?.opencode?.ok ? "success" : "danger"}>
                {health?.opencode?.ok ? "LeafCode 接続中" : "LeafCode 停止"}
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
                  LeafCode を再起動
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
                  WebUI は <code>git pull --ff-only</code>、LeafCode CLI は upgrade API、Next.js は{" "}
                  <code>npm install next@latest</code> を実行します（いずれも手動操作。起動時には自動実行されません）。
                </p>
              </div>
              {updateAvailability && (
                <div className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[11px] leading-snug text-muted">
                  <p className="font-medium">現在のバージョン</p>
                  <ul className="mt-0.5 list-disc pl-4">
                    <li>
                      WebUI: コミット {updateAvailability.webui.current ?? "不明"}
                      {updateAvailability.webui.currentDate
                        ? `（${updateAvailability.webui.currentDate}）`
                        : ""}
                    </li>
                    <li>LeafCode CLI: バージョン {updateAvailability.opencode.current ?? "不明"}</li>
                    <li>Next.js: バージョン {updateAvailability.nextjs.current ?? "不明"}</li>
                  </ul>
                </div>
              )}
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
                        LeafCode CLI: バージョン {updateAvailability.opencode.current ?? "不明"} → {updateAvailability.opencode.latest ?? "不明"}
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
                  LeafCode CLI を更新
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
                              ? "LeafCode CLI"
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

          <div className="grid gap-3 p-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border bg-bg/40 p-3">
              <div>
                <h3 className="text-xs font-semibold text-muted">API 世代</h3>
                <p className="mt-1 text-xs text-faint">
                  WebUI が LeafCode エンジンを呼ぶ際に使う API 世代です。エンジンが v1 と v2
                  （beta）を併存公開している間は切り替えて比較できます。切り替えはブラウザに
                  即時反映され、サーバにも保存されます。
                </p>
              </div>
              <div role="radiogroup" aria-label="LeafCode API 世代" className="flex flex-col gap-2">
                <label className="flex items-start gap-3 text-sm text-muted">
                  <input
                    type="radio"
                    name="api-generation"
                    value="v1"
                    checked={apiGeneration === "v1"}
                    disabled={apiGenerationBusy}
                    onChange={() => changeApiGeneration("v1")}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>
                    <span className="block text-text">v1（フラット面）</span>
                    <span className="mt-1 block text-xs text-faint">
                      `/session`, `/permission`, `/question` など元々の API。
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm text-muted">
                  <input
                    type="radio"
                    name="api-generation"
                    value="v2"
                    checked={apiGeneration === "v2"}
                    disabled={apiGenerationBusy}
                    onChange={() => changeApiGeneration("v2")}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>
                    <span className="block text-text">v2（/api/* 面）</span>
                    <span className="mt-1 block text-xs text-faint">
                      {"/api/session, /api/session/{id}/prompt など次世代 API。"}
                      セッション作成・prompt・interrupt・permission・question・revert・SSE が
                      v2 パスへ切り替わります。
                    </span>
                  </span>
                </label>
              </div>
              {apiGenerationBusy && (
                <p
                  className="text-xs text-muted"
                  role="status"
                  aria-live="polite"
                >
                  サーバへ保存中…
                </p>
              )}
            </div>
          </div>
    </section>
  );
}
