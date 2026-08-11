"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AttentionScope } from "@/lib/attention";

type ShellExtras = {
  directory?: string;
  onFile?: (path: string) => void;
};

type ShellContextValue = {
  extras: ShellExtras;
  setExtras: (next: ShellExtras, owner?: string) => void;
  activeScope: AttentionScope | null;
  setActiveScope: (scope: AttentionScope | null, owner?: string) => void;
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [extras, setExtrasState] = useState<ShellExtras>({});
  const extrasOwnerRef = useRef<string | null>(null);
  const [activeScope, setActiveScopeState] = useState<AttentionScope | null>(null);
  const activeScopeOwnerRef = useRef<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const setExtras = useCallback((next: ShellExtras, owner?: string) => {
    const clearing = !next.directory && !next.onFile;
    if (clearing && owner && extrasOwnerRef.current !== owner) return;
    extrasOwnerRef.current = clearing ? null : owner ?? null;
    setExtrasState(next);
  }, []);
  const setActiveScope = useCallback(
    (scope: AttentionScope | null, owner?: string) => {
      if (!scope && owner && activeScopeOwnerRef.current !== owner) return;
      activeScopeOwnerRef.current = scope ? owner ?? null : null;
      setActiveScopeState(scope);
    },
    [],
  );
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const value = useMemo(
    () => ({
      extras,
      setExtras,
      activeScope,
      setActiveScope,
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
    }),
    [
      extras,
      setExtras,
      activeScope,
      setActiveScope,
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
    ],
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

/** Mobile navigation drawer open/close API. */
export function useShellMobileNav() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShellMobileNav requires ShellProvider");
  return {
    mobileNavOpen: ctx.mobileNavOpen,
    openMobileNav: ctx.openMobileNav,
    closeMobileNav: ctx.closeMobileNav,
  };
}
