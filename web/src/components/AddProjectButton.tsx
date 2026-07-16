"use client";

import { useState } from "react";
import { FolderPlus, Keyboard } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { sendJson } from "@/lib/client";
import type { ProjectDto } from "@/lib/types";

type Props = {
  onAdded?: (project: ProjectDto) => void;
  /** compact icon-only for sidebar chrome */
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
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async (rootPath: string) => {
    const data = await sendJson<{ project: ProjectDto }>("POST", "/api/projects", {
      rootPath,
    });
    notifyTasksChanged();
    onAdded?.(data.project);
    return data.project;
  };

  const pickFolder = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/browse/folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "プロジェクトフォルダを選択" }),
      });
      const data = (await res.json()) as {
        path?: string;
        cancelled?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "フォルダ選択に失敗しました");
        if (variant !== "icon") setManualOpen(true);
        return;
      }
      if (data.cancelled || !data.path) return;
      await create(data.path);
      setManualOpen(false);
      setManualPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
      if (variant !== "icon") setManualOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    const p = manualPath.trim();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await create(p);
      setManualOpen(false);
      setManualPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        title={label}
        disabled={busy}
        onClick={() => void pickFolder()}
        className={cx(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50",
          className,
        )}
      >
        <FolderPlus className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => void pickFolder()}>
          <FolderPlus className="h-4 w-4" />
          {label}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setManualOpen((v) => !v)}
          title="パスを手入力"
        >
          <Keyboard className="h-3.5 w-3.5" />
          パス入力
        </Button>
      </div>

      {manualOpen && (
        <div className="flex gap-2">
          <input
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="C:\path\to\repo"
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitManual();
            }}
          />
          <Button size="sm" busy={busy} onClick={() => void submitManual()}>
            追加
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger-bg px-2 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
