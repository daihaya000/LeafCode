import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { sendJson } from "@/lib/client";
import { notifyTasksChanged } from "@/lib/events";
import { Button } from "@/components/ui";

type OrphanDto = {
  id: string;
  displayName: string;
  absolutePath: string;
};

type StrayDto = { projectId: string; projectName: string; path: string };

interface WorkspaceRootsSettingsProps {
  roots: string[];
  orphans: OrphanDto[];
  stray: StrayDto[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
  guard: (fn: () => Promise<void>) => Promise<void>;
  setError: (error: string | null) => void;
}

/**
 * Settings の「全般」タブ末尾に置くワークスペース保守セクション。
 * 旧「プロジェクト」タブから許可ルート（allowlist）と孤立 worktree 掃除だけを
 * 引き継ぐ。プロジェクト一覧・アーカイブ操作は左サイドバーに一本化した。
 */
export function WorkspaceRootsSettings({
  roots,
  orphans,
  stray,
  busy,
  setBusy,
  refresh,
  guard,
  setError,
}: WorkspaceRootsSettingsProps) {
  const [newRoot, setNewRoot] = useState("");
  const [deletingRoot, setDeletingRoot] = useState<string | null>(null);
  const [pendingRootDelete, setPendingRootDelete] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const deletingRootRef = useRef<string | null>(null);
  const rootConfirmRef = useRef<HTMLDivElement | null>(null);
  const rootTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingRootDelete) {
      if (rootTriggerRef.current?.isConnected) rootTriggerRef.current.focus();
      rootTriggerRef.current = null;
      return;
    }

    rootConfirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPendingRootDelete(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingRootDelete]);

  const addRoot = () =>
    guard(async () => {
      if (!newRoot.trim()) return;
      await sendJson("POST", "/api/roots", { path: newRoot.trim() });
      setNewRoot("");
    });

  const removeRoot = async (r: string, confirmed = false) => {
    if (busyRef.current || deletingRootRef.current !== null) return;
    if (!confirmed) {
      rootTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPendingRootDelete(r);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    deletingRootRef.current = r;
    setDeletingRoot(r);
    setError(null);
    try {
      try {
        await sendJson("DELETE", "/api/roots", undefined, { path: r });
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status?: unknown }).status
            : undefined;
        if (status === 404) {
          await refresh();
          throw new Error(`許可ルート「${r}」は既に削除済みです。`);
        }
        throw err;
      }
      await refresh();
      notifyTasksChanged();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "操作に失敗しました");
      }
    } finally {
      deletingRootRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) {
        setDeletingRoot(null);
        setBusy(false);
      }
    }
  };

  const cleanupOrphans = () =>
    guard(async () => {
      const data = await sendJson<{
        results?: { ok: boolean; error?: string }[];
        strayErrors?: string[];
      }>("POST", "/api/workspaces/orphans", { action: "cleanup" });
      const failed = data.results?.filter((r) => !r.ok) ?? [];
      const strayErrors = data.strayErrors ?? [];
      if (failed.length > 0 || strayErrors.length > 0) {
        throw new Error(
          [...failed.map((f) => f.error), ...strayErrors].join("; "),
        );
      }
    });

  return (
    <>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted">
          許可ルート（allowlist）
        </h2>
        <p className="mb-3 text-xs text-faint">
          ここに登録したフォルダ配下だけをプロジェクトとして追加できます。
        </p>
        <div className="mb-3 flex gap-2">
          <input
            value={newRoot}
            onChange={(e) => setNewRoot(e.target.value)}
            aria-label="追加する許可ルート"
            placeholder="C:\path\to\allow"
            className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addRoot();
            }}
          />
          <Button busy={busy} onClick={() => void addRoot()}>
            <Plus className="h-4 w-4" />
            許可
          </Button>
        </div>
        {pendingRootDelete && (
          <div
            ref={rootConfirmRef}
            role="alertdialog"
            aria-label="許可ルート削除の確認"
            aria-describedby="root-delete-confirm-description"
            className="mb-3 rounded-xl border border-danger/30 bg-danger-bg px-3 py-3 text-sm text-danger"
          >
            <p id="root-delete-confirm-description">
              許可ルート「{pendingRootDelete}」を削除しますか？
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                busy={deletingRoot === pendingRootDelete}
                onClick={() => {
                  const root = pendingRootDelete;
                  rootTriggerRef.current = null;
                  setPendingRootDelete(null);
                  void removeRoot(root, true);
                }}
              >
                削除する
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingRootDelete(null)}
              >
                キャンセル
              </Button>
            </div>
          </div>
        )}
        <ul className="space-y-1">
          {roots.map((r) => (
            <li
              key={r}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-muted"
            >
              <span className="truncate text-text">{r}</span>
              <button
                type="button"
                disabled={busy || deletingRoot !== null}
                aria-label={`${r}を削除`}
                aria-busy={deletingRoot === r}
                onClick={() => void removeRoot(r)}
                className="min-h-6 min-w-6 shrink-0 rounded-lg p-1 text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
              >
                {deletingRoot === r ? "削除中…" : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
          {roots.length === 0 && (
            <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-faint">
              許可ルートが登録されていません
            </li>
          )}
        </ul>
      </section>

      {(orphans.length > 0 || stray.length > 0) && (
        <section>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
            <div>
              <h2 className="text-sm font-semibold text-warning">
                要復旧の Workspace
              </h2>
              <p className="mt-0.5 text-[11px] text-muted">
                worktree 削除に失敗した残骸です。フォルダが既に無いものは設定を開いたときに自動削除されます。
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              busy={busy}
              disabled={orphans.length === 0 && stray.length === 0}
              onClick={() => void cleanupOrphans()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              orphan を掃除
            </Button>
          </div>
          <ul className="space-y-1 text-sm">
            {orphans.map((o) => (
              <li
                key={o.id}
                className="truncate rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning"
              >
                {o.displayName} · {o.absolutePath}
              </li>
            ))}
            {stray.map((s) => (
              <li
                key={s.path}
                className="truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"
              >
                stray ({s.projectName}): {s.path}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
