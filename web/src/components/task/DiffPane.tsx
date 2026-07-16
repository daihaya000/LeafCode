"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import { Button, DiffStat, Spinner, cx } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import type { DiffFile, DiffFilesPayload } from "@/lib/types";
import { tintCodeLine } from "@/lib/difftint";

const MAX_LINES_PER_FILE = 500;

type BranchInfo = {
  current: string;
  branches: string[];
  defaultTarget: string | null;
};

function FileDiffBlock({
  file,
  expanded,
  selected,
  sideBySide,
  onToggle,
  onSelect,
  anchorRef,
}: {
  file: DiffFile;
  expanded: boolean;
  selected: boolean;
  sideBySide: boolean;
  onToggle: () => void;
  onSelect: (v: boolean) => void;
  anchorRef?: (el: HTMLDivElement | null) => void;
}) {
  const dir = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/") + 1)
    : "";
  const base = file.path.slice(dir.length);
  let rendered = 0;

  return (
    <div
      ref={anchorRef}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex w-full items-center gap-2 px-2.5 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
          aria-label={`${file.path} をコミット対象にする`}
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cx(
              "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate font-mono text-xs">
            <span className="text-faint">{dir}</span>
            <span className="text-text">{base}</span>
          </span>
          {file.untracked && (
            <span className="shrink-0 rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-medium text-success">
              new
            </span>
          )}
          {file.binary && (
            <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted">
              binary
            </span>
          )}
          <span className="flex-1" />
          <DiffStat additions={file.additions} deletions={file.deletions} />
        </button>
      </div>
      {expanded && !file.binary && file.hunks.length > 0 && (
        <div className="overflow-x-auto border-t border-border font-mono text-xs leading-5">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="bg-diff-hunk-bg px-3 py-0.5 text-faint select-none">
                {hunk.header}
              </div>
              {hunk.lines.map((line, li) => {
                if (rendered >= MAX_LINES_PER_FILE) return null;
                rendered += 1;
                if (sideBySide) {
                  if (line.t === "-") {
                    return (
                      <div
                        key={li}
                        className="grid grid-cols-2 bg-diff-del-bg text-diff-del-text"
                      >
                        <div className="border-r border-border px-2 whitespace-pre">
                          -{line.text || " "}
                        </div>
                        <div className="px-2" />
                      </div>
                    );
                  }
                  if (line.t === "+") {
                    return (
                      <div
                        key={li}
                        className="grid grid-cols-2 bg-diff-add-bg text-diff-add-text"
                      >
                        <div className="border-r border-border px-2" />
                        <div className="px-2 whitespace-pre">+{line.text || " "}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={li} className="grid grid-cols-2 text-muted">
                      <div className="border-r border-border px-2 whitespace-pre">
                        {line.text || " "}
                      </div>
                      <div className="px-2 whitespace-pre">{line.text || " "}</div>
                    </div>
                  );
                }
                return (
                  <div
                    key={li}
                    className={cx(
                      "flex px-3 whitespace-pre",
                      line.t === "+" && "bg-diff-add-bg text-diff-add-text",
                      line.t === "-" && "bg-diff-del-bg text-diff-del-text",
                      line.t === " " && "text-muted",
                    )}
                  >
                    <span className="w-4 shrink-0 select-none">
                      {line.t === " " ? "" : line.t}
                    </span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: tintCodeLine(line.text || " ", file.path),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          {rendered >= MAX_LINES_PER_FILE && (
            <p className="px-3 py-1.5 text-faint">
              …長いため省略（{MAX_LINES_PER_FILE}行まで表示）
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function DiffPane({
  directory,
  workspaceId,
  refreshKey,
  focusFile,
  onFocusHandled,
  onMutated,
}: {
  directory: string;
  workspaceId?: string;
  refreshKey: number;
  focusFile?: string | null;
  onFocusHandled?: () => void;
  onMutated?: () => void;
}) {
  const [payload, setPayload] = useState<DiffFilesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deselected, setDeselected] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<null | "commit" | "merge" | "pr">(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prAvailable, setPrAvailable] = useState<boolean | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const [filter, setFilter] = useState<"all" | "tracked" | "untracked">("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<DiffFilesPayload>("/api/diff/files", {
        directory,
      });
      setPayload(data);
      setExpanded((prev) => {
        // keep manual choices; default-expand when few files
        const next: Record<string, boolean> = {};
        for (const f of data.files) {
          next[f.path] = prev[f.path] ?? data.files.length <= 8;
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "diff の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [directory]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const loadMergeMeta = useCallback(async () => {
    try {
      const info = await getJson<BranchInfo>("/api/git/branches", { directory });
      setBranches(info);
      setMergeTarget((cur) => cur || info.defaultTarget || "");
    } catch {
      /* non-git dir */
    }
    try {
      const pr = await getJson<{ available: boolean }>("/api/git/pr", {
        directory,
      });
      setPrAvailable(Boolean(pr.available));
    } catch {
      setPrAvailable(false);
    }
  }, [directory]);

  useEffect(() => {
    void loadMergeMeta();
  }, [loadMergeMeta]);

  // Jump to a file requested from the timeline (patch/file chips)
  useEffect(() => {
    if (!focusFile || !payload) return;
    const needle = focusFile.replace(/\\/g, "/").toLowerCase();
    const hit = payload.files.find((f) => {
      const p = f.path.toLowerCase();
      return p === needle || p.endsWith("/" + needle) || needle.endsWith("/" + p) || p.includes(needle);
    });
    if (hit) {
      setExpanded((prev) => ({ ...prev, [hit.path]: true }));
      requestAnimationFrame(() => {
        fileRefs.current
          .get(hit.path)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    onFocusHandled?.();
  }, [focusFile, payload, onFocusHandled]);

  const files = useMemo(() => {
    const all = payload?.files ?? [];
    if (filter === "untracked") return all.filter((f) => f.untracked);
    if (filter === "tracked") return all.filter((f) => !f.untracked);
    return all;
  }, [payload, filter]);
  const hasChanges = files.length > 0;
  const selectedPaths = useMemo(
    () => files.filter((f) => !deselected[f.path]).map((f) => f.path),
    [files, deselected],
  );
  const allExpanded = files.length > 0 && files.every((f) => expanded[f.path]);

  const run = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const message = await fn();
        setNotice(message);
        setPanel(null);
        await load();
        await loadMergeMeta();
        onMutated?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "操作に失敗しました");
      } finally {
        setBusy(false);
      }
    },
    [load, loadMergeMeta, onMutated],
  );

  const commit = () =>
    run(async () => {
      const body: Record<string, unknown> = {
        directory,
        message: commitMsg.trim(),
      };
      if (selectedPaths.length === files.length) body.all = true;
      else body.paths = selectedPaths;
      const res = await sendJson<{ summary?: string }>(
        "POST",
        "/api/git/commit",
        body,
      );
      setCommitMsg("");
      return `コミットしました: ${res.summary ?? ""}`;
    });

  const merge = (into: "current" | "branch") =>
    run(async () => {
      const res = await sendJson<{ summary?: string; merged?: string; into?: string }>(
        "POST",
        "/api/git/merge",
        { directory, branch: mergeTarget, into, noFf: true },
      );
      if (into === "branch" && workspaceId) {
        await sendJson("PATCH", "/api/workspaces", {
          id: workspaceId,
          status: "archived",
        }).catch(() => undefined);
      }
      return res.summary || `マージしました: ${res.merged} → ${res.into}`;
    });

  const createPr = () =>
    run(async () => {
      const res = await sendJson<{ url?: string }>("POST", "/api/git/pr", {
        directory,
        title: prTitle.trim(),
        base: mergeTarget || undefined,
        push: true,
      });
      setPrTitle("");
      return res.url ? `PR: ${res.url}` : "PR を作成しました";
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      {/* Action bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-surface px-3 py-2">
        <span className="mr-1 text-xs font-semibold text-muted">変更</span>
        {payload && (
          <DiffStat additions={payload.additions} deletions={payload.deletions} />
        )}
        <span className="flex-1" />
        <select
          value={filter}
          onChange={(e) =>
            setFilter(e.target.value as "all" | "tracked" | "untracked")
          }
          className="h-8 cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-[11px] text-muted outline-none"
        >
          <option value="all">すべて</option>
          <option value="tracked">tracked</option>
          <option value="untracked">untracked</option>
        </select>
        <Button
          variant={sideBySide ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSideBySide((v) => !v)}
        >
          並列
        </Button>
        <Button
          variant={panel === "commit" ? "secondary" : "ghost"}
          size="sm"
          disabled={!hasChanges}
          onClick={() => setPanel(panel === "commit" ? null : "commit")}
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Commit
        </Button>
        <Button
          variant={panel === "merge" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setPanel(panel === "merge" ? null : "merge")}
        >
          <GitMerge className="h-3.5 w-3.5" />
          Merge
        </Button>
        <Button
          variant={panel === "pr" ? "secondary" : "ghost"}
          size="sm"
          disabled={prAvailable === false}
          title={prAvailable === false ? "gh CLI が必要です" : undefined}
          onClick={() => setPanel(panel === "pr" ? null : "pr")}
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          PR
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={allExpanded ? "すべて折りたたむ" : "すべて展開"}
          onClick={() =>
            setExpanded(Object.fromEntries(files.map((f) => [f.path, !allExpanded])))
          }
        >
          {allExpanded ? (
            <ChevronsDownUp className="h-4 w-4" />
          ) : (
            <ChevronsUpDown className="h-4 w-4" />
          )}
        </Button>
        <Button variant="ghost" size="icon" title="更新" onClick={() => void load()}>
          <RefreshCw className={cx("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Inline action panels */}
      {panel === "commit" && (
        <div className="flex shrink-0 gap-2 border-b border-border bg-surface px-3 py-2">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="コミットメッセージ"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
            onKeyDown={(e) => {
              if (e.key === "Enter" && commitMsg.trim()) void commit();
            }}
          />
          <Button
            variant="primary"
            size="md"
            busy={busy}
            disabled={!commitMsg.trim() || selectedPaths.length === 0}
            onClick={() => void commit()}
          >
            コミット ({selectedPaths.length})
          </Button>
        </div>
      )}
      {panel === "merge" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <span className="font-mono text-xs text-muted">
            {branches?.current ?? "?"}
          </span>
          <select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            className="h-9 min-w-32 flex-1 cursor-pointer rounded-lg border border-border bg-bg px-2 text-sm outline-none"
          >
            <option value="">ブランチを選択</option>
            {(branches?.branches ?? [])
              .filter((b) => b !== branches?.current)
              .map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            busy={busy}
            disabled={!mergeTarget || hasChanges}
            title={hasChanges ? "先にコミットしてください" : `${mergeTarget} を現在のブランチへ取り込む`}
            onClick={() => void merge("current")}
          >
            取り込む ←
          </Button>
          <Button
            size="sm"
            busy={busy}
            disabled={!mergeTarget || hasChanges}
            title={hasChanges ? "先にコミットしてください" : `現在のブランチを ${mergeTarget} へマージ`}
            onClick={() => void merge("branch")}
          >
            → 反映する
          </Button>
        </div>
      )}
      {panel === "pr" && (
        <div className="flex shrink-0 gap-2 border-b border-border bg-surface px-3 py-2">
          <input
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder="PR タイトル"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
          />
          <Button
            variant="primary"
            size="md"
            busy={busy}
            disabled={!prTitle.trim() || hasChanges}
            title={hasChanges ? "先にコミットしてください" : undefined}
            onClick={() => void createPr()}
          >
            PR 作成
          </Button>
        </div>
      )}

      {(notice || error) && (
        <div
          className={cx(
            "shrink-0 border-b px-3 py-2 text-xs break-all",
            error
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-success/30 bg-success-bg text-success",
          )}
        >
          {error ?? (
            <span className="inline-flex items-center gap-1">
              {notice}
              {notice?.includes("http") && (
                <a
                  href={/https?:\/\/\S+/.exec(notice)?.[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center underline"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>
          )}
        </div>
      )}

      {/* File list */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!payload && loading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {payload && !payload.git && (
          <p className="py-10 text-center text-sm text-faint">
            {payload.error || "Git リポジトリではありません"}
          </p>
        )}
        {payload?.git && files.length === 0 && (
          <p className="py-10 text-center text-sm text-faint">変更はありません</p>
        )}
        {files.map((f) => (
          <FileDiffBlock
            key={f.path}
            file={f}
            expanded={Boolean(expanded[f.path])}
            selected={!deselected[f.path]}
            sideBySide={sideBySide}
            onToggle={() =>
              setExpanded((prev) => ({ ...prev, [f.path]: !prev[f.path] }))
            }
            onSelect={(v) =>
              setDeselected((prev) => ({ ...prev, [f.path]: !v }))
            }
            anchorRef={(el) => {
              if (el) fileRefs.current.set(f.path, el);
              else fileRefs.current.delete(f.path);
            }}
          />
        ))}
      </div>
    </div>
  );
}
