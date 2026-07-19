"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Bot, Loader2 } from "lucide-react";
import { cx } from "@/components/ui";
import { ocJson } from "@/lib/client";
import {
  DEFAULT_COST_PREFS,
  type CostDisplayPrefs,
} from "@/lib/currency";
import { MessageMetaHeader } from "./MessageMetaHeader";
import {
  collectTaskCallIds,
  extractSessionIdFromMetadata,
  isTimelinePartType,
  matchChildSession,
  messageHasTimelineParts,
  type TaskMatchHint,
} from "@/lib/match-child-session";
import {
  NESTED_POLL_TIMEOUT_MS,
  shouldPollWhileVisible,
} from "@/lib/sse-health";
import type { MessageWithParts } from "@/lib/types";
import { PartView } from "./PartView";

type ChildSession = {
  id: string;
  title?: string;
  parentID?: string;
};

type MatchedFeed = {
  session: ChildSession;
  status: string;
  messages: MessageWithParts[];
  runningTool: string | null;
};

const POLL_MS = 2000;

function runningToolFromMessages(
  messages: MessageWithParts[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j];
      if (p?.type !== "tool") continue;
      const st = p.state?.status;
      if (st === "running" || st === "pending") {
        return p.state?.title ?? p.tool ?? "tool";
      }
    }
  }
  return null;
}

async function fetchChildren(
  directory: string,
  sessionId: string,
): Promise<ChildSession[]> {
  try {
    const rows = await ocJson<ChildSession[] | { data?: ChildSession[] }>(
      `/session/${sessionId}/children`,
      directory,
      { timeoutMs: NESTED_POLL_TIMEOUT_MS },
    );
    const list = Array.isArray(rows)
      ? rows
      : Array.isArray(rows?.data)
        ? rows.data
        : [];
    return list.filter((c) => Boolean(c?.id));
  } catch {
    return [];
  }
}

/** Live nested sub-agent progress with Build-equivalent PartView timeline. */
export function NestedAgentPanel({
  directory,
  parentSessionId,
  active,
  matchHint,
  modelLabels = {},
  costPrefs = DEFAULT_COST_PREFS,
}: {
  directory: string;
  parentSessionId: string;
  /** Poll while true (running task, or completed detail open). */
  active: boolean;
  matchHint: TaskMatchHint;
  modelLabels?: Readonly<Record<string, string>>;
  costPrefs?: CostDisplayPrefs;
}) {
  const [feed, setFeed] = useState<MatchedFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(true);
  const stickyIdRef = useRef<string | null>(null);
  const genRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickBottomRef = useRef(true);

  const hintCallID = matchHint.callID;
  const hintSessionMeta = extractSessionIdFromMetadata(matchHint.metadata ?? null);
  const hintDescription =
    typeof matchHint.input?.description === "string"
      ? matchHint.input.description
      : typeof matchHint.input?.prompt === "string"
        ? matchHint.input.prompt.slice(0, 120)
        : null;
  const hintSiblingsKey = matchHint.siblingTaskCallIds.join("\0");

  const refresh = useCallback(async () => {
    if (!directory || !parentSessionId) return;
    const gen = ++genRef.current;
    const hint: TaskMatchHint = {
      callID: hintCallID,
      metadata: hintSessionMeta ? { sessionID: hintSessionMeta } : null,
      input: hintDescription
        ? { description: hintDescription, prompt: hintDescription }
        : null,
      siblingTaskCallIds: hintSiblingsKey ? hintSiblingsKey.split("\0") : [],
    };
    try {
      let statuses: Record<string, { type?: string }> = {};
      try {
        statuses = await ocJson<Record<string, { type?: string }>>(
          "/session/status",
          directory,
          { timeoutMs: NESTED_POLL_TIMEOUT_MS },
        );
      } catch {
        /* status unavailable */
      }

      const children = await fetchChildren(directory, parentSessionId);
      if (gen !== genRef.current) return;

      const matchedId = matchChildSession(
        children,
        hint,
        stickyIdRef.current,
      );
      if (!matchedId) {
        stickyIdRef.current = null;
        setFeed(null);
        setMatching(true);
        setError(null);
        return;
      }

      stickyIdRef.current = matchedId;
      const session =
        children.find((c) => c.id === matchedId) ??
        ({ id: matchedId } as ChildSession);

      let messages: MessageWithParts[] = [];
      try {
        const rows = await ocJson<MessageWithParts[]>(
          `/session/${matchedId}/message`,
          directory,
          { timeoutMs: NESTED_POLL_TIMEOUT_MS },
        );
        messages = Array.isArray(rows) ? rows : [];
      } catch {
        /* keep empty; show error below if first load */
      }
      if (gen !== genRef.current) return;

      setFeed({
        session,
        status: statuses[matchedId]?.type ?? "idle",
        messages,
        runningTool: runningToolFromMessages(messages),
      });
      setMatching(false);
      setError(null);
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : "子セッション取得失敗");
    }
  }, [
    directory,
    parentSessionId,
    hintCallID,
    hintSessionMeta,
    hintDescription,
    hintSiblingsKey,
  ]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const t = setInterval(() => {
      if (!shouldPollWhileVisible(document.visibilityState)) return;
      void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (shouldPollWhileVisible(document.visibilityState)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      genRef.current += 1;
    };
  }, [active, refresh]);

  useEffect(() => {
    if (!active) {
      // Keep last feed for completed collapsed→expand, but stop matching spinner.
      setMatching(false);
    }
  }, [active]);

  const busy =
    feed?.status === "busy" ||
    feed?.status === "retry" ||
    Boolean(feed?.runningTool);

  const siblingTaskCallIds = useMemo(
    () => collectTaskCallIds(feed?.messages ?? []),
    [feed?.messages],
  );

  const timeline = useMemo(() => {
    const messages = feed?.messages ?? [];
    return messages.filter((m) => messageHasTimelineParts(m.parts ?? []));
  }, [feed?.messages]);

  useEffect(() => {
    if (!busy || !stickBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline, busy, feed?.runningTool]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stickBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  if (!active && !feed) return null;

  if (matching && !feed) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-faint">
        <Loader2 className="h-3 w-3 animate-spin" />
        子セッションを特定中…
      </div>
    );
  }

  if (!feed) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-faint">
        <Loader2 className="h-3 w-3 animate-spin" />
        サブエージェント起動を待機中…
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-working" />
        ) : (
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
          {feed.session.title || feed.session.id.slice(0, 12)}
        </span>
        {feed.runningTool && (
          <span className="hidden max-w-[10rem] truncate text-[10px] text-working sm:inline">
            {feed.runningTool}
          </span>
        )}
      </div>
      {error && (
        <p className="px-3 pb-1 text-[11px] text-danger">{error}</p>
      )}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={cx(
          "max-h-72 space-y-3 overflow-y-auto border-t border-border px-3 py-3",
        )}
      >
        {timeline.length === 0 && (
          <p className="text-[11px] text-faint">
            {busy ? "作業を開始しています…" : "タイムラインはまだありません"}
          </p>
        )}
        {timeline.map((m) => (
          <div key={m.info.id} className="flex flex-col gap-2">
            <MessageMetaHeader
              info={m.info}
              modelLabel={
                m.info.providerID && m.info.modelID
                  ? modelLabels[`${m.info.providerID}::${m.info.modelID}`]
                  : undefined
              }
              costPrefs={costPrefs}
              compact
            />
            {(m.parts ?? [])
              .filter((p) => {
                if (!isTimelinePartType(p.type)) return false;
                if (p.type === "text") return Boolean(p.text?.trim());
                return true;
              })
              .map((p) => (
                <PartView
                  key={p.id}
                  part={p}
                  role={m.info.role}
                  directory={directory}
                  rootSessionId={feed.session.id}
                  siblingTaskCallIds={siblingTaskCallIds}
                />
              ))}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-faint">
            <Loader2 className="h-3 w-3 animate-spin" />
            作業中…
          </div>
        )}
      </div>
    </div>
  );
}
