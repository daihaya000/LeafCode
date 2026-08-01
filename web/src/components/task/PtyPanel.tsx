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
  const [refreshing, setRefreshing] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  /** True while the SSE stream is attempting to reconnect after a drop. */
  const [reconnecting, setReconnecting] = useState(false);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const refreshRequestRef = useRef(0);
  const workspaceGenerationRef = useRef(0);
  const creatingRef = useRef(false);
  const closingRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  /** Refresh the PTY session list from the BFF. */
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    const requestId = ++refreshRequestRef.current;
    setRefreshing(true);
    try {
      const res = await fetch(
        apiUrl("/api/pty-session", { directory }),
        { cache: "no-store" },
      );
      const data = (await res.json()) as { sessions?: PtyInfo[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `list failed: ${res.status}`);
      }
      if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "PTY セッション一覧を取得できません",
      );
    } finally {
      if (mountedRef.current && requestId === refreshRequestRef.current) {
        setRefreshing(false);
      }
    }
  }, [directory]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      sseRef.current?.close();
      termRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // PTY ids are scoped to a project directory. Never reconnect an old
  // terminal against the newly selected directory.
  useEffect(() => {
    setActiveId(null);
    workspaceGenerationRef.current += 1;
    sseRef.current?.close();
    termRef.current?.dispose();
    termRef.current = null;
  }, [directory]);

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
      // Terminal convention: a black canvas + white ink regardless of the app
      // theme. DESIGN.md has no terminal-specific dark token, and reading the
      // theme variables at runtime would yield a white background in light
      // mode — so this is an intentional fixed palette. ANSI colour output
      // (vim/htop/ls --color) still reads correctly against pure black.
      theme: {
        background: "#000000",
        foreground: "#ffffff",
        cursor: "#ffffff",
        selectionBackground: "rgba(255,255,255,0.25)",
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
  }, []);

  /** Create a new PTY and switch to it. */
  const createSession = useCallback(async () => {
    if (creatingRef.current) return;
    const generation = workspaceGenerationRef.current;
    creatingRef.current = true;
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/api/pty-session", { directory }), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      });
      const created = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(created.error ?? `create failed: ${res.status}`);
      if (!mountedRef.current || generation !== workspaceGenerationRef.current) return;
      await refresh();
      if (
        mountedRef.current &&
        generation === workspaceGenerationRef.current &&
        created.id
      ) {
        setActiveId(created.id);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "PTY セッションを作成できません",
      );
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) setCreating(false);
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
        if (disposed) return;
        retries = 0;
        setReconnecting(false);
      };
      source.onmessage = (ev) => {
        if (disposed) return;
        try {
          const payload = JSON.parse(ev.data) as { t?: string; d?: string };
          if (payload?.t === "o" && typeof payload.d === "string") {
            term.write(payload.d);
          } else if (payload?.t === "exit") {
            terminated = true;
            source.close();
            if (mountedRef.current) setActiveId(null);
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
          setReconnecting(false);
          return;
        }
        retries += 1;
        setReconnecting(true);
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
      if (mountedRef.current) setReconnecting(false);
    };
  }, [activeId, directory, mountTerminal, refresh]);

  /** Close a PTY session (BFF → Engine DELETE). */
  const closeSession = useCallback(
    async (ptyId: string) => {
      if (closingRef.current) return;
      const generation = workspaceGenerationRef.current;
      closingRef.current = ptyId;
      setClosingId(ptyId);
      try {
        const res = await fetch(
          apiUrl("/api/pty-session", { id: ptyId, directory }),
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `close failed: ${res.status}`);
        if (
          mountedRef.current &&
          generation === workspaceGenerationRef.current &&
          activeId === ptyId
        ) {
          sseRef.current?.close();
          termRef.current?.dispose();
          termRef.current = null;
          setActiveId(null);
        }
        if (generation === workspaceGenerationRef.current) await refresh();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "PTY 繧ｻ繝・す繝ｧ繝ｳ縺ｮ邨ｭ豁ｳ縺ｫ螟ｱ謨励＠縺ｾ縺励◆",
        );
      } finally {
        if (closingRef.current === ptyId) {
          closingRef.current = null;
          if (mountedRef.current) setClosingId(null);
        }
      }
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
        <p role="alert" className="min-w-0 break-words text-xs text-danger">{error}</p>
      )}

      {refreshing && (
        <p role="status" aria-live="polite" aria-busy="true" className="min-w-0 text-xs text-faint">
          PTY 繧ｻ繝・す繝ｧ繝ｳ繧呈､懈ｴ九＠縺ｾ縺励◆…
        </p>
      )}

      {sessions.length > 0 && (
        <div className="mb-2 flex min-w-0 flex-wrap gap-1">
          {sessions.map((s) => (
            <div key={s.id} className="group inline-flex items-center rounded-md bg-surface-2 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => openSession(s.id)}
                aria-pressed={activeId === s.id}
                className={`inline-flex min-w-0 items-center rounded-l-md px-2 py-1 transition ${
                  activeId === s.id
                    ? "bg-surface-3 text-muted"
                    : "text-faint hover:bg-surface-3"
                }`}
              >
                <span className="max-w-[8rem] truncate">{s.title || s.id}</span>
              </button>
              <button
                type="button"
                aria-label={`${s.title || s.id} 繧ｻ繝�す繝ｧ繝ｳ繧堤ｵｭ豁ｳ`}
                data-testid={`close-pty-${s.id}`}
                disabled={closingId !== null}
                onClick={() => void closeSession(s.id)}
                className="inline-flex min-h-[28px] min-w-[32px] items-center justify-center rounded-r-md text-faint transition hover:bg-surface-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {activeId ? (
        <div className="relative min-h-[8rem] w-full min-w-0 flex-1">
          <div
            ref={containerRef}
            data-testid="pty-terminal"
            className="h-full w-full overflow-hidden rounded-md bg-black"
          />
          {reconnecting && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60">
              <span className="animate-pulse text-xs text-white/80">
                再接続中…
              </span>
            </div>
          )}
        </div>
      ) : (
        !error &&
        !refreshing &&
        sessions.length === 0 && (
          <p className="min-w-0 break-words text-xs text-faint">
            稼働中の PTY はありません。「新規」でターミナルを開始できます。
          </p>
        )
      )}
    </div>
  );
}
