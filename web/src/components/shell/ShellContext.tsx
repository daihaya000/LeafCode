"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ShellExtras = {
  directory?: string;
  onFile?: (path: string) => void;
};

type ShellContextValue = {
  extras: ShellExtras;
  setExtras: (next: ShellExtras) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [extras, setExtrasState] = useState<ShellExtras>({});
  const setExtras = useCallback((next: ShellExtras) => {
    setExtrasState(next);
  }, []);
  const value = useMemo(() => ({ extras, setExtras }), [extras, setExtras]);
  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}

export function useShellExtras() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShellExtras requires ShellProvider");
  return ctx;
}
