"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  HardDrive,
  Home,
  X,
} from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import type { ProjectDto } from "@/lib/types";

type DirEntry = { name: string; path: string };
type DirList = {
  path: string | null;
  parent: string | null;
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
  const [manualPath, setManualPath] = useState("");

  const load = useCallback(async (dir: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const q = dir ? { path: dir } : undefined;
      const data = await getJson<DirList>("/api/browse/dirs", q);
      setCwd(data.path);
      setParent(data.parent);
      setEntries(data.entries ?? []);
      if (data.path) setManualPath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一覧取得に失敗しました");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
    setError(null);
    setOpen(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          title={label}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="閉じる"
            className="absolute inset-0 bg-black/50"
            onClick={() => !busy && setOpen(false)}
          />
          <div className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-3">
              <h2 className="flex-1 text-sm font-semibold">フォルダを選択</h2>
              <button
                type="button"
                disabled={busy}
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
                {cwd ?? "（ドライブ / ホーム）"}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              ) : entries.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-faint">
                  サブフォルダがありません
                </p>
              ) : (
                <ul className="py-1">
                  {entries.map((e) => {
                    const isRoot =
                      !cwd &&
                      (e.path.endsWith(":\\") ||
                        e.path === "/" ||
                        e.name.startsWith("ホーム"));
                    return (
                      <li key={e.path}>
                        <button
                          type="button"
                          onClick={() => void load(e.path)}
                          className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-left hover:bg-surface-2 active:bg-surface-3"
                        >
                          {isRoot && e.path.match(/^[A-Za-z]:\\$/) ? (
                            <HardDrive className="h-4.5 w-4.5 shrink-0 text-muted" />
                          ) : e.name.startsWith("ホーム") ? (
                            <Home className="h-4.5 w-4.5 shrink-0 text-muted" />
                          ) : (
                            <Folder className="h-4.5 w-4.5 shrink-0 text-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {e.name}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
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
