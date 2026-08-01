"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { getJson, ocJson, sendJson } from "@/lib/client";

type SessionRow = {
  opencodeSessionId: string;
  title: string;
  updatedAt: string;
};

export function SessionSwitcher({
  workspaceId,
  directory,
  currentSessionId,
  onSwitch,
}: {
  workspaceId: string;
  directory: string;
  currentSessionId: string | null;
  onSwitch: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Keep the user's selection while the parent catches up with onSwitch.
  const [localSelection, setLocalSelection] = useState<string | null>(null);

  useEffect(() => {
    setLocalSelection(currentSessionId);
  }, [currentSessionId]);

  const refresh = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await getJson<{
        sessions?: { opencodeSessionId: string; title: string; updatedAt: string }[];
      }>(`/api/workspaces/${workspaceId}/sessions`);
      setSessions(data.sessions ?? []);
      setSessionsError(null);
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "セッション一覧を取得できませんでした",
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Rebind only bumps updated_at server-side; the visible list stays valid.
  // Avoid a full refresh on every select change to prevent dropdown flicker.
  const updateSessionOrder = useCallback(
    async (id: string) => {
      const title =
        sessions.find((s) => s.opencodeSessionId === id)?.title ?? "Session";
      await sendJson("POST", `/api/workspaces/${workspaceId}/sessions`, {
        opencodeSessionId: id,
        title,
      });
    },
    [sessions, workspaceId],
  );

  const create = async () => {
    setBusy(true);
    setCreateError(null);
    try {
      const session = await ocJson<{ id: string }>("/session", directory, {
        method: "POST",
        body: { title: `Session ${sessions.length + 1}` },
      });
      await sendJson("POST", `/api/workspaces/${workspaceId}/sessions`, {
        opencodeSessionId: session.id,
        title: `Session ${sessions.length + 1}`,
      });
      await refresh();
      onSwitch();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "セッションを作成できませんでした",
      );
    } finally {
      setBusy(false);
    }
  };

  if (sessions.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          title={
            sessionsLoading
              ? "セッション一覧を読み込み中"
              : sessionsError ?? createError ?? "セッションを追加"
          }
          aria-label={
            sessionsLoading
              ? "セッション一覧を読み込み中"
              : sessionsError
                ? `セッション一覧エラー: ${sessionsError}`
                : createError
                  ? `セッション追加失敗: ${createError}`
                  : "セッションを追加"
          }
          busy={busy || sessionsLoading}
          disabled={sessionsLoading}
          onClick={() => void create()}
        >
          <Plus className="h-3.5 w-3.5" />
          <Layers className="h-3.5 w-3.5" />
        </Button>
        {sessionsError && !sessionsLoading && (
          <span
            role="status"
            aria-live="polite"
            className="max-w-40 truncate text-[11px] text-danger"
            title={sessionsError}
          >
            セッション一覧を取得できません
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="セッション切替"
        value={localSelection ?? currentSessionId ?? ""}
        onChange={async (e) => {
          const id = e.target.value;
          if (!id || id === currentSessionId) return;
          setLocalSelection(id);
          setBusy(true);
          try {
            await updateSessionOrder(id);
            onSwitch();
          } catch {
            // Bind failed (engine down, etc.): resync the dropdown to real state
            // instead of leaving an unhandled rejection and a lying selection.
            await refresh();
            setLocalSelection(currentSessionId);
          } finally {
            setBusy(false);
          }
        }}
        onFocus={() => void refresh()}
        aria-busy={sessionsLoading || undefined}
        title={sessionsError ?? undefined}
        disabled={busy}
        className={cx(
          "h-8 max-w-[7rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-xs outline-none sm:max-w-[9rem]",
        )}
      >
        {sessions.map((s) => (
          <option key={s.opencodeSessionId} value={s.opencodeSessionId}>
            {s.title || s.opencodeSessionId.slice(0, 10)}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon"
        title={createError ?? "新セッション"}
        aria-label={createError ? `セッション追加失敗: ${createError}` : "新セッション"}
        busy={busy}
        onClick={() => void create()}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
