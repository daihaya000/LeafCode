"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/client";
import type { CodexBarUsage } from "./lib/codexbar";
import { type CodexTokensResult } from "./lib/codex-tokens";

/** Poll the usage snapshot while the tab is visible. */
const POLL_MS = 30_000;

/**
 * CodexBar の利用状況・トークン集計を取得するフック
 * （REFACTORING_PLAN 7-2 / IMPROVEMENT 7-2: 表示部からの分離）。
 * ポーリングと表示中タブでの自動再取得を内包し、ウィジェットは表示のみ行う。
 */
export function useCodexUsage() {
  const [usage, setUsage] = useState<CodexBarUsage | null>(null);
  const [tokens, setTokens] = useState<CodexTokensResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getJson<CodexBarUsage>("/api/addons/codexbar/usage");
      if (!mounted.current) return;
      setUsage(data);
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
    // Token totals are best-effort and independent of the usage snapshot.
    try {
      const tok = await getJson<CodexTokensResult>("/api/addons/codexbar/tokens", {
        days: "1",
      });
      if (mounted.current) setTokens(tok);
    } catch {
      /* leave previous tokens value */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refresh();
      }
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { usage, tokens, loadError, refreshing, refresh, now };
}
