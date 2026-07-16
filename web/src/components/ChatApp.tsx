"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Health = {
  webui: { ok: boolean };
  opencode: { ok: boolean; version?: string; error?: string };
};

type Session = {
  id: string;
  title?: string;
  time?: { updated?: number };
};

type PermissionRequest = {
  id: string;
  sessionID?: string;
  /** v1 permission name or v2 action */
  permission?: string;
  patterns?: string[];
  metadata?: unknown;
  version: "v1" | "v2";
};

type TimelineItem = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

function apiUrl(path: string, directory?: string) {
  const u = new URL(path, window.location.origin);
  if (directory) u.searchParams.set("directory", directory);
  return u.toString();
}

async function ocFetch(
  path: string,
  directory: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-opencode-directory", directory);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(apiUrl(`/api/opencode${path}`, directory), {
    ...init,
    headers,
    cache: "no-store",
  });
}

export function ChatApp({
  initialDirectory = "",
  workspaceLabel,
  onBack,
}: {
  initialDirectory?: string;
  workspaceLabel?: string;
  onBack?: () => void;
}) {
  const [directory, setDirectory] = useState(initialDirectory);
  const [roots, setRoots] = useState<string[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [sseState, setSseState] = useState<"idle" | "live" | "reconnect" | "down">(
    "idle",
  );
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const engineOk = health?.opencode.ok ?? false;

  useEffect(() => {
    if (initialDirectory) setDirectory(initialDirectory);
  }, [initialDirectory]);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setHealth(await res.json());
    } catch {
      setHealth({
        webui: { ok: true },
        opencode: { ok: false, error: "health check failed" },
      });
    }
  }, []);

  const refreshRoots = useCallback(async () => {
    const res = await fetch("/api/roots", { cache: "no-store" });
    const data = (await res.json()) as { roots: string[] };
    setRoots(data.roots ?? []);
    if (!directory && data.roots?.[0]) setDirectory(data.roots[0]);
  }, [directory]);

  const refreshSessions = useCallback(async () => {
    if (!directory) return;
    const res = await ocFetch("/session", directory);
    if (!res.ok) {
      setError(`session list failed: ${res.status}`);
      return;
    }
    const data = (await res.json()) as Session[];
    setSessions(Array.isArray(data) ? data : []);
  }, [directory]);

  const loadMessages = useCallback(
    async (id: string) => {
      if (!directory) return;
      const res = await ocFetch(`/session/${id}/message`, directory);
      if (!res.ok) return;
      const data = (await res.json()) as {
        info?: { id?: string; role?: string };
        parts?: { type?: string; text?: string }[];
      }[];
      const items: TimelineItem[] = [];
      for (const row of data ?? []) {
        const role =
          row.info?.role === "user"
            ? "user"
            : row.info?.role === "assistant"
              ? "assistant"
              : "system";
        const text = (row.parts ?? [])
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
          .join("\n");
        if (text) {
          items.push({ id: row.info?.id ?? crypto.randomUUID(), role, text });
        }
      }
      setTimeline(items);
    },
    [directory],
  );

  useEffect(() => {
    void refreshHealth();
    void refreshRoots();
    const t = setInterval(() => void refreshHealth(), 5000);
    return () => clearInterval(t);
  }, [refreshHealth, refreshRoots]);

  useEffect(() => {
    if (directory) void refreshSessions();
  }, [directory, refreshSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline, permission]);

  // SSE subscription
  useEffect(() => {
    if (!directory || !engineOk) {
      esRef.current?.close();
      esRef.current = null;
      setSseState(engineOk ? "idle" : "down");
      return;
    }

    let cancelled = false;
    let retryMs = 1000;

    const connect = () => {
      if (cancelled) return;
      esRef.current?.close();
      const url = apiUrl("/api/opencode/event", directory);
      const es = new EventSource(url);
      esRef.current = es;
      setSseState("reconnect");

      es.onopen = () => {
        retryMs = 1000;
        setSseState("live");
      };

      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data) as {
            type?: string;
            properties?: Record<string, unknown>;
            data?: Record<string, unknown>;
          };
          const type = payload.type ?? "";
          // OpenAPI: Event* uses `properties`; some V2Event* use `data`
          const props = (payload.properties ?? payload.data ?? {}) as Record<
            string,
            unknown
          >;

          if (type === "permission.asked") {
            const id = String(props.id ?? "");
            if (id) {
              setPermission({
                id,
                version: "v1",
                sessionID: props.sessionID as string | undefined,
                permission: props.permission as string | undefined,
                patterns: props.patterns as string[] | undefined,
                metadata: props.metadata,
              });
            }
          }

          if (type === "permission.v2.asked") {
            const id = String(props.id ?? "");
            if (id) {
              setPermission({
                id,
                version: "v2",
                sessionID: props.sessionID as string | undefined,
                permission: props.action as string | undefined,
                patterns: props.resources as string[] | undefined,
                metadata: props.metadata,
              });
            }
          }

          if (type === "permission.replied" || type === "permission.v2.replied") {
            const repliedId = String(props.requestID ?? props.id ?? "");
            setPermission((cur) =>
              cur && (!repliedId || cur.id === repliedId) ? null : cur,
            );
          }

          if (
            type.startsWith("message.") ||
            type.startsWith("session.") ||
            type.includes("message.part") ||
            type.includes("session.next")
          ) {
            if (sessionId) void loadMessages(sessionId);
            void refreshSessions();
          }
        } catch {
          /* ignore non-json */
        }
      };

      es.onerror = () => {
        setSseState("reconnect");
        es.close();
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
      };
    };

    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [directory, engineOk, sessionId, loadMessages, refreshSessions]);

  const addRoot = async () => {
    setError(null);
    const res = await fetch("/api/roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: directory }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `add root failed: ${res.status}`);
      return;
    }
    await refreshRoots();
  };

  const createSession = async () => {
    if (!directory) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ocFetch("/session", directory, {
        method: "POST",
        body: JSON.stringify({ title: "WebUI session" }),
      });
      if (!res.ok) {
        setError(`create session failed: ${res.status}`);
        return;
      }
      const sess = (await res.json()) as Session;
      setSessionId(sess.id);
      setTimeline([]);
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const selectSession = async (id: string) => {
    setSessionId(id);
    await loadMessages(id);
  };

  const sendPrompt = async (e: FormEvent) => {
    e.preventDefault();
    if (!directory || !sessionId || !input.trim() || !engineOk) return;
    setBusy(true);
    setError(null);
    const text = input.trim();
    setInput("");
    setTimeline((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
    ]);
    try {
      const res = await ocFetch(`/session/${sessionId}/prompt_async`, directory, {
        method: "POST",
        body: JSON.stringify({
          parts: [{ type: "text", text }],
        }),
      });
      if (!res.ok && res.status !== 204) {
        setError(`prompt failed: ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const replyPermission = async (reply: "once" | "always" | "reject") => {
    if (!permission || !directory) return;
    const path =
      permission.version === "v2" && permission.sessionID
        ? `/api/session/${permission.sessionID}/permission/${permission.id}/reply`
        : `/permission/${permission.id}/reply`;
    const res = await ocFetch(path, directory, {
      method: "POST",
      body: JSON.stringify({ reply }),
    });
    if (!res.ok) {
      setError(`permission reply failed: ${res.status}`);
      return;
    }
    setPermission(null);
  };

  const statusLabel = useMemo(() => {
    if (!engineOk) return "エンジン停止";
    if (sseState === "live") return "接続中";
    if (sseState === "reconnect") return "再接続中…";
    return "待機";
  }, [engineOk, sseState]);

  return (
    <div className="flex min-h-dvh flex-col bg-[#0f1419] text-[#e7ecf1]">
      {!engineOk && (
        <div className="bg-amber-700/90 px-4 py-3 text-sm text-white">
          OpenCode エンジンが応答していません。トレイから再起動するか、
          <code className="mx-1 rounded bg-black/30 px-1">opencode serve</code>
          を確認してください。
          {health?.opencode.error ? ` (${health.opencode.error})` : null}
        </div>
      )}

      <header className="border-b border-white/10 px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="min-h-10 rounded-md bg-white/10 px-3 text-sm hover:bg-white/15"
                >
                  Launcher
                </button>
              )}
              <h1 className="text-xl font-semibold tracking-tight">OpenCode WebUI</h1>
            </div>
            <p className="text-sm text-white/55">
              {workspaceLabel ? `${workspaceLabel} · ` : ""}
              Phase 0–1 · {statusLabel}
              {health?.opencode.version ? ` · OC ${health.opencode.version}` : ""}
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-2 sm:max-w-xl">
            <label className="text-xs text-white/50">Directory</label>
            <div className="flex gap-2">
              <input
                className="min-h-11 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-sm outline-none focus:border-sky-500"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder="C:\\path\\to\\project"
              />
              <button
                type="button"
                onClick={() => void addRoot()}
                className="min-h-11 shrink-0 rounded-md bg-white/10 px-3 text-sm hover:bg-white/15"
              >
                Allow
              </button>
            </div>
            {roots.length > 0 && (
              <p className="truncate text-xs text-white/40">
                Allowed: {roots.join(" · ")}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-0 md:grid-cols-[220px_1fr]">
        <aside className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-white/45">
              Sessions
            </span>
            <button
              type="button"
              disabled={!directory || !engineOk || busy}
              onClick={() => void createSession()}
              className="min-h-10 rounded-md bg-sky-600 px-3 text-sm font-medium disabled:opacity-40"
            >
              New
            </button>
          </div>
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void selectSession(s.id)}
                  className={`min-h-11 w-full rounded-md px-3 text-left text-sm ${
                    sessionId === s.id
                      ? "bg-sky-600/30 text-white"
                      : "bg-white/5 text-white/80 hover:bg-white/10"
                  }`}
                >
                  {s.title || s.id.slice(0, 8)}
                </button>
              </li>
            ))}
            {sessions.length === 0 && (
              <li className="px-2 py-6 text-sm text-white/35">No sessions</li>
            )}
          </ul>
        </aside>

        <main className="flex min-h-[50dvh] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {timeline.map((item) => (
              <div
                key={item.id}
                className={`max-w-[95%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  item.role === "user"
                    ? "ml-auto bg-sky-700/40"
                    : item.role === "assistant"
                      ? "bg-white/8"
                      : "bg-white/5 text-white/60"
                }`}
              >
                {item.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {permission && (
            <div className="border-t border-amber-500/40 bg-amber-950/50 px-4 py-4">
              <p className="mb-2 text-sm font-medium text-amber-100">権限の承認が必要です</p>
              <p className="mb-3 text-sm text-amber-100/80">
                {permission.permission ?? "permission"}
                {permission.patterns?.length
                  ? ` · ${permission.patterns.join(", ")}`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-medium"
                  onClick={() => void replyPermission("once")}
                >
                  一度だけ許可
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-emerald-800 px-4 text-sm font-medium"
                  onClick={() => void replyPermission("always")}
                >
                  常に許可
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-white/10 px-4 text-sm"
                  onClick={() => void replyPermission("reject")}
                >
                  拒否
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="border-t border-red-500/30 bg-red-950/40 px-4 py-2 text-sm text-red-100">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => void sendPrompt(e)}
            className="flex gap-2 border-t border-white/10 p-3"
          >
            <input
              className="min-h-12 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-base outline-none focus:border-sky-500"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={sessionId ? "メッセージ…" : "先にセッションを作成"}
              disabled={!sessionId || !engineOk || busy}
            />
            <button
              type="submit"
              disabled={!sessionId || !engineOk || busy || !input.trim()}
              className="min-h-12 min-w-20 rounded-md bg-sky-600 px-4 text-sm font-semibold disabled:opacity-40"
            >
              送信
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
