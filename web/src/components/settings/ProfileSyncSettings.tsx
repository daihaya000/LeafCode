"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, cx } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";

type SyncTargetStatus = {
  exists: boolean;
  inSync: boolean;
  wouldChange: boolean;
  message: string;
};

type SyncPlan = {
  ok: boolean;
  masterServers: string[];
  targets: Record<string, SyncTargetStatus>;
  error?: string;
};

type SyncStatus = {
  master: {
    path: string;
    exists: boolean;
    servers: string[];
    error: string | null;
  };
  codex: { path: string; exists: boolean };
  claude: { path: string; exists: boolean };
};

type SyncApplyResult = {
  ok: boolean;
  masterServers: string[];
  changedFiles: number;
  targets: Record<string, { exists: boolean; updated: boolean; message: string }>;
  error?: string;
};

type LoadState = "loading" | "ready" | "error";

export function ProfileSyncSettings() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<{ status: SyncStatus; plan: SyncPlan }>(
        "/api/profiles/sync",
      );
      if (!mountedRef.current) return;
      setStatus(data.status);
      setPlan(data.plan);
      setLoadState("ready");
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "同期状況の取得に失敗しました");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setResultMessage(null);
    try {
      const result = await sendJson<SyncApplyResult>("POST", "/api/profiles/sync");
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(result.error ?? "同期に失敗しました");
        return;
      }
      const changed = result.changedFiles;
      const targetMessages = Object.entries(result.targets)
        .map(([name, t]) => `${name}: ${t.message}`)
        .join(" / ");
      setResultMessage(
        changed > 0
          ? `${changed} ファイルを更新しました（${targetMessages}）`
          : `すべて同期済みです（${targetMessages}）`,
      );
      await refresh();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "同期の実行に失敗しました");
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  };

  const masterOk = status?.master?.exists && !status.master.error;
  const masterServers = status?.master?.servers ?? [];
  const allInSync =
    plan?.ok === true &&
    Object.values(plan.targets).every((t) => !t.exists || t.inSync);
  const wouldChangeCount = plan?.ok === true
    ? Object.values(plan.targets).filter((t) => t.wouldChange).length
    : 0;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted">
        プロファイル同期（opencode → codex / claude）
      </h2>
      <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-xs text-faint">
          opencode.jsonc の <code className="font-mono">mcp</code> セクションをマスターにし、
          codex（<code className="font-mono">config.toml</code>）と claude
          （<code className="font-mono">settings.json</code>）の MCP サーバー定義へ同期します。
          製品固有の設定（codex の plugins/projects、claude の permissions/theme 等）は保持されます。
        </p>

        {error && (
          <p
            className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
            role="alert"
          >
            {error}
          </p>
        )}

        {resultMessage && (
          <p
            className="rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-xs text-success"
            role="status"
          >
            {resultMessage}
          </p>
        )}

        {loadState === "loading" && (
          <p className="text-xs text-faint">読み込み中…</p>
        )}

        {loadState === "ready" && status && (
          <div className="space-y-3">
            <MasterStatusRow
              label="マスター (opencode)"
              path={status.master.path}
              exists={status.master.exists}
              error={status.master.error}
              servers={masterServers}
            />
            <TargetRow
              label="Codex"
              path={status.codex.path}
              target={plan?.targets?.codex}
            />
            <TargetRow
              label="Claude"
              path={status.claude.path}
              target={plan?.targets?.claude}
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="primary"
                busy={syncing}
                disabled={!masterOk || syncing}
                onClick={() => void runSync()}
              >
                <RefreshCw className="h-4 w-4" />
                {wouldChangeCount > 0 ? `${wouldChangeCount} ファイルを同期` : "同期を実行"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void refresh()}
                disabled={syncing}
              >
                状況を更新
              </Button>
              {allInSync ? (
                <Badge tone="success">すべて同期済み</Badge>
              ) : masterOk ? (
                <Badge tone="warning" pulse>
                  変更あり
                </Badge>
              ) : (
                <Badge tone="danger">マスター未検出</Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MasterStatusRow({
  label,
  path,
  exists,
  error,
  servers,
}: {
  label: string;
  path: string;
  exists: boolean;
  error: string | null;
  servers: string[];
}) {
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-2",
        exists && !error
          ? "border-border bg-bg/40"
          : "border-danger/30 bg-danger-bg/40",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="truncate text-[11px] text-faint">{path}</p>
        </div>
        <Badge tone={exists && !error ? "success" : "danger"}>
          {exists && !error ? `${servers.length} サーバー` : "未検出"}
        </Badge>
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
      {exists && !error && servers.length > 0 && (
        <p className="mt-1 truncate text-[11px] text-faint">
          {servers.join(", ")}
        </p>
      )}
    </div>
  );
}

function TargetRow({
  label,
  path,
  target,
}: {
  label: string;
  path: string;
  target?: SyncTargetStatus;
}) {
  const exists = target?.exists ?? false;
  const inSync = target?.inSync ?? false;
  const tone = !exists ? "neutral" : inSync ? "success" : "warning";
  const statusText = !exists
    ? "ファイルなし"
    : inSync
      ? "同期済み"
      : "変更あり";

  return (
    <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="truncate text-[11px] text-faint">{path}</p>
        </div>
        <Badge tone={tone}>{statusText}</Badge>
      </div>
      {target?.message && (
        <p className="mt-1 text-[11px] text-faint">{target.message}</p>
      )}
    </div>
  );
}