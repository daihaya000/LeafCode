"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiUrl } from "@/lib/client";
import { notifyAttentionCountChanged } from "@/lib/events";
import { parseGlobalEvent, isResolvedEvent, type AttentionItem, type AttentionScope } from "@/lib/attention";
import { useAttentionQueue } from "@/lib/useAttentionQueue";

type GlobalAttentionContextValue = {
  items: AttentionItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  openNext: () => void;
  remove: (requestId: string) => void;
};

const GlobalAttentionContext = createContext<GlobalAttentionContextValue | null>(null);

export function useGlobalAttention() {
  const ctx = useContext(GlobalAttentionContext);
  if (!ctx) throw new Error("useGlobalAttention requires GlobalAttentionProvider");
  return ctx;
}

export function GlobalAttentionProvider({
  children,
  activeScope,
}: {
  children: React.ReactNode;
  activeScope: AttentionScope | null;
}) {
  const { items, add, remove } = useAttentionQueue(activeScope);
  const [open, setOpenState] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const autoOpenedRef = useRef(false);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
  }, []);

  const openNext = useCallback(() => {
    if (items.length === 0) return;
    setOpenState(true);
  }, [items.length]);

  // Notify badge subscribers whenever queue length changes
  useEffect(() => {
    notifyAttentionCountChanged();
  }, [items.length]);

  // Auto-open the modal once when the queue becomes non-empty, unless:
  // - already auto-opened
  // - an input/textarea currently has focus
  useEffect(() => {
    if (items.length === 0) {
      autoOpenedRef.current = false;
      return;
    }
    if (autoOpenedRef.current) return;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLInputElement ||
      focused instanceof HTMLTextAreaElement ||
      focused?.getAttribute("contenteditable") === "true"
    ) {
      return;
    }
    autoOpenedRef.current = true;
    setOpenState(true);
  }, [items.length]);

  // Global EventSource subscription
  useEffect(() => {
    let es: EventSource | null = null;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = (isReconnect: boolean) => {
      void isReconnect;
      if (cancelled) return;
      es?.close();
      es = new EventSource(apiUrl("/api/opencode/global/event"));
      es.onmessage = (ev) => {
        const resolvedId = isResolvedEvent(ev.data);
        if (resolvedId) {
          remove(resolvedId);
          return;
        }
        const item = parseGlobalEvent(ev.data);
        if (item) add(item);
      };
      es.onopen = () => {
        retryMs = 1000;
      };
      es.onerror = () => {
        es?.close();
        timer = setTimeout(() => connect(true), retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
    };

    connect(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [add]);

  const value = {
    items,
    open,
    setOpen,
    openNext,
    remove,
  };

  return (
    <GlobalAttentionContext.Provider value={value}>
      {children}
    </GlobalAttentionContext.Provider>
  );
}
