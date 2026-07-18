"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { AttentionScope } from "@/lib/attention";

type ShellExtras = {
  directory?: string;
  onFile?: (path: string) => void;
};

type ShellContextValue = {
  extras: ShellExtras;
  setExtras: (next: ShellExtras) => void;
  activeScope: AttentionScope | null;
  setActiveScope: (scope: AttentionScope | null) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [extras, setExtrasState] = useState<ShellExtras>({});
  const [activeScope, setActiveScope] = useState<AttentionScope | null>(null);
  const setExtras = useCallback((next: ShellExtras) => {
    setExtrasState(next);
  }, []);
  const value = useMemo(
    () => ({ extras, setExtras, activeScope, setActiveScope }),
    [extras, activeScope, setActiveScope],
  );
  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}

export function useShellExtras() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShellExtras requires ShellProvider");
  return ctx;
}

export function useShellActiveScope() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShellActiveScope requires ShellProvider");
  return ctx.activeScope;
}

export function useShellSetActiveScope() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShellSetActiveScope requires ShellProvider");
  return ctx.setActiveScope;
}
