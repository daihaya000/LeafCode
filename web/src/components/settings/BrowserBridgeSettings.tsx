"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Badge, Button, cx } from "@/components/ui";
import { timedFetch } from "@/lib/client";

type Status = {
  available: boolean;
  connected?: boolean;
  paired?: boolean;
  pendingApprovals?: number;
};

type Connection = {
  brokerUrl: string;
  paired: boolean;
  connected: boolean;
};

const STORAGE_KEY = "browser-bridge-broker-url";
const DEFAULT_BROKER_URL = "ws://127.0.0.1:18766/extension";
const POLL_MS = 2000;

function readSavedUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BROKER_URL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.startsWith("ws://") ? raw : DEFAULT_BROKER_URL;
  } catch {
    return DEFAULT_BROKER_URL;
  }
}

function writeSavedUrl(url: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // ignore
  }
}

export function BrowserBridgeSettings() {
  const [urlDraft, setUrlDraft] = useState(readSavedUrl);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [connectionDismissed, setConnectionDismissed] = useState(false);
  const hintId = useId();

  const fetchStatus = useCallback(async (): Promise<Status | null> => {
    try {
      const res = await timedFetch("/api/host/browser-bridge/status", {
        timeoutMs: 3000,
      });
      const data = (await res.json().catch(() => ({}))) as Status;
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setStatus({ available: false });
      setError(err instanceof Error ? err.message : "接続状態を取得できません");
      return null;
    }
  }, []);

  // Initial load and polling while the component is mounted.
  useEffect(() => {
    void fetchStatus();
    const timer = window.setInterval(() => void fetchStatus(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchStatus]);

  const isConnected =
    status?.available === true &&
    (status.connected === true || status.paired === true);

  // Once we know the Broker is reachable and paired, treat us as connected.
  useEffect(() => {
    if (isConnected && !connectionDismissed) {
      setConnection({
        brokerUrl: urlDraft,
        paired: status?.paired === true,
        connected: status?.connected === true,
      });
    } else if (!isConnected) {
      setConnection(null);
      setConnectionDismissed(false);
    }
  }, [connectionDismissed, isConnected, status, urlDraft]);

  const handleConnect = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const trimmed = urlDraft.trim();
      if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
        throw new Error("Broker URL は ws:// または wss:// で始まる必要があります");
      }
      // Persist the URL locally and refresh status. The actual pairing is
      // initiated by the browser extension; the WebUI only needs to know the
      // Broker is reachable and whether a paired extension exists.
      writeSavedUrl(trimmed);
      const next = await fetchStatus();
      if (next?.available !== true) {
        throw new Error("Broker に接続できません");
      }
      setConnectionDismissed(false);
      setConnection({
        brokerUrl: trimmed,
        paired: next.paired === true,
        connected: next.connected === true,
      });
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "接続に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    // TODO: call a server-side disconnect/revoke endpoint when Task 8 adds it.
    setConnection(null);
    setConnectionDismissed(true);
    setExpanded(false);
  };

  const showForm = !connection || expanded;

  return (
    <section
      className="rounded-xl border border-border bg-surface p-4"
      aria-label="Browser Bridge"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text">Browser Bridge</h3>
              <p className="text-xs text-faint">
                {connection
                  ? `${connection.brokerUrl} に接続済み`
                  : "ローカル Broker に未接続"}
              </p>
            </div>
            <Badge tone={connection ? "success" : "neutral"}>
              {connection ? "接続済み" : "未接続"}
            </Badge>
          </div>

          {connection && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-controls={hintId}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    接続設定を折りたたむ
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    接続設定を変更
                  </>
                )}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleDisconnect()}
                title="この接続を削除"
              >
                <Trash2 className="h-4 w-4" />
                この接続を削除
              </Button>
            </div>
          )}

          {showForm && (
            <div
              id={hintId}
              className={cx(
                "mt-4 rounded-lg border border-border bg-bg p-3",
                connection && "animate-in fade-in slide-in-from-top-2",
              )}
            >
              <p className="text-xs text-faint">
                WebUIの設定 → 拡張機能で、このペアリング要求を承認してください。コードの入力は不要です。
              </p>
              <div className="mt-3">
                <label htmlFor={`${hintId}-url`} className="text-xs font-medium text-muted">
                  Broker URL
                </label>
                <input
                  id={`${hintId}-url`}
                  type="text"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="ws://127.0.0.1:18766/extension"
                  disabled={loading}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-border-strong disabled:opacity-60"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <Button busy={loading} onClick={() => void handleConnect()}>
                  この URL で接続
                </Button>
                {connection && (
                  <Button
                    variant="outline"
                    disabled={loading}
                    onClick={() => setExpanded(false)}
                  >
                    キャンセル
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          {/* TODO(Task 9): tab sharing, audit log, and revoke will be added
              once the backend exposes the required endpoints. */}
          <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-4 text-center">
            <p className="text-xs text-faint">タブ共有と監査ログは今後の更新で利用可能になります。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
