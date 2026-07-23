"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Star,
  X,
} from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { useOptionalGlobalAttention } from "@/components/shell/GlobalAttentionProvider";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import type { ProjectDto } from "@/lib/types";

type DirEntry = { name: string; path: string };
type DirList = {
  path: string | null;
  parent: string | null;
  quickAccess?: DirEntry[];
  entries: DirEntry[];
  error?: string;
};

type Props = {
  onAdded?: (project: ProjectDto) => void;
  variant?: "button" | "icon";
  className?: string;
  label?: string;
};

export function AddProjectButton({
  onAdded,
  variant = "button",
  className,
  label = "プロジェクトを追加",
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [quickAccess, setQuickAccess] = useState<DirEntry[]>([]);
  const [manualPath, setManualPath] = useState("");
  const attention = useOptionalGlobalAttention();
  const attentionOpen = attention?.open ?? false;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (attentionOpen && open) setOpen(false);
  }, [attentionOpen, open]);

  useEffect(() => {
    if (!open) {
      if (prevFocusRef.current) {
        prevFocusRef.current.focus();
        prevFocusRef.current = null;
      }
      return;
    }
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busy) setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !(el as HTMLButtonElement).disabled);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const load = useCallback(async (dir: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const q = dir ? { path: dir } : undefined;
      const data = await getJson<DirList>("/api/browse/dirs", q);
      setCwd(data.path);
      setParent(data.parent);
      setEntries(data.entries ?? []);
      setQuickAccess(data.quickAccess ?? []);
      // Only sync manualPath on initial load (when empty) to avoid overwriting
      // user-typed paths during navigation (R9#3).
      if (data.path && !manualPath) setManualPath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一覧取得に失敗しました");
      setEntries([]);
      setQuickAccess([]);
    } finally {
      setLoading(false);
    }
  }, [manualPath]);

  useEffect(() => {
    if (!open) return;
    void load(null);
  }, [open, load]);

  const create = async (rootPath: string) => {
    const data = await sendJson<{ project: ProjectDto }>("POST", "/api/projects", {
      rootPath,
    });
    notifyTasksChanged();
    onAdded?.(data.project);
    return data.project;
  };

  const confirm = async (rootPath: string) => {
    const p = rootPath.trim();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await create(p);
      setOpen(false);
      setManualPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const openPicker = () => {
    if (attentionOpen) return;
    setError(null);
    setOpen(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          onClick={openPicker}
          className={cx(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text",
            className,
          )}
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      ) : (
        <div className={cx(className)}>
          <Button onClick={openPicker}>
            <FolderPlus className="h-4 w-4" />
            {label}
          </Button>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-project-title"
        >
          <button
            type="button"
            aria-label="閉じる"
            className="absolute inset-0 bg-black/50"
            onClick={() => !busy && setOpen(false)}
          />
          <div
            ref={panelRef}
            className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-3">
              <h2 id="add-project-title" className="flex-1 text-sm font-semibold">
                フォルダを選択
              </h2>
              <button
                type="button"
                disabled={busy}
                aria-label="閉じる"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 border-b border-border px-2 py-2">
              <button
                type="button"
                disabled={loading || cwd === null}
                onClick={() => void load(parent)}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-surface-2 disabled:opacity-40"
              >
                上へ
              </button>
              <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">
                {cwd ?? "…"}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              ) : (
                <>
                  {quickAccess.length > 0 && (
                    <div className="border-b border-border pb-1">
                      <p className="px-3 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
                        クイックアクセス
                      </p>
                      <ul>
                        {quickAccess.map((e) => (
                          <li key={`qa-${e.path}`}>
                            <button
                              type="button"
                              onClick={() => void load(e.path)}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-left hover:bg-surface-2 active:bg-surface-3"
                            >
                              <Star className="h-4 w-4 shrink-0 fill-warning text-warning" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">
                                  {e.name}
                                </span>
                                <span className="block truncate font-mono text-[10px] text-faint">
                                  {e.path}
                                </span>
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {entries.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-faint">
                      サブフォルダがありません
                    </p>
                  ) : (
                    <ul className="py-1">
                      {quickAccess.length > 0 && (
                        <li className="px-3 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
                          このフォルダ
                        </li>
                      )}
                      {entries.map((e) => (
                        <li key={e.path}>
                          <button
                            type="button"
                            onClick={() => void load(e.path)}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-left hover:bg-surface-2 active:bg-surface-3"
                          >
                            <Folder className="h-4.5 w-4.5 shrink-0 text-muted" />
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {e.name}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="またはパスを入力 C:\path\to\repo"
                className="h-10 w-full rounded-lg border border-border bg-bg px-3 font-mono text-xs outline-none focus:border-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirm(manualPath);
                }}
              />
              {error && (
                <p className="rounded-lg border border-danger/30 bg-danger-bg px-2 py-1.5 text-xs text-danger">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy || !cwd}
                  onClick={() => cwd && void load(cwd)}
                >
                  再読込
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  busy={busy}
                  disabled={!manualPath.trim() && !cwd}
                  onClick={() => void confirm(manualPath.trim() || cwd || "")}
                >
                  このフォルダを追加
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
