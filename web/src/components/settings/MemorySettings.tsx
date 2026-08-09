"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Badge, cx } from "@/components/ui";
import { ApiError, getJson, sendJson } from "@/lib/client";

type MemoryDto = {
  id: string;
  workspaceId: string;
  kind: "fact" | "preference" | "lesson" | "reference";
  content: string;
  sourceSessionId: string | null;
  provenance:
    | "agent"
    | "auto-extract"
    | "auto-extract-retrospective"
    | "manual";
  approved: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  revision: number;
};

type WorkspaceRow = {
  id: string;
  displayName: string;
  absolutePath: string;
  status: string;
};

type SessionRow = {
  workspaceId: string;
  opencodeSessionId: string;
  title: string;
  favorite: boolean;
  updatedAt: string;
};

const KIND_LABELS: Record<MemoryDto["kind"], string> = {
  fact: "事実",
  preference: "好み",
  lesson: "教訓",
  reference: "参照",
};

const PROVENANCE_LABELS: Record<MemoryDto["provenance"], string> = {
  agent: "エージェント",
  "auto-extract": "自動抽出",
  "auto-extract-retrospective": "自動抽出(振り返り)",
  manual: "手動",
};

type Tab = "approved" | "candidates";

export function MemorySettings() {
  const mountedRef = useRef(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [memories, setMemories] = useState<MemoryDto[]>([]);
  const [tab, setTab] = useState<Tab>("approved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editKind, setEditKind] = useState<MemoryDto["kind"]>("fact");

  const candidates = memories.filter((m) => !m.approved);
  const approved = memories.filter((m) => m.approved);

  const loadWorkspaces = useCallback(async () => {
    try {
      const data = await getJson<{ workspaces: WorkspaceRow[] }>("/api/workspaces");
      setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "ワークスペース一覧を取得できません");
    }
  }, []);

  const loadSessions = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setSessions([]);
      return;
    }
    try {
      const data = await getJson<{ sessions: SessionRow[] }>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      );
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setSessions([]);
    }
  }, []);

  const loadMemories = useCallback(
    async (workspaceId: string) => {
      if (!workspaceId) {
        setMemories([]);
        return;
      }
      try {
        const data = await getJson<{ memories: MemoryDto[] }>("/api/memory", {
          workspace_id: workspaceId,
        });
        setMemories(Array.isArray(data.memories) ? data.memories : []);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "メモリ一覧を取得できません");
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadWorkspaces();
    return () => {
      mountedRef.current = false;
    };
  }, [loadWorkspaces]);

  const selectedWorkspaceChanged = async (workspaceId: string) => {
    setSelectedWorkspace(workspaceId);
    setSelectedSession("");
    await Promise.all([loadSessions(workspaceId), loadMemories(workspaceId)]);
  };

  useEffect(() => {
    if (workspaces.length > 0 && !selectedWorkspace) {
      void selectedWorkspaceChanged(workspaces[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces]);

  const hint = (message: string) => setNotice(message);
  const alert = (message: string) => setLoadError(message);
  const handleMutationError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 409) {
      setEditingId(null);
      void loadMemories(selectedWorkspace);
      alert("別のセッションで更新されたため、最新の内容を再読み込みしました。");
      return;
    }
    alert(err instanceof Error ? err.message : fallback);
  };

  const approveOne = async (memory: MemoryDto) => {
    try {
      const data = await sendJson<{ memory?: MemoryDto }>(
        "POST",
        `/api/memory/${encodeURIComponent(memory.id)}/approve`,
        { workspaceId: selectedWorkspace, expectedRevision: memory.revision },
      );
      if (data.memory) {
        setMemories((prev) => prev.map((m) => (m.id === memory.id ? data.memory! : m)));
        hint("承認しました");
      }
      void loadMemories(selectedWorkspace);
    } catch (err) {
      handleMutationError(err, "承認に失敗しました");
    }
  };

  const approveAll = async () => {
    if (candidates.length === 0) return;
    setBusy(true);
    try {
      for (const id of candidates.map((m) => m.id)) {
        const memory = candidates.find((m) => m.id === id);
        if (!memory) continue;
        await sendJson("POST", `/api/memory/${encodeURIComponent(id)}/approve`, {
          workspaceId: selectedWorkspace,
          expectedRevision: memory.revision,
        });
      }
      hint(`${candidates.length}件を承認しました`);
      void loadMemories(selectedWorkspace);
    } catch (err) {
      handleMutationError(err, "一括承認に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (memory: MemoryDto) => {
    try {
      await sendJson(
        "DELETE",
        `/api/memory/${encodeURIComponent(memory.id)}?workspace_id=${encodeURIComponent(selectedWorkspace)}&expected_revision=${memory.revision}`,
      );
      setMemories((prev) => prev.filter((m) => m.id !== memory.id));
      hint("削除しました");
    } catch (err) {
      handleMutationError(err, "削除に失敗しました");
    }
  };

  const startEdit = (m: MemoryDto) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditKind(m.kind);
    setNotice(null);
  };

  const saveEdit = async (memory: MemoryDto) => {
    try {
      const data = await sendJson<{ memory?: MemoryDto }>(
        "PATCH",
        `/api/memory/${encodeURIComponent(memory.id)}`,
        { workspaceId: selectedWorkspace, expectedRevision: memory.revision, content: editContent, kind: editKind },
      );
      if (data.memory) {
        setMemories((prev) => prev.map((m) => (m.id === memory.id ? data.memory! : m)));
      }
      setEditingId(null);
      hint("保存しました");
    } catch (err) {
      handleMutationError(err, "保存に失敗しました");
    }
  };

  const runExtract = async () => {
    if (!selectedWorkspace || !selectedSession) {
      alert("ワークスペースとセッションを選択してください");
      return;
    }
    setBusy(true);
    setNotice(null);
    setLoadError(null);
    try {
      const data = await sendJson<{ result?: { created: number; skipped: number }; error?: string }>(
        "POST",
        "/api/memory/extract",
        { workspaceId: selectedWorkspace, sessionId: selectedSession },
        undefined,
        { timeoutMs: 150_000 },
      );
      if (data.error) {
        alert(data.error);
      } else {
        hint(
          `抽出完了: ${data.result?.created ?? 0}件作成 / ${data.result?.skipped ?? 0}件重複スキップ`,
        );
        void loadMemories(selectedWorkspace);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "抽出に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const rows = tab === "approved" ? approved : candidates;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted">メモリ</h2>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <label className="flex flex-col gap-1.5">
          <span className="shrink-0 text-sm text-muted">ワークスペース</span>
          <select
            value={selectedWorkspace}
            onChange={(e) => void selectedWorkspaceChanged(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
          >
            {workspaces.length === 0 && <option value="">（ワークスペースなし）</option>}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName || w.absolutePath}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="shrink-0 text-sm text-muted">抽出元セッション</span>
          <div className="flex gap-2">
            <select
              aria-label="抽出元セッション"
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
            >
              <option value="">セッションを選択…</option>
              {sessions.map((s) => (
                <option key={s.opencodeSessionId} value={s.opencodeSessionId}>
                  {s.title}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !selectedWorkspace || !selectedSession}
              onClick={() => void runExtract()}
            >
              今すぐ抽出
            </Button>
          </div>
        </label>

        {notice && <p className="text-[11px] text-success">{notice}</p>}
        {loadError && <p className="text-[11px] text-danger">{loadError}</p>}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("approved")}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm",
            tab === "approved"
              ? "bg-surface-3 text-text"
              : "text-muted hover:text-text",
          )}
        >
          承認済み ({approved.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("candidates")}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm",
            tab === "candidates"
              ? "bg-surface-3 text-text"
              : "text-muted hover:text-text",
          )}
        >
          候補 ({candidates.length})
        </button>
        {tab === "candidates" && candidates.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void approveAll()}
          >
            一括承認
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-[11px] text-faint">
          {tab === "approved"
            ? "承認済みメモリはありません。"
            : "承認候補はありません。"}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border border-border bg-surface px-4 py-3"
            >
              {editingId === m.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-border-strong"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={editKind}
                      onChange={(e) => setEditKind(e.target.value as MemoryDto["kind"])}
                      className="h-8 rounded-lg border border-border bg-bg px-2 text-xs outline-none"
                    >
                      {Object.entries(KIND_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={() => void saveEdit(m)}>
                      保存
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral">{KIND_LABELS[m.kind]}</Badge>
                      <Badge tone="neutral">{PROVENANCE_LABELS[m.provenance]}</Badge>
                      {m.approved && <Badge tone="success">承認済み</Badge>}
                      <span className="text-[11px] text-faint">
                        使用 {m.useCount}回・
                        {new Date(m.createdAt).toLocaleDateString("ja-JP")}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-text">
                      {m.content}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!m.approved && (
                      <Button size="sm" onClick={() => void approveOne(m)}>
                        承認
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => startEdit(m)}
                    >
                      編集
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void removeOne(m)}
                    >
                      削除
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
