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
    cursor: { path: string; status: ItemStatus };
  };
  skills: {
    opencodeRoot: { path: string; exists: boolean; count: number };
    mirrors: Record<string, { path: string; status: ItemStatus }>;
    hermes: { path: string; status: ItemStatus };
  };
};

type AgentsSyncResult = {
  ok: boolean;
  instructions: { copied: number; skipped: number; errors: string[] };
  skills: { created: number; skipped: number; errors: string[] };
  hermes: { updated: number; skipped: number; errors: string[] };
  error?: string;
};

type LoadState = "loading" | "ready" | "error";
type AgentsMd = { path: string; exists: boolean; content: string };

export function ProfileAgentsSyncSettings() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<AgentsSyncStatus | null>(null);
  const [agentsMd, setAgentsMd] = useState<AgentsMd | null>(null);
  const [agentsContent, setAgentsContent] = useState("");
  const [savingAgents, setSavingAgents] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [openBusy, setOpenBusy] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const openTarget = useCallback(
    async (target: string, action: "open-file" | "open-folder") => {
      if (openBusy !== null) return;
      setOpenBusy(target);
      setError(null);
      try {
        await sendJson("POST", "/api/profiles/open-target", { target, action });
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "開くことができませんでした");
        }
      } finally {
        if (mountedRef.current) setOpenBusy(null);
      }
    },
    [openBusy],
  );

  const refresh = useCallback(async () => {
    try {
      const [data, md] = await Promise.all([
        getJson<AgentsSyncStatus>("/api/profiles/agents-sync"),
        getJson<AgentsMd>("/api/profiles/agents-md"),
      ]);
      if (!mountedRef.current) return;
      setStatus(data);
      setAgentsMd(md);
      setAgentsContent(md.content);
      setLoadState("ready");
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "同期状況の取得に失敗しました");
      setLoadState("error");
    }
  }, []);

  const saveAgents = async () => {
    if (savingAgents) return;
    setSavingAgents(true);
    setError(null);
    setResultMessage(null);
    try {
      await sendJson("PATCH", "/api/profiles/agents-md", { content: agentsContent });
      if (!mountedRef.current) return;
      setResultMessage("現在のプロファイルのAGENTS.mdを保存しました");
      await refresh();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "AGENTS.mdの保存に失敗しました");
      }
    } finally {
      if (mountedRef.current) setSavingAgents(false);
    }
  };

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
      const totalChanges =
        result.instructions.copied + result.skills.created + result.hermes.updated;
      if (totalChanges === 0) {
        setResultMessage("すべて同期済みです");
      } else {
        setResultMessage(
          `${totalChanges} 件を更新しました（instructions ${result.instructions.copied}, skills ${result.skills.created}, hermes ${result.hermes.updated}）`,
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
        { key: "cursor", label: "Cursor", item: status.instructions.cursor },
      ]
    : [];
  const allInSync =
    loadState === "ready" &&
    status &&
    instructionItems.every((i) => i.item.status.kind === "ok") &&
    Object.values(status.skills.mirrors).every((m) => m.status.kind === "ok") &&
    status.skills.hermes.status.kind === "ok";

  const SIDE_LABELS: Record<string, string> = { claude: "Claude", codex: "Codex", agents: "agents", cursor: "Cursor" };
  const SIDE_TARGET_KEYS: Record<string, string> = {
    claude: "skills-claude",
    codex: "skills-codex",
    agents: "skills-agents",
    cursor: "skills-cursor",
  };
  const mirrorsBySide: Record<string, Array<{ name: string; path: string; status: ItemStatus }>> = {};
  if (status) {
    for (const [key, m] of Object.entries(status.skills.mirrors)) {
      const [side, name] = key.split(":");
      const sideKey = side ?? key;
      (mirrorsBySide[sideKey] ??= []).push({ name: name ?? "", path: m.path, status: m.status });
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-muted">
        AGENTS.md / Skills 同期（グローバル設定）
      </h2>
      <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-xs text-faint">
          グローバル設定を一元管理します。マスターは <code className="font-mono">~/.config/opencode/AGENTS.md</code>
          と <code className="font-mono">~/.config/opencode/skills/</code> で、Claude / Codex / Cursor / agents
          側へミラーします。instructions は内容コピー、skills は symlink で統合します。Hermes
          は <code className="font-mono">~/.hermes/config.yaml</code> の{" "}
          <code className="font-mono">skills.external_dirs</code> に
          <code className="font-mono">~/.agents/skills</code> を登録し、外部ディレクトリを直接スキャンさせます。
          LeafCode 専用の <code className="font-mono">playwright-cli-wrap</code> スキルはミラーしません（Browser Bridge MCP と同様）。
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
                <div className="flex items-center gap-2">
                  {masterOk && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      busy={openBusy === "agents-master"}
                      onClick={() => void openTarget("agents-master", "open-file")}
                    >
                      ファイルを開く
                    </Button>
                  )}
                  <Badge tone={masterOk ? "success" : "danger"}>
                    {masterOk ? "存在" : "未検出"}
                  </Badge>
                </div>
              </div>
            </div>

            {agentsMd && (
              <div className="rounded-lg border border-border bg-bg/40 px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">現在のプロファイルのAGENTS.md</p>
                    <p className="truncate text-[11px] text-faint">{agentsMd.path}</p>
                  </div>
                  <Badge tone={agentsMd.exists ? "success" : "neutral"}>
                    {agentsMd.exists ? "存在" : "新規作成"}
                  </Badge>
                </div>
                <textarea
                  aria-label="現在のプロファイルのAGENTS.md"
                  value={agentsContent}
                  onChange={(event) => setAgentsContent(event.target.value)}
                  rows={14}
                  spellCheck={false}
                  className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs leading-5 text-text outline-none focus:border-accent"
                />
                <div className="mt-2 flex justify-end">
                  <Button type="button" size="sm" variant="primary" busy={savingAgents} onClick={() => void saveAgents()}>
                    AGENTS.mdを保存
                  </Button>
                </div>
              </div>
            )}

            {instructionItems.map(({ key, label, item }) => (
              <InstructionRow
                key={key}
                label={label}
                path={item.path}
                status={item.status}
                onOpen={
                  item.status.kind !== "missing"
                    ? () => void openTarget(`agents-${key}`, "open-file")
                    : undefined
                }
                opening={openBusy === `agents-${key}`}
              />
            ))}

            <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">Skills マスター (OpenCode)</p>
                  <p className="truncate text-[11px] text-faint">{status.skills.opencodeRoot.path}</p>
                </div>
                <div className="flex items-center gap-2">
                  {status.skills.opencodeRoot.exists && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      busy={openBusy === "skills-opencode"}
                      onClick={() => void openTarget("skills-opencode", "open-folder")}
                    >
                      フォルダを開く
                    </Button>
                  )}
                  <Badge tone={status.skills.opencodeRoot.exists ? "success" : "neutral"}>
                    {status.skills.opencodeRoot.exists
                      ? `${status.skills.opencodeRoot.count} skills`
                      : "なし"}
                  </Badge>
                </div>
              </div>
            </div>

            {Object.entries(mirrorsBySide).map(([side, items]) => {
              const targetKey = SIDE_TARGET_KEYS[side];
              return (
                <div key={side} className="rounded-lg border border-border bg-bg/40 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text">{SIDE_LABELS[side] ?? side}</p>
                    {targetKey && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        busy={openBusy === targetKey}
                        onClick={() => void openTarget(targetKey, "open-folder")}
                      >
                        フォルダを開く
                      </Button>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {items.map((item) => (
                      <SkillItemRow key={item.name} name={item.name} path={item.path} status={item.status} />
                    ))}
                  </ul>
                </div>
              );
            })}

            {status.skills.hermes && (
              <InstructionRow
                label="Hermes (external_dirs)"
                path={status.skills.hermes.path}
                status={status.skills.hermes.status}
                onOpen={() => void openTarget("agents-hermes", "open-file")}
                opening={openBusy === "agents-hermes"}
              />
            )}

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
  onOpen,
  opening,
}: {
  label: string;
  path: string;
  status: ItemStatus;
  onOpen?: () => void;
  opening?: boolean;
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
        <div className="flex items-center gap-2">
          {onOpen && (
            <Button type="button" size="sm" variant="ghost" busy={opening} onClick={onOpen}>
              ファイルを開く
            </Button>
          )}
          <Badge tone={tone}>{statusText}</Badge>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-faint">{status.message}</p>
    </div>
  );
}

function SkillItemRow({
  name,
  path,
  status,
}: {
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
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 bg-surface px-2 py-1">
      <div className="min-w-0">
        <p className="text-xs font-medium text-text">{name}</p>
        <p className="truncate text-[10px] text-faint">{path}</p>
      </div>
      <Badge tone={tone}>{statusText}</Badge>
    </li>
  );
}
