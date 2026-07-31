"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Plus, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { apiUrl } from "@/lib/client";
import "@xterm/xterm/css/xterm.css";

interface PtyInfo {
  id: string;
  title: string;
  cwd: string;
  status: "running" | "exited";
}

/** SSE reconnect backoff: 0.5s, 1s, 2s, 4s, 8s, then give up. */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 5;

/**
 * Backoff delay (ms) for the `attempt`-th reconnect (0-based), or `null` once
 * the retry budget is exhausted. Exported for unit testing.
 */
export function ptyReconnectDelayMs(attempt: number): number | null {
  if (attempt >= RECONNECT_MAX_ATTEMPTS) return null;
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
}

/**
 * Interactive terminal panel backed by the host-only PTY BFF routes.
 *
 * Output flows Engine WebSocket → BFF SSE (`/api/pty-session/stream?id=`);
 * input flows browser POST (`/api/pty-session/input?id=`), and terminal
 * resizes flow to `POST /api/pty-session/resize?id=`. The Engine's
 * connect ticket never reaches the browser — the BFF holds the only
 * WebSocket to the Engine.
 */
export function PtyPanel({ directory }: { directory: string }) {
  const [sessions, setSessions] = useState<PtyInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  /** Refresh the PTY session list from the BFF. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        apiUrl("/api/pty-session", { directory }),
        { cache: "no-store" },
      );
      const data = (await res.json()) as { sessions?: PtyInfo[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `list failed: ${res.status}`);
      }
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "PTY セッション一覧を取得できません",
      );
    }
  }, [directory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Read a CSS variable at runtime so xterm's theme matches the app theme. */
  const cssVar = useCallback((name: string, fallback: string): string => {
    if (typeof window === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || fallback;
  }, []);

  /** Attach a new xterm instance to the container. */
  const mountTerminal = useCallback(() => {
    if (!containerRef.current) return;
    // Dispose any prior instance before mounting a fresh one.
    termRef.current?.dispose();
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      allowProposedApi: true,
      theme: {
        background: cssVar("--surface", "#ffffff"),
        foreground: cssVar("--text", "#18181b"),
        cursor: cssVar("--muted", "#71717a"),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    // Fit on the next frame: right after `open()` the container may still be
    // mid-layout (0x0), and fitting then locks the terminal to a 1-column
    // grid that never recovers, which renders as a blank panel.
    requestAnimationFrame(() => {
      try {
        fit.fit();
        term.focus();
      } catch {
        /* container detached before the frame ran */
      }
    });
  }, [cssVar]);

  /** Create a new PTY and switch to it. */
  const createSession = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/api/pty-session", { directory }), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      });
      const created = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(created.error ?? `create failed: ${res.status}`);
      await refresh();
      if (created.id) {
        setActiveId(created.id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "PTY セッションを作成できません",
      );
    } finally {
      setCreating(false);
    }
  }, [directory, refresh]);

  /** Switch to an existing session. */
  const openSession = useCallback((ptyId: string) => {
    setActiveId(ptyId);
  }, []);

  /** Wire the terminal + SSE stream whenever `activeId` becomes non-null. */
  useEffect(() => {
    if (!activeId) return;

    mountTerminal();
    const term = termRef.current;
    if (!term) return;

    // SSE stream with reconnect backoff. A transient network drop (or a BFF
    // restart) ends the stream without a sentinel, so we reopen with
    // exponential backoff. A real PTY exit sends `{t:"exit"}`, which sets
    // `terminated` and stops the backoff.
    let disposed = false;
    let terminated = false;
    let retries = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const connect = () => {
      if (disposed || terminated) return;
      const source = new EventSource(
        apiUrl("/api/pty-session/stream", { id: activeId, directory }),
      );
      es = source;
      sseRef.current = source;

      source.onopen = () => {
        retries = 0;
      };
      source.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data) as { t?: string; d?: string };
          if (payload?.t === "o" && typeof payload.d === "string") {
            term.write(payload.d);
          } else if (payload?.t === "exit") {
            terminated = true;
            source.close();
            void refresh();
          }
        } catch {
          // Non-JSON frame; ignore.
        }
      };
      source.onerror = () => {
        source.close();
        if (disposed || terminated) return;
        const delay = ptyReconnectDelayMs(retries);
        if (delay === null) {
          setError("ターミナル接続が切断されました。セッションを開き直してください。");
          return;
        }
        retries += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };
    connect();

    const disposable = term.onData((data: string) => {
      void fetch(
        apiUrl("/api/pty-session/input", { id: activeId, directory }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data }),
          keepalive: true,
        },
      ).catch(() => {
        /* swallow input errors; the stream will surface disconnects */
      });
    });

    // Sync the terminal size to the Engine PTY so vim/htop layouts match.
    // fit() fires onResize on the initial measurement, covering the first
    // sync; container ResizeObserver-driven fits cover subsequent changes.
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (!activeId) return;
      void fetch(
        apiUrl("/api/pty-session/resize", { id: activeId, directory }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rows, cols }),
          keepalive: true,
        },
      ).catch(() => {
        /* best effort; resize failures don't surface to the user */
      });
    });

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      disposable.dispose();
      resizeDisposable.dispose();
    };
  }, [activeId, directory, mountTerminal, refresh]);

  /** Close a PTY session (BFF → Engine DELETE). */
  const closeSession = useCallback(
    async (ptyId: string) => {
      try {
        await fetch(
          apiUrl("/api/pty-session", { id: ptyId, directory }),
          { method: "DELETE" },
        );
      } catch {
        /* best effort */
      }
      if (activeId === ptyId) {
        sseRef.current?.close();
        termRef.current?.dispose();
        termRef.current = null;
        setActiveId(null);
      }
      await refresh();
    },
    [activeId, directory, refresh],
  );

  /** Re-fit the terminal when the container resizes. */
  useEffect(() => {
    if (!activeId || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeId]);

  /** Cleanup on unmount. */
  useEffect(() => {
    return () => {
      sseRef.current?.close();
      termRef.current?.dispose();
    };
  }, []);

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col border-border bg-surface p-3 lg:border-l">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
        <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">ターミナル</span>
        <button
          type="button"
          onClick={() => void createSession()}
          disabled={creating}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted transition hover:bg-surface-3 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          新規
        </button>
      </div>

      {error && (
        <p className="min-w-0 break-words text-xs text-faint">{error}</p>
      )}

      {sessions.length > 0 && (
        <div className="mb-2 flex min-w-0 flex-wrap gap-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSession(s.id)}
              className={`group inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] transition ${
                activeId === s.id
                  ? "bg-surface-3 text-muted"
                  : "bg-surface-2 text-faint hover:bg-surface-3"
              }`}
            >
              <span className="max-w-[8rem] truncate">{s.title || s.id}</span>
              <X
                className="h-3 w-3 opacity-0 transition group-hover:opacity-100"
                data-testid={`close-pty-${s.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSession(s.id);
                }}
              />
            </button>
          ))}
        </div>
      )}

      {activeId ? (
        <div
          ref={containerRef}
          data-testid="pty-terminal"
          className="min-h-[8rem] w-full min-w-0 flex-1 overflow-hidden rounded-md bg-surface"
        />
      ) : (
        !error &&
        sessions.length === 0 && (
          <p className="min-w-0 break-words text-xs text-faint">
            稼働中の PTY はありません。「新規」でターミナルを開始できます。
          </p>
        )
      )}
    </div>
  );
}
