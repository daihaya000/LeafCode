import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";

type AuthMethod = {
  type?: unknown;
  label?: unknown;
};

type AuthMethodsResponse = Record<string, AuthMethod[]>;

type ProviderResponse = {
  connected?: unknown;
};

type AuthorizationResponse = {
  url: string;
  method: "auto" | "code";
  instructions?: string;
};

type State = "loading" | "ready" | "starting" | "waiting" | "connected" | "error";

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 90;

function isConnected(value: unknown): boolean {
  return Array.isArray(value) && value.includes("openai");
}

function isBrowserOAuth(method: AuthMethod | undefined): boolean {
  return (
    method?.type === "oauth" &&
    typeof method.label === "string" &&
    /browser|ブラウザ/i.test(method.label)
  );
}

export function OpenAISubscriptionAuth({ showHeading = true }: { showHeading?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [connected, setConnected] = useState(false);
  const [methodIndex, setMethodIndex] = useState<number | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollAttempts = useRef(0);
  const connectionRequestBusyRef = useRef(false);
  const connectionRequestGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  const refreshConnection = useCallback(async () => {
    if (connectionRequestBusyRef.current) return null;
    connectionRequestBusyRef.current = true;
    const generation = ++connectionRequestGenerationRef.current;
    try {
      const provider = await getJson<ProviderResponse>("/api/opencode/provider");
      const nextConnected = isConnected(provider.connected);
      if (
        !mountedRef.current ||
        generation !== connectionRequestGenerationRef.current
      ) {
        return null;
      }
      setConnected(nextConnected);
      if (nextConnected) {
        setState("connected");
        setAuthUrl(null);
        setInstructions(null);
      }
      return nextConnected;
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
      const index = (methods.openai ?? []).findIndex(isBrowserOAuth);
      if (index < 0) {
        throw new Error("OpenAI のブラウザ認証方式が利用できません");
      }
      if (!mountedRef.current) return;
      setMethodIndex(index);
      const nextConnected = isConnected(provider.connected);
      setConnected(nextConnected);
      setState(nextConnected ? "connected" : "ready");
    } catch (cause) {
      if (!mountedRef.current) return;
      setState("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "OpenAI の認証状態を取得できませんでした",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state !== "waiting") return;
    let cancelled = false;
    pollAttempts.current = 0;
    const poll = async () => {
      if (cancelled || !mountedRef.current) return;
      pollAttempts.current += 1;
      try {
        const nextConnected = await refreshConnection();
        if (nextConnected) return;
      } catch {
        // Keep the authentication window usable while the engine is restarting.
      }
      if (pollAttempts.current >= POLL_MAX_ATTEMPTS && !cancelled && mountedRef.current) {
        setState("ready");
        setError("認証完了を確認できませんでした。認証後に再確認してください。");
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshConnection, state]);

  const start = async () => {
    if (methodIndex === null || state === "starting" || state === "waiting") return;
    const popup = window.open("about:blank", "openai-auth", "noopener,noreferrer");
    setState("starting");
    setError(null);
    setAuthUrl(null);
    try {
      const authorization = await sendJson<AuthorizationResponse>(
        "POST",
        "/api/provider/openai/oauth/authorize",
        { method: methodIndex },
      );
      if (!mountedRef.current) {
        popup?.close();
        return;
      }
      setAuthUrl(authorization.url);
      setInstructions(authorization.instructions ?? null);
      if (popup) {
        popup.location.href = authorization.url;
      }
      setState("waiting");
    } catch (cause) {
      popup?.close();
      if (!mountedRef.current) return;
      setState(connected ? "connected" : "ready");
      setError(
        cause instanceof Error
          ? cause.message
          : "OpenAI のブラウザ認証を開始できませんでした",
      );
    }
  };

  return (
    <section
      aria-label={showHeading ? undefined : "OpenAI サブスクリプション"}
      aria-labelledby={showHeading ? "openai-subscription-heading" : undefined}
    >
      {showHeading && (
        <h2
          id="openai-subscription-heading"
          className="mb-3 text-sm font-semibold text-muted"
        >
          OpenAI サブスクリプション
        </h2>
      )}
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">ChatGPT Plus / Pro</h3>
              {state !== "loading" && state !== "error" && (
                <Badge tone={connected ? "success" : "neutral"}>
                  {connected ? "接続済み" : "未接続"}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-faint">
              API キーを入力せず、OpenAI のアカウントをブラウザで認証します。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === "loading" && <span className="text-xs text-faint">確認中…</span>}
            {state === "error" && (
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                再試行
              </Button>
            )}
            {(state === "ready" || state === "connected") && (
              <Button
                size="sm"
                onClick={() => void start()}
                disabled={methodIndex === null}
              >
                {connected ? "再認証" : "ブラウザで認証"}
              </Button>
            )}
            {state === "starting" && <Button size="sm" busy>認証を準備中…</Button>}
            {state === "waiting" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refreshConnection()}
              >
                認証完了を確認
              </Button>
            )}
          </div>
        </div>
        {state === "waiting" && (
          <p className="mt-3 text-xs text-muted" aria-live="polite">
            認証ページを開いています。完了すると自動で接続状態を更新します。
          </p>
        )}
        {instructions && <p className="mt-2 text-xs text-faint">{instructions}</p>}
        {authUrl && state !== "connected" && (
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            認証ページを開く
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
