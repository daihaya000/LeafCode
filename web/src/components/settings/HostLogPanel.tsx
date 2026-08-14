"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { copyText } from "@/lib/clipboard";
import { timedFetch } from "@/lib/client";

type LogSource = "host" | "opencode" | "webui" | "web-build" | "caddy";
type LogLevel = "log" | "error";
type LogEntry = {
  seq: number;
  ts: number;
  source: LogSource;
  level: LogLevel;
  text: string;
};

const POLL_INTERVAL_MS = 2000;
/** Client-side history cap so the DOM doesn't grow unbounded during a long session. */
const MAX_CLIENT_ENTRIES = 500;

/**
 * Settings > 全般 のホストログ表示パネル。トレイホスト（host/src/index.js）が
 * tee している OpenCode / WebUI / web-build / Caddy の出力をライブ表示する。
 * docs/specs/host-log-viewer.md 参照。
 */
export function HostLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const sinceRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const mountedRef = useRef(false);
  const pollingRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!mountedRef.current || pollingRef.current) return;
    pollingRef.current = true;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const qs =
        sinceRef.current !== null ? `?since=${sinceRef.current}` : "";
      const res = await timedFetch(`/api/host/logs${qs}`, {
        timeoutMs: 3000,
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        entries?: LogEntry[];
        nextSeq?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `status ${res.status}`);
      }
      const next = data.entries ?? [];
      if (mountedRef.current && next.length > 0) {
        setEntries((prev) => {
          const merged = [...prev, ...next];
          return merged.length > MAX_CLIENT_ENTRIES
            ? merged.slice(-MAX_CLIENT_ENTRIES)
            : merged;
        });
      }
      if (mountedRef.current) {
        if (typeof data.nextSeq === "number") sinceRef.current = data.nextSeq;
        setFetchError(null);
      }
    } catch (err) {
      if (mountedRef.current && !controller.signal.aborted) setFetchError(
        err instanceof Error ? err.message : "ホストログを取得できません",
      );
    } finally {
      pollingRef.current = false;
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (!visible) {
        pollAbortRef.current?.abort();
        pollAbortRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!pageVisible) return () => {
      mountedRef.current = false;
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, [pageVisible, poll]);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (!stickToBottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries]);

  const copyAll = async () => {
    const text = entries.map((e) => `[${e.source}] ${e.text}`).join("\n");
    const ok = await copyText(text);
    if (!ok) return;
    if (!mountedRef.current) return;
    setCopied(true);
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      if (mountedRef.current) setCopied(false);
    }, 1500);
  };

  const clearView = () => {
    // Client-side only — the server ring buffer keeps history so future
    // polling continues from the last seen seq (design: 表示をクリア).
    setEntries([]);
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted">ホストログ</h2>
      <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-xs text-faint">
          トレイホストの直近ログ（LeafCode / WebUI / Caddy / ビルド）を表示します。生のコンソールを開かなくても診断できます。
        </p>
        {fetchError && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2">
            <p role="alert" className="text-xs text-danger">
              {fetchError} — start-webui.bat（トレイホスト）が起動しているか確認してください
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => void poll()}>
              再試行
            </Button>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={() => {
            const element = scrollRef.current;
            if (!element) return;
            stickToBottomRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
          }}
          className="max-h-64 overflow-y-auto rounded-lg bg-black px-3 py-2 font-mono text-xs"
        >
          {entries.length === 0 && !fetchError && (
            <p className="text-white/60">ログはまだありません</p>
          )}
          {entries.map((e) => (
            <p
              key={e.seq}
              className={cx(
                "whitespace-pre-wrap break-all",
                e.level === "error" ? "text-danger" : "text-white/90",
              )}
            >
              <span className="text-white/50">[{e.source}]</span> {e.text}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void copyAll()}
            disabled={entries.length === 0}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            コピー
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={clearView}
            disabled={entries.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            表示をクリア
          </Button>
        </div>
      </div>
    </section>
  );
}
