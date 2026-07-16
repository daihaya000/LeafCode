"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  FileText,
  Home,
  ListTodo,
  Moon,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { cx } from "@/components/ui";
import { getJson } from "@/lib/client";
import type { TaskSummary } from "@/lib/types";

type Item =
  | { kind: "action"; id: string; label: string; icon: React.ReactNode; run: () => void }
  | { kind: "task"; id: string; task: TaskSummary }
  | { kind: "file"; id: string; path: string };

export function CommandPalette({
  directory,
  onFile,
}: {
  /** enables in-workspace file search when set */
  directory?: string;
  onFile?: (path: string) => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Global shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load tasks when opened
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    getJson<{ tasks: TaskSummary[] }>("/api/tasks")
      .then((d) => setTasks(d.tasks ?? []))
      .catch(() => setTasks([]));
  }, [open]);

  // Debounced engine file search inside the workspace
  useEffect(() => {
    if (!open || !directory || !query.trim()) {
      setFiles([]);
      return;
    }
    const t = setTimeout(() => {
      const u = new URL("/api/opencode/find/file", window.location.origin);
      u.searchParams.set("directory", directory);
      u.searchParams.set("query", query.trim());
      u.searchParams.set("limit", "12");
      fetch(u.toString(), {
        headers: { "x-opencode-directory": directory },
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setFiles(Array.isArray(d) ? d : []))
        .catch(() => setFiles([]));
    }, 150);
    return () => clearTimeout(t);
  }, [open, directory, query]);

  const close = useCallback(() => setOpen(false), []);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);

    const allActions: Extract<Item, { kind: "action" }>[] = [
      {
        kind: "action",
        id: "new-task",
        label: "新しいタスク",
        icon: <Plus className="h-4 w-4" />,
        run: () => router.push("/"),
      },
      {
        kind: "action",
        id: "home",
        label: "ホーム（タスク一覧）",
        icon: <Home className="h-4 w-4" />,
        run: () => router.push("/"),
      },
      {
        kind: "action",
        id: "settings",
        label: "設定を開く",
        icon: <Settings className="h-4 w-4" />,
        run: () => router.push("/settings"),
      },
      {
        kind: "action",
        id: "theme",
        label: "テーマ切替（ライト/ダーク）",
        icon: <Moon className="h-4 w-4" />,
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ];
    const actions: Item[] = allActions.filter((a) => match(a.label));

    const taskItems: Item[] = tasks
      .filter((t) => match(`${t.title} ${t.projectName}`))
      .slice(0, 8)
      .map((t) => ({ kind: "task", id: t.id, task: t }));

    const fileItems: Item[] = files.map((f) => ({
      kind: "file",
      id: `file:${f}`,
      path: f,
    }));

    return [...actions, ...taskItems, ...fileItems];
  }, [query, tasks, files, router, setTheme, resolvedTheme]);

  useEffect(() => {
    setActive((cur) => Math.min(cur, Math.max(0, items.length - 1)));
  }, [items]);

  const select = useCallback(
    (item: Item) => {
      close();
      if (item.kind === "action") item.run();
      else if (item.kind === "task") router.push(`/task/${item.id}`);
      else if (item.kind === "file") onFile?.(item.path);
    },
    [close, router, onFile],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[max(12vh,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]"
      onMouseDown={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              directory ? "タスク・ファイル・アクションを検索…" : "タスク・アクションを検索…"
            }
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((c) => Math.min(c + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && items[active]) {
                e.preventDefault();
                select(items[active]);
              }
            }}
          />
          <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-faint sm:inline">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-faint">
              一致する項目がありません
            </p>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => select(item)}
              className={cx(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm",
                i === active ? "bg-surface-2 text-text" : "text-muted",
              )}
            >
              {item.kind === "action" && (
                <>
                  <span className="text-faint">{item.icon}</span>
                  <span>{item.label}</span>
                </>
              )}
              {item.kind === "task" && (
                <>
                  <ListTodo className="h-4 w-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{item.task.title}</span>
                  <span className="hidden truncate text-xs text-faint sm:inline">
                    {item.task.projectName}
                  </span>
                  <span className="shrink-0">
                    <StatusBadge status={item.task.status} />
                  </span>
                </>
              )}
              {item.kind === "file" && (
                <>
                  <FileText className="h-4 w-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {item.path}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
