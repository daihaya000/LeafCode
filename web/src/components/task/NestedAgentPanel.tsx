"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ChevronRight, Loader2 } from "lucide-react";
import { cx } from "@/components/ui";
import { ocJson } from "@/lib/client";
import type { MessageWithParts, Part } from "@/lib/types";

type ChildSession = {
  id: string;
  title?: string;
  parentID?: string;
};

type ChildFeed = {
  session: ChildSession;
  status: string;
  latest: string;
  runningTool: string | null;
  children: ChildFeed[];
};

const MAX_DEPTH = 3;
const POLL_MS = 2000;

function summarizeParts(parts: Part[]): { latest: string; runningTool: string | null } {
  let latest = "";
  let runningTool: string | null = null;
  for (const p of parts) {
    if (p.type === "text" && p.text?.trim()) {
      latest = p.text.trim().replace(/\s+/g, " ").slice(0, 120);
    }
    if (p.type === "tool") {
      const tool = p.tool ?? "tool";
      const title = p.state?.title ?? tool;
      if (p.state?.status === "running" || p.state?.status === "pending") {
        runningTool = title;
        latest = title;
      } else if (p.state?.status === "completed" && !runningTool) {
        latest = title;
      }
    }
  }
  return { latest, runningTool };
}

async function loadChildTree(
  directory: string,
  sessionId: string,
  depth: number,
): Promise<ChildFeed[]> {
  if (depth > MAX_DEPTH) return [];
  let children: ChildSession[] = [];
  try {
    const rows = await ocJson<ChildSession[] | { data?: ChildSession[] }>(
      `/session/${sessionId}/children`,
      directory,
    );
    children = Array.isArray(rows)
      ? rows
      : Array.isArray(rows?.data)
        ? rows.data
        : [];
  } catch {
    return [];
  }

  const feeds: ChildFeed[] = [];
  for (const child of children) {
    if (!child?.id) continue;
    let latest = "";
    let runningTool: string | null = null;
    let status = "unknown";
    try {
      const messages = await ocJson<MessageWithParts[]>(
        `/session/${child.id}/message`,
        directory,
      );
      const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
      if (last) {
        const s = summarizeParts(last.parts ?? []);
        latest = s.latest;
        runningTool = s.runningTool;
      }
      const statuses = await ocJson<Record<string, { type?: string }>>(
        "/session/status",
        directory,
      );
      status = statuses[child.id]?.type ?? "idle";
    } catch {
      /* keep empty */
    }
    const nested =
      status === "busy" || runningTool
        ? await loadChildTree(directory, child.id, depth + 1)
        : await loadChildTree(directory, child.id, depth + 1).catch(() => []);
    feeds.push({
      session: child,
      status,
      latest,
      runningTool,
      children: nested,
    });
  }
  return feeds;
}

function ChildNode({ feed, depth }: { feed: ChildFeed; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const busy = feed.status === "busy" || Boolean(feed.runningTool);
  return (
    <div className={cx(depth > 0 && "ml-2 border-l border-border pl-2 sm:ml-3")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-working" />
        ) : (
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
          {feed.session.title || feed.session.id.slice(0, 12)}
        </span>
        {feed.runningTool && (
          <span className="hidden max-w-[8rem] truncate text-[10px] text-working sm:inline">
            {feed.runningTool}
          </span>
        )}
        <ChevronRight
          className={cx(
            "h-3 w-3 shrink-0 text-faint transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="space-y-1 pb-1">
          {feed.latest && (
            <p className="px-2 text-[11px] text-muted">{feed.latest}</p>
          )}
          {feed.children.map((c) => (
            <ChildNode key={c.session.id} feed={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Live nested sub-agent / grandchild progress under a running task tool. */
export function NestedAgentPanel({
  directory,
  parentSessionId,
  active,
}: {
  directory: string;
  parentSessionId: string;
  active: boolean;
}) {
  const [feeds, setFeeds] = useState<ChildFeed[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!directory || !parentSessionId) return;
    try {
      const tree = await loadChildTree(directory, parentSessionId, 1);
      setFeeds(tree);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "子セッション取得失敗");
    }
  }, [directory, parentSessionId]);

  useEffect(() => {
    if (!active) {
      setFeeds([]);
      return;
    }
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  if (!active && feeds.length === 0) return null;
  if (feeds.length === 0 && !error) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-faint">
        <Loader2 className="h-3 w-3 animate-spin" />
        サブエージェント起動を待機中…
      </div>
    );
  }

  return (
    <div className="space-y-1 border-t border-border bg-surface px-2 py-2">
      <p className="px-1 text-[10px] font-medium tracking-wide text-faint uppercase">
        サブエージェント
      </p>
      {error && <p className="px-1 text-[11px] text-danger">{error}</p>}
      {feeds.map((f) => (
        <ChildNode key={f.session.id} feed={f} depth={0} />
      ))}
    </div>
  );
}
