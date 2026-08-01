import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";

type AuthMethod = { type?: unknown };
type AuthMethodsResponse = Record<string, AuthMethod[]>;
type ProviderResponse = { connected?: unknown };
type AuthorizationResponse = { url: string; method: "auto" | "code"; instructions?: string };
type State = "loading" | "ready" | "starting" | "waiting" | "connected" | "error";

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 90;

function isConnected(value: unknown): boolean {
  return Array.isArray(value) && value.includes("anthropic");
}

export function ClaudeSubscriptionAuth({ showHeading = true }: { showHeading?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [connected, setConnected] = useState(false);
  const [methodIndex, setMethodIndex] = useState<number | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const attempts = useRef(0);
  const connectionRequestBusyRef = useRef(false);
  const connectionRequestGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (connectionRequestBusyRef.current) return null;
    connectionRequestBusyRef.current = true;
    const generation = ++connectionRequestGenerationRef.current;
    try {
      const provider = await getJson<ProviderResponse>("/api/opencode/provider");
      const next = isConnected(provider.connected);
      if (
        !mountedRef.current ||
        generation !== connectionRequestGenerationRef.current
      ) {
        return null;
      }
      setConnected(next);
      if (next) {
        setState("connected");
        setAuthUrl(null);
        setInstructions(null);
      }
      return next;
    } finally {
      connectionRequestBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectionRequestGenerationRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [methods, provider] = await Promise.all([
        getJson<AuthMethodsResponse>("/api/opencode/provider/auth"),
        getJson<ProviderResponse>("/api/opencode/provider"),
      ]);
      if (!mountedRef.current) return;
      const index = (methods.anthropic ?? []).findIndex((method) => method.type === "oauth");
      if (index < 0) throw new Error("ClaudeのOAuth認証方式が利用できません");
      setMethodIndex(index);
      const next = isConnected(provider.connected);
      setConnected(next);
      setState(next ? "connected" : "ready");
    } catch (cause) {
      if (!mountedRef.current) return;
      setState("error");
      setError(cause instanceof Error ? cause.message : "Claudeの認証状態を取得できませんでした");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (state !== "waiting") return;
    let cancelled = false;
    attempts.current = 0;
    const poll = async () => {
      if (cancelled || !mountedRef.current) return;
      attempts.current += 1;
      try {
        const nextConnected = await refresh();
        if (nextConnected) return;
      } catch { /* The engine may restart during OAuth. */ }
      if (attempts.current >= POLL_MAX_ATTEMPTS && !cancelled && mountedRef.current) {
        setState("ready");
        setError("認証完了を確認できませんでした。認証後に再確認してください。");
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refresh, state]);

  const start = async () => {
    if (methodIndex === null || state === "starting" || state === "waiting") return;
    const popup = window.open("about:blank", "claude-auth", "noopener,noreferrer");
    setState("starting");
    setError(null);
    try {
      const authorization = await sendJson<AuthorizationResponse>(
        "POST",
        "/api/provider/anthropic/oauth/authorize",
        { method: methodIndex },
      );
      if (!mountedRef.current) {
        popup?.close();
        return;
      }
      setAuthUrl(authorization.url);
      setInstructions(authorization.instructions ?? null);
      if (popup) popup.location.href = authorization.url;
      setState("waiting");
    } catch (cause) {
      popup?.close();
      if (!mountedRef.current) return;
      setState(connected ? "connected" : "ready");
      setError(cause instanceof Error ? cause.message : "Claudeの認証を開始できませんでした");
    }
  };

  const checkConnection = async () => {
    if (checking || connectionRequestBusyRef.current) return;
    setChecking(true);
    try {
      await refresh();
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  };

  return (
    <section
      aria-label={showHeading ? undefined : "Claude サブスクリプション"}
      aria-labelledby={showHeading ? "claude-subscription-heading" : undefined}
    >
      {showHeading && <h2 id="claude-subscription-heading" className="mb-3 text-sm font-semibold text-muted">Claude サブスクリプション</h2>}
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Claude Pro / Max</h3>
              {state !== "loading" && state !== "error" && <Badge tone={connected ? "success" : "neutral"}>{connected ? "接続済み" : "未接続"}</Badge>}
            </div>
            <p className="mt-1 text-xs text-faint">APIキーを入力せず、Anthropicのアカウントをブラウザで認証します。</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === "loading" && <span className="text-xs text-faint">確認中…</span>}
            {state === "error" && <Button variant="secondary" size="sm" onClick={() => void load()}>再試行</Button>}
            {(state === "ready" || state === "connected") && <Button size="sm" onClick={() => void start()} disabled={methodIndex === null}>{connected ? "再認証" : "ブラウザで認証"}</Button>}
            {state === "starting" && <Button size="sm" busy>認証を準備中…</Button>}
            {state === "waiting" && (
              <Button
                variant="secondary"
                size="sm"
                busy={checking}
                disabled={checking}
                onClick={() => void checkConnection()}
              >
                {checking ? "確認中…" : "認証完了を確認"}
              </Button>
            )}
          </div>
        </div>
        {state === "waiting" && <p className="mt-3 text-xs text-muted" aria-live="polite">認証ページを開いています。完了すると自動で接続状態を更新します。</p>}
        {instructions && <p className="mt-2 text-xs text-faint">{instructions}</p>}
        {authUrl && state !== "connected" && <a href={authUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">認証ページを開く <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </div>
    </section>
  );
}
