"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";

type ItemStatus = { kind: string; message: string };

type AgentsSyncStatus = {
  instructions: {
    master: { path: string; exists: boolean };
    claude: { path: string; status: ItemStatus };
    codex: { path: string; status: ItemStatus };
  };
  skills: {
    opencodeRoot: { path: string; exists: boolean; count: number };
    mirrors: Record<string, { path: string; status: ItemStatus }>;
  };
};

type AgentsSyncResult = {
  ok: boolean;
  instructions: { copied: number; skipped: number; errors: string[] };
  skills: { created: number; skipped: number; errors: string[] };
  error?: string;
};

type LoadState = "loading" | "ready" | "error";

export function ProfileAgentsSyncSettings() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<AgentsSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<AgentsSyncStatus>("/api/profiles/agents-sync");
      if (!mountedRef.current) return;
      setStatus(data);
      setLoadState("ready");
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "同期状況の取得に失敗しました");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const onActivated = () => void refresh();
    window.addEventListener("profile-activated", onActivated);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("profile-activated", onActivated);
    };
  }, [refresh]);

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setResultMessage(null);
    try {
      const result = await sendJson<AgentsSyncResult>("POST", "/api/profiles/agents-sync");
      if (!mountedRef.current) return;
      if (!result.ok) {
        const messages = [
          ...result.instructions.errors,
          ...result.skills.errors,
        ].join(" / ");
        setError(messages || "同期に失敗しました");
        return;
      }
      const totalChanges = result.instructions.copied + result.skills.created;
      if (totalChanges === 0) {
        setResultMessage("すべて同期済みです");
      } else {
        setResultMessage(
          `${totalChanges} 件を更新しました（instructions ${result.instructions.copied}, skills ${result.skills.created}）`,
        );
      }
      await refresh();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "同期の実行に失敗しました");
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  };

  const masterOk = status?.instructions.master.exists ?? false;
  const instructionItems = status?.instructions
    ? [
        { key: "claude", label: "Claude", item: status.instructions.claude },
        { key: "codex", label: "Codex", item: status.instructions.codex },
      ]
    : [];
  const allInSync =
    loadState === "ready" &&
    status &&
    instructionItems.every((i) => i.item.status.kind === "ok") &&
    Object.values(status.skills.mirrors).every((m) => m.status.kind === "ok");

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-muted">
        AGENTS.md / Skills 同期（グローバル設定）
      </h2>
      <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-xs text-faint">
          グローバル設定を一元管理します。マスターは <code className="font-mono">~/.config/opencode/AGENTS.md</code>
          と <code className="font-mono">~/.config/opencode/skills/</code> で、Claude / Codex / agents
          側へミラーします。instructions は内容コピー、skills は symlink で統合します。
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
            <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">マスター (OpenCode)</p>
                  <p className="truncate text-[11px] text-faint">{status.instructions.master.path}</p>
                </div>
                <Badge tone={masterOk ? "success" : "danger"}>
                  {masterOk ? "存在" : "未検出"}
                </Badge>
              </div>
            </div>

            {instructionItems.map(({ key, label, item }) => (
              <InstructionRow key={key} label={label} path={item.path} status={item.status} />
            ))}

            <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">Skills マスター (OpenCode)</p>
                  <p className="truncate text-[11px] text-faint">{status.skills.opencodeRoot.path}</p>
                </div>
                <Badge tone={status.skills.opencodeRoot.exists ? "success" : "neutral"}>
                  {status.skills.opencodeRoot.exists
                    ? `${status.skills.opencodeRoot.count} skills`
                    : "なし"}
                </Badge>
              </div>
            </div>

            {Object.entries(status.skills.mirrors).map(([key, m]) => {
              const [side, name] = key.split(":");
              return (
                <SkillRow
                  key={key}
                  side={side ?? key}
                  name={name ?? ""}
                  path={m.path}
                  status={m.status}
                />
              );
            })}

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
                同期を実行
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
                <Badge tone="warning" pulse>変更あり</Badge>
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

function InstructionRow({
  label,
  path,
  status,
}: {
  label: string;
  path: string;
  status: ItemStatus;
}) {
  const tone =
    status.kind === "ok"
      ? "success"
      : status.kind === "wouldChange"
        ? "warning"
        : status.kind === "blocked"
          ? "danger"
          : "neutral";
  const statusText =
    status.kind === "ok"
      ? "同期済み"
      : status.kind === "wouldChange"
        ? "変更あり"
        : status.kind === "blocked"
          ? "ブロック"
          : "未検出";

  return (
    <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="truncate text-[11px] text-faint">{path}</p>
        </div>
        <Badge tone={tone}>{statusText}</Badge>
      </div>
      <p className="mt-1 text-[11px] text-faint">{status.message}</p>
    </div>
  );
}

function SkillRow({
  side,
  name,
  path,
  status,
}: {
  side: string;
  name: string;
  path: string;
  status: ItemStatus;
}) {
  const tone =
    status.kind === "ok"
      ? "success"
      : status.kind === "wouldChange"
        ? "warning"
        : status.kind === "blocked"
          ? "danger"
          : "neutral";
  const statusText =
    status.kind === "ok"
      ? "symlink OK"
      : status.kind === "wouldChange"
        ? "作成予定"
        : status.kind === "blocked"
          ? "ブロック"
          : "未検出";

  return (
    <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">
            {side} / {name}
          </p>
          <p className="truncate text-[11px] text-faint">{path}</p>
        </div>
        <Badge tone={tone}>{statusText}</Badge>
      </div>
      <p className="mt-1 text-[11px] text-faint">{status.message}</p>
    </div>
  );
}
