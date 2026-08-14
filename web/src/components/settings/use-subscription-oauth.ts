import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, sendJson } from "@/lib/client";

/**
 * OAuth サブスクリプション認証カードの共通ロジック
 * （REFACTORING_PLAN P5-d / IMPROVEMENT 1-3b）。
 * OpenAISubscriptionAuth の状態機械・接続確認・ポーリング・認証開始を
 * 1 実装に集約する。表示は各コンポーネントが行う。
 */

type AuthMethod = { type?: unknown; label?: unknown };
type AuthMethodsResponse = Record<string, AuthMethod[]>;
type ProviderResponse = { connected?: unknown };
type AuthorizationResponse = {
  url: string;
  method: "auto" | "code";
  instructions?: string;
};

export type SubscriptionAuthState =
  | "loading"
  | "ready"
  | "starting"
  | "waiting"
  | "connected"
  | "error";

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 90;

export interface UseSubscriptionOAuthConfig {
  providerKey: string;
  methodsEndpoint: string;
  providerEndpoint: string;
  authorizeEndpoint: string;
  popupName: string;
  findMethodIndex: (methods: AuthMethod[]) => number;
  isConnected: (value: unknown) => boolean;
  notAvailableMessage: string;
  loadErrorMessage: string;
  timeoutMessage: string;
  startErrorMessage: string;
}

export function useSubscriptionOAuth(config: UseSubscriptionOAuthConfig) {
  const [state, setState] = useState<SubscriptionAuthState>("loading");
  const [connected, setConnected] = useState(false);
  const [methodIndex, setMethodIndex] = useState<number | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  /**
   * True while re-authenticating an account that is already connected.
   * The provider endpoint only reports *whether* a provider is connected, so a
   * re-auth never changes it: polling would resolve instantly on the old
   * credentials and tear the flow down before the user reaches the auth page.
   * Such flows therefore end on explicit user confirmation instead.
   */
  const [reauth, setReauth] = useState(false);
  const attempts = useRef(0);
  const connectionRequestBusyRef = useRef(false);
  const connectionRequestGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const [pageVisible, setPageVisible] = useState(
    () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible",
  );
  const configRef = useRef(config);
  configRef.current = config;

  const refresh = useCallback(async () => {
    if (connectionRequestBusyRef.current) return null;
    connectionRequestBusyRef.current = true;
    const generation = ++connectionRequestGenerationRef.current;
    try {
      const provider = await getJson<ProviderResponse>(
        configRef.current.providerEndpoint,
      );
      const next = configRef.current.isConnected(provider.connected);
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

  useEffect(() => {
    const onVisibilityChange = () => {
      setPageVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    setReauth(false);
    try {
      const [methods, provider] = await Promise.all([
        getJson<AuthMethodsResponse>(configRef.current.methodsEndpoint),
        getJson<ProviderResponse>(configRef.current.providerEndpoint),
      ]);
      if (!mountedRef.current) return;
      const index = configRef.current.findMethodIndex(
        methods[configRef.current.providerKey] ?? [],
      );
      if (index < 0) {
        throw new Error(configRef.current.notAvailableMessage);
      }
      if (!mountedRef.current) return;
      setMethodIndex(index);
      const next = configRef.current.isConnected(provider.connected);
      setConnected(next);
      setState(next ? "connected" : "ready");
    } catch (cause) {
      if (!mountedRef.current) return;
      setState("error");
      setError(
        cause instanceof Error
          ? cause.message
          : configRef.current.loadErrorMessage,
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state !== "waiting" || !pageVisible || reauth) return;
    let cancelled = false;
    attempts.current = 0;
    const poll = async () => {
      if (cancelled || !mountedRef.current) return;
      attempts.current += 1;
      try {
        const nextConnected = await refresh();
        if (nextConnected) return;
      } catch {
        // The engine may restart during OAuth.
      }
      if (
        attempts.current >= POLL_MAX_ATTEMPTS &&
        !cancelled &&
        mountedRef.current
      ) {
        setState("ready");
        setError(configRef.current.timeoutMessage);
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pageVisible, reauth, refresh, state]);

  const start = async () => {
    if (methodIndex === null || state === "starting" || state === "waiting") {
      return;
    }
    // No `noopener`/`noreferrer`: those make window.open return null, so the
    // handle needed to navigate the popup to the authorization URL is lost and
    // only a blank window remains. The popup must be opened inside the click
    // handler, before awaiting the authorize call, or popup blockers reject it.
    const popup = window.open("about:blank", configRef.current.popupName);
    setState("starting");
    setError(null);
    setReauth(connected);
    try {
      const authorization = await sendJson<AuthorizationResponse>(
        "POST",
        configRef.current.authorizeEndpoint,
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
      setReauth(false);
      setState(connected ? "connected" : "ready");
      setError(
        cause instanceof Error
          ? cause.message
          : configRef.current.startErrorMessage,
      );
    }
  };

  const checkConnection = async () => {
    if (checking || connectionRequestBusyRef.current) return;
    setChecking(true);
    try {
      await refresh();
      if (mountedRef.current) setReauth(false);
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  };

  return {
    state,
    reauth,
    connected,
    methodIndex,
    authUrl,
    instructions,
    error,
    checking,
    load,
    start,
    checkConnection,
  };
}
