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
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<{
        sessions?: { opencodeSessionId: string; title: string; updatedAt: string }[];
      }>(`/api/workspaces/${workspaceId}/sessions`);
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh, currentSessionId]);

  const create = async () => {
    setBusy(true);
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
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  if (sessions.length <= 1) {
    return (
      <Button
        variant="ghost"
        size="sm"
        title="セッションを追加"
        busy={busy}
        onClick={() => void create()}
      >
        <Plus className="h-3.5 w-3.5" />
        <Layers className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={currentSessionId ?? ""}
        onChange={async (e) => {
          const id = e.target.value;
          if (!id || id === currentSessionId) return;
          setBusy(true);
          try {
            // Re-bind as latest by posting same session (updated_at bump)
            const title =
              sessions.find((s) => s.opencodeSessionId === id)?.title ?? "Session";
            await sendJson("POST", `/api/workspaces/${workspaceId}/sessions`, {
              opencodeSessionId: id,
              title,
            });
            onSwitch();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className={cx(
          "h-8 max-w-[9rem] cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-xs outline-none",
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
        title="新セッション"
        busy={busy}
        onClick={() => void create()}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
