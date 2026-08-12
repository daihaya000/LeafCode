"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Badge, cx } from "@/components/ui";
import { ApiError, getJson, sendJson } from "@/lib/client";
import { MEMORY_WRITE_APPROVAL_SETTING_KEY } from "@/lib/memory-settings";

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

type ExtractionRun = {
  id: string;
  sourceSessionId: string;
  assistantMessageId: string | null;
  trigger: "assistant-completed" | "goal-completed" | "idle" | "manual";
  status: "running" | "completed" | "failed";
  createdCount: number;
  savedCount: number;
  candidateCount: number;
  rejectedCount: number;
  skippedCount: number;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  readAt: number | null;
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

const EXTRACTION_TRIGGER_LABELS: Record<ExtractionRun["trigger"], string> = {
  "assistant-completed": "会話完了",
  "goal-completed": "ゴール完了",
  idle: "アイドル時",
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
  const [writeApproval, setWriteApproval] = useState(false);
  const [writeApprovalLoaded, setWriteApprovalLoaded] = useState(false);
  const [writeApprovalBusy, setWriteApprovalBusy] = useState(false);
  const [extractionRuns, setExtractionRuns] = useState<ExtractionRun[]>([]);
  const [unreadExtractionCount, setUnreadExtractionCount] = useState(0);
  const [extractionHistoryLoading, setExtractionHistoryLoading] = useState(false);
  const [extractionHistoryBusy, setExtractionHistoryBusy] = useState(false);
  const [consolidateBusy, setConsolidateBusy] = useState(false);

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

  const loadExtractionHistory = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setExtractionRuns([]);
      setUnreadExtractionCount(0);
      return;
    }
    setExtractionHistoryLoading(true);
    try {
      const data = await getJson<{
        runs: ExtractionRun[];
        unreadCount: number;
      }>("/api/memory/extractions", {
        workspace_id: workspaceId,
        limit: "20",
      });
      setExtractionRuns(Array.isArray(data.runs) ? data.runs : []);
      setUnreadExtractionCount(
        typeof data.unreadCount === "number" ? data.unreadCount : 0,
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "抽出履歴を取得できません");
    } finally {
      setExtractionHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadWorkspaces();
    void getJson<{ value: string | null }>(
      `/api/settings/${MEMORY_WRITE_APPROVAL_SETTING_KEY}`,
    )
      .then((data) => setWriteApproval(data.value === "1"))
      .catch(() => {
        // The safe default is automatic writes when the setting is unavailable.
      })
      .finally(() => setWriteApprovalLoaded(true));
    return () => {
      mountedRef.current = false;
    };
  }, [loadWorkspaces]);

  const selectedWorkspaceChanged = async (workspaceId: string) => {
    setSelectedWorkspace(workspaceId);
    setSelectedSession("");
    await Promise.all([
      loadSessions(workspaceId),
      loadMemories(workspaceId),
      loadExtractionHistory(workspaceId),
    ]);
  };

  useEffect(() => {
    if (workspaces.length > 0 && !selectedWorkspace) {
      void selectedWorkspaceChanged(workspaces[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    const timer = window.setInterval(() => {
      void loadExtractionHistory(selectedWorkspace);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [selectedWorkspace, loadExtractionHistory]);

  const hint = (message: string) => setNotice(message);
  const alert = (message: string) => setLoadError(message);

  const toggleWriteApproval = async (enabled: boolean) => {
    setWriteApprovalBusy(true);
    try {
      await sendJson("PUT", `/api/settings/${MEMORY_WRITE_APPROVAL_SETTING_KEY}`, {
        value: enabled ? "1" : "",
      });
      setWriteApproval(enabled);
      hint(enabled ? "保存前の確認を有効にしました" : "自動保存を有効にしました");
    } catch (err) {
      alert(err instanceof Error ? err.message : "メモリ保存設定の更新に失敗しました");
    } finally {
      setWriteApprovalBusy(false);
    }
  };
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
      const data = await sendJson<{
        result?: {
          created: number;
          saved?: number;
          candidates?: number;
          rejected?: number;
          skipped: number;
        };
        error?: string;
      }>(
        "POST",
        "/api/memory/extract",
        { workspaceId: selectedWorkspace, sessionId: selectedSession },
        undefined,
        { timeoutMs: 150_000 },
      );
      if (data.error) {
        alert(data.error);
        void loadExtractionHistory(selectedWorkspace);
      } else {
        hint(
          `${writeApproval ? "候補抽出" : "自動保存"}完了: 保存 ${data.result?.saved ?? 0}件 / 候補 ${data.result?.candidates ?? 0}件 / 拒否 ${data.result?.rejected ?? 0}件 / 重複 ${data.result?.skipped ?? 0}件`,
        );
        void loadMemories(selectedWorkspace);
        void loadExtractionHistory(selectedWorkspace);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "抽出に失敗しました");
      void loadExtractionHistory(selectedWorkspace);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Two-step cleanup for duplicates written by the older extraction path: the
   * dry run reports the count, and the user confirms before anything is deleted.
   */
  const consolidateDuplicates = async () => {
    if (!selectedWorkspace) {
      alert("ワークスペースを選択してください");
      return;
    }
    setConsolidateBusy(true);
    setNotice(null);
    setLoadError(null);
    try {
      const preview = await sendJson<{ removed: number; remaining: number; scanned: number }>(
        "POST",
        "/api/memory/consolidate",
        { workspaceId: selectedWorkspace, dryRun: true },
      );
      if (preview.removed === 0) {
        hint(`同義の重複は見つかりませんでした（${preview.scanned}件を確認）`);
        return;
      }
      const ok = window.confirm(
        `同義の重複 ${preview.removed}件を削除します（${preview.scanned}件 → ${preview.remaining}件）。\n` +
          "各グループで最も古い行（承認済みを優先）を残し、使用回数は残る行に引き継ぎます。\n" +
          "この操作は取り消せません。実行しますか？",
      );
      if (!ok) {
        hint(`重複 ${preview.removed}件（未削除）`);
        return;
      }
      const applied = await sendJson<{ removed: number; remaining: number }>(
        "POST",
        "/api/memory/consolidate",
        { workspaceId: selectedWorkspace, dryRun: false },
      );
      hint(`重複 ${applied.removed}件を削除しました（残り ${applied.remaining}件）`);
      void loadMemories(selectedWorkspace);
    } catch (err) {
      alert(err instanceof Error ? err.message : "重複の整理に失敗しました");
    } finally {
      setConsolidateBusy(false);
    }
  };

  const markExtractionHistoryRead = async () => {
    if (!selectedWorkspace || unreadExtractionCount === 0) return;
    setExtractionHistoryBusy(true);
    try {
      const data = await sendJson<{ unreadCount?: number }>(
        "POST",
        "/api/memory/extractions/read",
        { workspaceId: selectedWorkspace },
      );
      setUnreadExtractionCount(data.unreadCount ?? 0);
      setExtractionRuns((prev) =>
        prev.map((run) => (run.readAt === null ? { ...run, readAt: Date.now() } : run)),
      );
      hint("抽出履歴を既読にしました");
    } catch (err) {
      alert(err instanceof Error ? err.message : "抽出履歴の既読化に失敗しました");
    } finally {
      setExtractionHistoryBusy(false);
    }
  };

  const rows = tab === "approved" ? approved : candidates;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted">メモリ</h2>
          {unreadExtractionCount > 0 && (
            <Badge tone="warning" pulse>
              新着 {unreadExtractionCount}件
            </Badge>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-5 text-muted">
        <p>
          プロジェクトで繰り返し使う事実・好み・教訓を、セッションやタスクをまたいで保持します。
        </p>
        <p className="mt-1 text-faint">
          メモリはプロジェクト単位で共有されます。ワークスペース（タスク）を選ぶと、そのプロジェクトのメモリが表示されます。
        </p>
        <p className="mt-1 text-faint">
          {writeApproval
            ? "保存前の確認が有効です。会話から抽出した内容は「候補」になり、承認すると今後の会話で参照されます。"
            : "自動保存が有効です。会話から抽出した内容は脅威検査後、承認なしで今後の会話から参照されます。"
          }
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3">
        <label
          className="flex cursor-pointer items-start gap-3"
          htmlFor="memory-write-approval"
        >
          <input
            id="memory-write-approval"
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            checked={writeApproval}
            disabled={!writeApprovalLoaded || writeApprovalBusy}
            onChange={(event) => void toggleWriteApproval(event.target.checked)}
            aria-label="メモリの保存前確認"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text">
              保存前に確認する
            </span>
            <span className="block text-xs leading-5 text-muted">
              {writeApproval
                ? "新しいメモリは候補として保存され、承認するまで注入されません。"
                : "OFF（推奨）では、検査を通過したメモリを自動で使用します。"
              }
            </span>
          </span>
        </label>
        <p className="mt-2 pl-7 text-[11px] leading-5 text-faint">
          自動保存でも、不可視文字・メモリ境界タグ・明白なプロンプト注入・資格情報やSSH鍵の持ち出しは保存前に拒否されます。
        </p>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <label className="flex flex-col gap-1.5">
          <span className="shrink-0 text-sm text-muted">対象プロジェクト（ワークスペースで選択）</span>
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
          <span className="shrink-0 text-sm text-muted">記憶を探す会話</span>
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
              {writeApproval ? "候補を抽出" : "メモリを抽出"}
            </Button>
          </div>
          <span className="text-[11px] text-faint">
            選んだ会話の未抽出分をAIが読み、長く役立つ内容だけを
            {writeApproval ? "候補" : "メモリ"}として作成します。既存メモリと同義の内容は保存されません。抽出にはモデル利用料がかかる場合があります。
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-[11px] text-faint">
            以前のバージョンで作られた同義の重複をまとめます。まず件数を確認し、確認後に削除します。
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={consolidateBusy || !selectedWorkspace}
            onClick={() => void consolidateDuplicates()}
          >
            重複を整理
          </Button>
        </div>

        {notice && <p className="text-[11px] text-success">{notice}</p>}
        {loadError && <p className="text-[11px] text-danger">{loadError}</p>}
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-text">自動抽出の履歴</h3>
            <p className="mt-0.5 text-[11px] text-faint">
              保存・候補化・拒否・失敗した抽出結果を確認できます。
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={extractionHistoryBusy || unreadExtractionCount === 0}
            onClick={() => void markExtractionHistoryRead()}
          >
            すべて既読
          </Button>
        </div>
        {extractionHistoryLoading ? (
          <p className="text-[11px] text-faint">履歴を読み込み中…</p>
        ) : extractionRuns.length === 0 ? (
          <p className="text-[11px] text-faint">まだ抽出履歴はありません。</p>
        ) : (
          <ul className="space-y-1.5">
            {extractionRuns.map((run) => {
              const sessionTitle = sessions.find(
                (session) => session.opencodeSessionId === run.sourceSessionId,
              )?.title;
              const sourceLabel = sessionTitle || run.sourceSessionId.slice(0, 12);
              const statusTone =
                run.status === "completed"
                  ? "success"
                  : run.status === "failed"
                    ? "danger"
                    : "working";
              const statusLabel =
                run.status === "completed"
                  ? `保存 ${run.savedCount} / 候補 ${run.candidateCount} / 拒否 ${run.rejectedCount}`
                  : run.status === "failed"
                    ? `失敗: ${run.error || "原因不明"}`
                    : "実行中";
              return (
                <li
                  key={run.id}
                  className={cx(
                    "rounded-lg border px-3 py-2",
                    run.readAt === null
                      ? "border-warning/40 bg-warning-bg/30"
                      : "border-border bg-bg/30",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={statusTone}>{statusLabel}</Badge>
                    <Badge tone="neutral">{EXTRACTION_TRIGGER_LABELS[run.trigger]}</Badge>
                    {run.readAt === null && <Badge tone="warning">未読</Badge>}
                    <span className="text-[11px] text-faint">
                      {new Date(run.startedAt).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted" title={run.sourceSessionId}>
                    {sourceLabel}
                    {run.status === "completed" && run.skippedCount > 0
                      ? `・重複 ${run.skippedCount}件`
                      : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
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
          使用中 ({approved.length})
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
            ? writeApproval
              ? "使用中のメモリはありません。候補を承認すると、今後の会話で利用されます。"
              : "使用中のメモリはありません。会話から抽出すると、検査後に自動で利用されます。"
            : "確認待ちの候補はありません。上の「候補を抽出」から作成できます。"}
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
