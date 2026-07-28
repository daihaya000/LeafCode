"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { cx, Spinner } from "@/components/ui";
import { getJson } from "@/lib/client";

type DirEntry = { name: string; path: string; type?: "dir" | "file" };

export function FileTreePanel({
  root,
  onFile,
}: {
  root: string;
  onFile?: (path: string) => void;
}) {
  const [cwd, setCwd] = useState(root);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async (path: string) => {
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<{
        entries?: { name: string; path: string; kind?: string }[];
        dirs?: { name: string; path: string }[];
      }>("/api/browse/dirs", { path, files: "1" });
      if (id !== reqIdRef.current) return;
      const dirs = (data.dirs ?? data.entries ?? []).map((e) => ({
        name: e.name,
        path: e.path,
        type: (e as { kind?: string }).kind === "file" ? ("file" as const) : ("dir" as const),
      }));
      setEntries(dirs);
      setCwd(path);
    } catch (err) {
      if (id !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : "読み込み失敗");
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reqIdRef.current += 1;
    setEntries([]);
    setError(null);
    setCwd(root);
    void load(root);
  }, [root, load]);

  const up = () => {
    const parent = cwd.replace(/[\\/][^\\/]+$/, "");
    if (parent && parent !== cwd) void load(parent);
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-border bg-surface lg:border-l">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={up}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2"
        >
          上へ
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint">
          {cwd}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {loading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {error && <p className="px-2 text-xs text-danger">{error}</p>}
        {!loading &&
          entries.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => {
                if (e.type === "file") onFile?.(e.path);
                else void load(e.path);
              }}
              className={cx(
                "flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              {e.type === "file" ? (
                <File className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {e.type !== "file" && (
                <ChevronRight className="ml-auto h-3 w-3 text-faint" />
              )}
            </button>
          ))}
      </div>
    </div>
  );
}
