"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Plus, RefreshCw, Star } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { getJson, ocJson, sendJson } from "@/lib/client";

type SessionRow = {
  opencodeSessionId: string;
  title: string;
  favorite: boolean;
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
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  // Keep the user's selection while the parent catches up with onSwitch.
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const busyRef = useRef(false);
  const refreshIdRef = useRef(0);
  const mountedRef = useRef(false);
  const workspaceGenerationRef = useRef(0);

  useEffect(() => {
    setLocalSelection(currentSessionId);
  }, [currentSessionId]);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    const requestId = ++refreshIdRef.current;
    setSessionsLoading(true);
    try {
      const data = await getJson<{
        sessions?: { opencodeSessionId: string; title: string; favorite?: boolean; updatedAt: string }[];
      }>(`/api/workspaces/${workspaceId}/sessions`);
      if (!mountedRef.current || requestId !== refreshIdRef.current) return;
      setSessions(
        (data.sessions ?? []).map((session) => ({
          ...session,
          favorite: session.favorite === true,
        })),
      );
      setSessionsError(null);
    } catch (err) {
      if (!mountedRef.current || requestId !== refreshIdRef.current) return;
      setSessionsError(
        err instanceof Error ? err.message : "セッション一覧を取得できませんでした",
      );
    } finally {
      if (mountedRef.current && requestId === refreshIdRef.current) setSessionsLoading(false);
    }
  }, [workspaceId]);

  const toggleFavorite = async () => {
    const id = localSelection ?? currentSessionId;
    const session = sessions.find((item) => item.opencodeSessionId === id);
    if (!id || !session || favoriteBusy) return;
    const nextFavorite = !session.favorite;
    setFavoriteBusy(true);
    setSessions((current) =>
      current.map((item) =>
        item.opencodeSessionId === id ? { ...item, favorite: nextFavorite } : item,
      ),
    );
    try {
      await sendJson("POST", `/api/workspaces/${workspaceId}/sessions`, {
        opencodeSessionId: id,
        favorite: nextFavorite,
      });
    } catch (err) {
      setSessions((current) =>
        current.map((item) =>
          item.opencodeSessionId === id ? { ...item, favorite: !nextFavorite } : item,
        ),
      );
      setSwitchError(
        err instanceof Error ? err.message : "お気に入りを更新できませんでした",
      );
    } finally {
      setFavoriteBusy(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    workspaceGenerationRef.current += 1;
    void refresh();
    return () => {
      mountedRef.current = false;
      refreshIdRef.current += 1;
      workspaceGenerationRef.current += 1;
    };
  }, [workspaceId, refresh]);

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
    if (busy || busyRef.current) return;
    const generation = workspaceGenerationRef.current;
    busyRef.current = true;
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
      if (!mountedRef.current || generation !== workspaceGenerationRef.current) return;
      onSwitch();
    } catch (err) {
      if (!mountedRef.current || generation !== workspaceGenerationRef.current) return;
      setCreateError(
        err instanceof Error ? err.message : "セッションを作成できませんでした",
      );
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  if (sessions.length <= 1) {
    const canRetryList = sessionsError !== null && !sessionsLoading;
    return (
      <div className="flex min-w-0 items-center gap-1">
        {sessions.length === 1 && (
          <Button
            variant="ghost"
            size="icon"
            title={sessions[0].favorite ? "お気に入りから外す" : "お気に入りに追加"}
            aria-label={sessions[0].favorite ? "お気に入りから外す" : "お気に入りに追加"}
            busy={favoriteBusy}
            disabled={favoriteBusy}
            onClick={() => void toggleFavorite()}
          >
            <Star className={cx("h-3.5 w-3.5", sessions[0].favorite && "fill-current text-primary")} />
          </Button>
        )}
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
          onClick={() => void (canRetryList ? refresh() : create())}
        >
          {canRetryList ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              <Layers className="h-3.5 w-3.5" />
            </>
          )}
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
          if (!id || id === currentSessionId || busyRef.current) return;
          const generation = workspaceGenerationRef.current;
          busyRef.current = true;
          setLocalSelection(id);
          setSwitchError(null);
          setBusy(true);
          try {
            await updateSessionOrder(id);
            if (!mountedRef.current || generation !== workspaceGenerationRef.current) return;
            onSwitch();
          } catch (err) {
            if (!mountedRef.current || generation !== workspaceGenerationRef.current) return;
            // Bind failed (engine down, etc.): resync the dropdown to real state
            // instead of leaving an unhandled rejection and a lying selection.
            setSwitchError(
              err instanceof Error ? err.message : "セッションを切り替えられませんでした",
            );
            await refresh();
            setLocalSelection(currentSessionId);
          } finally {
            busyRef.current = false;
            if (mountedRef.current) setBusy(false);
          }
        }}
        onFocus={() => void refresh()}
        aria-busy={sessionsLoading || undefined}
        title={sessionsError ?? undefined}
        disabled={busy}
        className={cx(
          "h-8 max-w-[7rem] shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:max-w-[9rem]",
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
        title={sessions.find((s) => s.opencodeSessionId === (localSelection ?? currentSessionId))?.favorite ? "お気に入りから外す" : "お気に入りに追加"}
        aria-label={sessions.find((s) => s.opencodeSessionId === (localSelection ?? currentSessionId))?.favorite ? "お気に入りから外す" : "お気に入りに追加"}
        busy={favoriteBusy}
        disabled={favoriteBusy}
        onClick={() => void toggleFavorite()}
      >
        <Star className={cx("h-3.5 w-3.5", sessions.find((s) => s.opencodeSessionId === (localSelection ?? currentSessionId))?.favorite && "fill-current text-primary")} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={createError ?? switchError ?? "新セッション"}
        aria-label={
          createError
            ? `セッション追加失敗: ${createError}`
            : switchError
              ? `セッション切替失敗: ${switchError}`
              : "新セッション"
        }
        busy={busy}
        onClick={() => void create()}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      {switchError && (
        <span
          role="status"
          aria-live="polite"
          className="max-w-40 truncate text-[11px] text-danger"
          title={switchError}
        >
          セッション切替に失敗しました
        </span>
      )}
    </div>
  );
}
