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
  CloudUpload,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button, DiffStat, Spinner, cx } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import type { DiffFile, DiffFilesPayload } from "@/lib/types";
import { tintCodeLine } from "@/lib/difftint";
import { suggestCommitMessage } from "@/lib/commit-message";

const MAX_LINES_PER_FILE = 500;

type BranchInfo = {
  current: string;
  branches: string[];
  defaultTarget: string | null;
  upstream?: string | null;
  ahead?: number;
  remotes?: string[];
  hasRemote?: boolean;
};

type SessionRow = {
  opencodeSessionId: string;
  title: string;
};

type SessionFilter = "all" | "current" | "external";

function FileDiffBlock({
  file,
  expanded,
  selected,
  sideBySide,
  busy,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  anchorRef,
  externalChange,
}: {
  file: DiffFile;
  expanded: boolean;
  selected: boolean;
  sideBySide: boolean;
  busy: boolean;
  onToggle: () => void;
  onSelect: (v: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  anchorRef?: (el: HTMLDivElement | null) => void;
  /** True when this file changed without this session's own tool calls
   * touching it — a possible parallel-session edit (AGENTS.md "並列セッション
   * 前提"). */
  externalChange?: boolean;
}) {
  const dir = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/") + 1)
    : "";
  const base = file.path.slice(dir.length);
  let rendered = 0;

  return (
    <div
      ref={anchorRef}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--accent)]"
          aria-label={`${file.path} をコミット対象にする`}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${file.path} の差分を${expanded ? "折りたたむ" : "展開"}`}
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
              新規
            </span>
          )}
          {file.binary && (
            <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted">
              バイナリ
            </span>
          )}
          {externalChange && (
            <span
              className="shrink-0 rounded-full border border-warning/30 bg-warning-bg px-2 py-0.5 text-[10px] text-warning"
              title="このセッションの編集操作では変更していません（並行編集の可能性）"
            >
              セッション外?
            </span>
          )}
          <span className="flex-1" />
          <DiffStat additions={file.additions} deletions={file.deletions} className="shrink-0" />
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            title="既定のエディタで開く（VSCode の場合はリポジトリを開いてアクティブタブ化）"
            aria-label={`${file.path} をエディタで開く`}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            title="ファイルを削除（コミット対象からも取り除きます）"
            aria-label={`${file.path} を削除`}
            onClick={onDelete}
            className="hover:bg-danger-bg hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
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
                        className="grid grid-cols-1 bg-diff-del-bg text-diff-del-text sm:grid-cols-2"
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
                        className="grid grid-cols-1 bg-diff-add-bg text-diff-add-text sm:grid-cols-2"
                      >
                        <div className="border-r border-border px-2" />
                        <div className="px-2 whitespace-pre">+{line.text || " "}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={li} className="grid grid-cols-1 text-muted sm:grid-cols-2">
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
  sessionId,
  agent,
  refreshKey,
  focusFile,
  onFocusHandled,
  onMutated,
  onFilesCountChange,
  touchedPaths,
}: {
  directory: string;
  workspaceId: string;
  sessionId?: string | null;
  agent?: string;
  refreshKey?: number;
  focusFile?: string | null;
  onFocusHandled?: () => void;
  onMutated?: () => void;
  /** Report the current visible file count (after type + session filtering)
   * so the parent can show it in the tab badge. */
  onFilesCountChange?: (count: number) => void;
  /** File paths (relative to `directory`) touched by this session's own
   * tool calls. Files changed outside this set are flagged as a possible
   * parallel-session edit. Omit or leave empty to skip the check. */
  touchedPaths?: Set<string>;
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
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [baseCompare, setBaseCompare] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLDivElement>());
  const reqIdRef = useRef(0);
  const metaReqIdRef = useRef(0);
  const actionGenerationRef = useRef(0);
  const actionBusyRef = useRef(false);
  const mountedRef = useRef(false);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqIdRef.current += 1;
      metaReqIdRef.current += 1;
      actionGenerationRef.current += 1;
      actionBusyRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string> = { directory };
      if (baseCompare) query.base = baseCompare;
      const data = await getJson<DiffFilesPayload>("/api/diff/files", query);
      if (!mountedRef.current || id !== reqIdRef.current) return;
      setPayload(data);
      setExpanded((prev) => {
        // Keep manual choices, but start with every file minimized so the
        // changed-file list stays compact and scannable.
        const next: Record<string, boolean> = {};
        for (const f of data.files) {
          next[f.path] = prev[f.path] ?? false;
        }
        return next;
      });
    } catch (err) {
      if (!mountedRef.current || id !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : "diff の取得に失敗しました");
    } finally {
      if (mountedRef.current && id === reqIdRef.current) setLoading(false);
    }
  }, [directory, baseCompare]);

  useEffect(() => {
    // Drop in-flight diffs and clear the list so commit cannot target a stale
    // workspace's paths after a directory switch (GraphPanel / FileTree pattern).
    reqIdRef.current += 1;
    actionGenerationRef.current += 1;
    setPayload(null);
    setError(null);
    setExpanded({});
    setDeselected({});
    setNotice(null);
    setCommitMsg("");
    setPrTitle("");
    setBaseCompare("");
    setMergeTarget("");
    setPanel(null);
  }, [directory]);

  useEffect(() => {
    let active = true;
    setSessions([]);
    void getJson<{ sessions?: SessionRow[] }>(
      `/api/workspaces/${workspaceId}/sessions`,
    )
      .then((data) => {
        if (active) setSessions(data.sessions ?? []);
      })
      .catch(() => {
        // The diff remains useful when session metadata is unavailable.
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const loadMergeMeta = useCallback(async () => {
    const id = ++metaReqIdRef.current;
    const dir = directory;
    try {
      const info = await getJson<BranchInfo>("/api/git/branches", { directory: dir });
      if (id !== metaReqIdRef.current || directoryRef.current !== dir) return;
      setBranches(info);
      setMergeTarget((cur) => cur || info.defaultTarget || "");
    } catch {
      /* non-git dir */
    }
    try {
      const pr = await getJson<{ available: boolean }>("/api/git/pr", {
        directory: dir,
      });
      if (id !== metaReqIdRef.current || directoryRef.current !== dir) return;
      setPrAvailable(Boolean(pr.available));
    } catch {
      if (id !== metaReqIdRef.current || directoryRef.current !== dir) return;
      setPrAvailable(false);
    }
  }, [directory]);

  useEffect(() => {
    metaReqIdRef.current += 1;
    setBranches(null);
    setPrAvailable(null);
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
    const byType =
      filter === "untracked"
        ? all.filter((f) => f.untracked)
        : filter === "tracked"
          ? all.filter((f) => !f.untracked)
          : all;
    if (sessionFilter === "all" || !touchedPaths?.size) return byType;
    return byType.filter((f) =>
      sessionFilter === "current" ? touchedPaths.has(f.path) : !touchedPaths.has(f.path),
    );
  }, [payload, filter, sessionFilter, touchedPaths]);
  const hasChanges = files.length > 0;

  // Propagate the visible file count to the parent so the tab badge stays in
  // sync with the filtered list (not the stale dirstat cache).
  useEffect(() => {
    onFilesCountChange?.(files.length);
  }, [files.length, onFilesCountChange]);

  const currentSession = sessions.find((s) => s.opencodeSessionId === sessionId);
  const hasSessionOwnership = Boolean(touchedPaths?.size);
  const selectedPaths = useMemo(
    () => files.filter((f) => !deselected[f.path]).map((f) => f.path),
    [files, deselected],
  );
  const allExpanded = files.length > 0 && files.every((f) => expanded[f.path]);

  const run = useCallback(
    async (fn: () => Promise<string>) => {
      if (actionBusyRef.current) return;
      const generation = actionGenerationRef.current;
      actionBusyRef.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const message = await fn();
        if (!mountedRef.current || generation !== actionGenerationRef.current) return;
        setNotice(message);
        setPanel(null);
        await load();
        await loadMergeMeta();
        onMutated?.();
      } catch (err) {
        if (!mountedRef.current || generation !== actionGenerationRef.current) return;
        setError(err instanceof Error ? err.message : "操作に失敗しました");
      } finally {
        actionBusyRef.current = false;
        if (mountedRef.current && generation === actionGenerationRef.current) {
          setBusy(false);
        }
      }
    },
    [load, loadMergeMeta, onMutated],
  );

  const commit = () =>
    run(async () => {
      // Guard against directory-switch races: payload null makes
      // `selectedPaths.length === (payload?.files.length ?? 0)` true as 0===0
      // and would send all:true against the new directory.
      if (!payload || selectedPaths.length === 0) {
        throw new Error("コミットする変更がありません");
      }
      const body: Record<string, unknown> = {
        directory,
        message: commitMsg.trim(),
        // Let the server stamp the executing agent as the commit author so the
        // graph always shows who performed the commit.
        agent,
      };
      // Only "commit everything" (git add -A) when the entire UNFILTERED set is
      // selected. `files` is filter-scoped, so comparing against it would let a
      // full selection of a filtered view stage files hidden by the filter.
      if (selectedPaths.length === payload.files.length) body.all = true;
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
      const res = await sendJson<{
        summary?: string;
        merged?: string;
        into?: string;
        restored?: string | null;
      }>("POST", "/api/git/merge", {
        directory,
        branch: mergeTarget,
        into,
        noFf: true,
      });
      // Only archive after into=branch when the worktree was restored to the
      // feature branch. A successful merge that left HEAD on main must not
      // look like a completed handoff.
      let archiveWarning = "";
      if (into === "branch" && workspaceId && res.restored) {
        try {
          await sendJson("PATCH", "/api/workspaces", {
            id: workspaceId,
            status: "archived",
          });
        } catch (err) {
          // The merge succeeded; surface the archive failure instead of
          // swallowing it so the card doesn't silently stay active.
          archiveWarning = `（ただしアーカイブに失敗: ${
            err instanceof Error ? err.message : "不明なエラー"
          }）`;
        }
      }
      const base = res.summary || `マージしました: ${res.merged} → ${res.into}`;
      return archiveWarning ? `${base}${archiveWarning}` : base;
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

  const push = () =>
    run(async () => {
      const hasUpstream = Boolean(branches?.upstream);
      const res = await sendJson<{ summary?: string }>(
        "POST",
        "/api/git/push",
        {
          directory,
          // First push on a branch with no upstream needs `-u` so the local
          // branch is wired to the remote ref; subsequent pushes don't.
          setUpstream: !hasUpstream,
        },
      );
      return `プッシュしました: ${res.summary ?? ""}`;
    });

  const openInEditor = (filePath: string) =>
    run(async () => {
      const res = await sendJson<{ editor?: "vscode" | "default" }>(
        "POST",
        "/api/files/open",
        { directory, path: filePath },
      );
      return res?.editor === "vscode"
        ? `VSCode で開きました: ${filePath}`
        : `既定のエディタで開きました: ${filePath}`;
    });

  const deleteFile = (filePath: string) => {
    if (
      !window.confirm(
        `ファイルを削除しますか？\n${filePath}\n（コミット対象からも取り除かれます）`,
      )
    ) {
      return;
    }
    void run(async () => {
      await sendJson("POST", "/api/git/rm", { directory, path: filePath });
      return `削除しました: ${filePath}`;
    });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div className="shrink-0 border-b border-border bg-surface-2 px-3 py-2 text-[11px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <span className="shrink-0 font-semibold text-muted">変更の所有者</span>
            <span className="min-w-0 truncate text-text" title={currentSession?.title || agent || undefined}>
              {currentSession?.title || agent || "現在のセッション"}
            </span>
          </div>
          <div className="flex min-w-0 max-w-full shrink-0 items-center gap-2">
            <span className="shrink-0 font-semibold text-muted">Session ID</span>
            <code className="min-w-0 max-w-full truncate rounded bg-surface px-1.5 py-0.5 font-mono text-faint" title={sessionId ?? "未接続"}>
              {sessionId ?? "未接続"}
            </code>
          </div>
          {sessions.length > 1 && (
            <span className="shrink-0 text-faint">同一ワークスペース: {sessions.length} セッション</span>
          )}
        </div>
        {sessions.length > 1 && (
          <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-faint" aria-label="同一ワークスペースのセッション">
            {sessions.map((session) => (
              <span key={session.opencodeSessionId} className={cx(session.opencodeSessionId === sessionId && "font-semibold text-text")} title={session.title}>
                {session.opencodeSessionId === sessionId ? "現在: " : "別: "}{session.title || session.opencodeSessionId.slice(0, 10)} ({session.opencodeSessionId.slice(0, 10)})
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Action bar */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-surface px-3 py-2">
        <span className="mr-1 shrink-0 text-xs font-semibold text-muted">変更</span>
        {payload && (
          <DiffStat additions={payload.additions} deletions={payload.deletions} className="shrink-0" />
        )}
        <span className="min-w-2 flex-1" />
        {branches && branches.branches.length > 0 && (
          <select
            value={baseCompare}
            onChange={(e) => {
              setBaseCompare(e.target.value);
              if (e.target.value && panel === "commit") setPanel(null);
            }}
            title="比較の基準（選択したブランチとの分岐点から比較）"
            aria-label="比較の基準ブランチ"
            className={cx(
              "h-8 min-w-0 max-w-full flex-[1_1_9rem] cursor-pointer rounded-lg border px-2 text-[11px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:max-w-[11rem]",
              baseCompare
                ? "border-border-strong bg-surface text-fg"
                : "border-border bg-surface-2 text-muted",
            )}
          >
            <option value="">未コミット変更</option>
            {branches.branches
              .filter((b) => b !== branches.current)
              .map((b) => (
                <option key={b} value={b}>
                  vs {b}
                </option>
              ))}
          </select>
        )}
        <select
          value={filter}
          onChange={(e) =>
            setFilter(e.target.value as "all" | "tracked" | "untracked")
          }
          title="表示する変更の種類"
          aria-label="表示する変更の種類"
          className="h-8 min-w-0 max-w-full flex-[1_1_8rem] cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-[11px] text-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:max-w-[9.5rem]"
        >
          <option value="all">すべての変更</option>
          <option value="tracked">既存の変更</option>
          <option value="untracked">新規ファイル</option>
        </select>
        <select
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value as SessionFilter)}
          title={hasSessionOwnership ? "変更したセッションで絞り込む" : "セッション別の変更情報はまだありません"}
          aria-label="表示するセッションの変更"
          className="h-8 min-w-0 max-w-full flex-[1_1_8rem] cursor-pointer rounded-lg border border-border bg-surface-2 px-2 text-[11px] text-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:max-w-[10rem]"
        >
          <option value="all">全セッションの変更</option>
          <option value="current" disabled={!hasSessionOwnership}>現在のセッション</option>
          <option value="external" disabled={!hasSessionOwnership}>別セッション・未特定</option>
        </select>
        <Button
          variant={sideBySide ? "secondary" : "ghost"}
          size="sm"
          className="inline-flex"
          title="左右に並べて差分表示"
          onClick={() => setSideBySide((v) => !v)}
        >
          並列表示
        </Button>
        <Button
          variant={panel === "commit" ? "secondary" : "ghost"}
          size="sm"
          aria-label="Commit パネル"
          disabled={!hasChanges || !!baseCompare}
          title={
            baseCompare
              ? "ブランチ比較中はコミットできません（未コミット変更に切替）"
              : undefined
          }
          onClick={() => setPanel(panel === "commit" ? null : "commit")}
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Commit</span>
        </Button>
        <Button
          variant={panel === "merge" ? "secondary" : "ghost"}
          size="sm"
          className="inline-flex"
          aria-label="Merge パネル"
          onClick={() => setPanel(panel === "merge" ? null : "merge")}
        >
          <GitMerge className="h-3.5 w-3.5" />
          Merge
        </Button>
        <Button
          variant={panel === "pr" ? "secondary" : "ghost"}
          size="sm"
          className="inline-flex"
          aria-label="PR パネル"
          disabled={prAvailable === false}
          title={prAvailable === false ? "gh CLI が必要です" : undefined}
          onClick={() => setPanel(panel === "pr" ? null : "pr")}
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          PR
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="inline-flex"
          aria-label="現在のブランチをプッシュ"
          disabled={
            !branches?.hasRemote ||
            busy ||
            hasChanges ||
            (branches?.ahead !== undefined && branches.ahead <= 0)
          }
          title={
            !branches?.hasRemote
              ? "リモートが設定されていません"
              : hasChanges
                ? "先にコミットしてください"
                : branches?.upstream
                  ? branches.ahead && branches.ahead > 0
                    ? `${branches.ahead} コミットをプッシュ`
                    : "プッシュするコミットはありません"
                  : branches?.hasRemote
                    ? "初回プッシュ（upstream を設定）"
                    : "リモートが設定されていません"
          }
          onClick={() => void push()}
        >
          <CloudUpload className="h-3.5 w-3.5" />
          Push
          {branches?.ahead && branches.ahead > 0 ? ` (${branches.ahead})` : ""}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={allExpanded ? "すべて折りたたむ" : "すべて展開"}
          aria-label={allExpanded ? "すべて折りたたむ" : "すべて展開"}
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
        <Button
          variant="ghost"
          size="icon"
          title="更新"
          aria-label="差分を更新"
          busy={loading}
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw className={cx("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Inline action panels */}
      {panel === "commit" && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-3 py-2 sm:flex-row sm:items-center">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            aria-label="コミットメッセージ"
            placeholder="コミットメッセージ"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                commitMsg.trim() &&
                selectedPaths.length > 0 &&
                payload
              ) {
                void commit();
              }
            }}
          />
          <Button
            variant="ghost"
            size="md"
            className="w-full shrink-0 sm:w-auto"
            disabled={selectedPaths.length === 0}
            title="選択したファイルからメッセージ案を生成"
            onClick={async () => {
              const selectedFiles = files.filter((f) => !deselected[f.path]);
              try {
                const result = await sendJson<{ message: string }>(
                  "POST",
                  "/api/git/commit-message",
                  { directory, files: selectedFiles },
                );
                setCommitMsg(result.message);
              } catch {
                setCommitMsg(
                  suggestCommitMessage(
                    selectedFiles.map((f) => ({ path: f.path, untracked: f.untracked })),
                  ),
                );
              }
            }}
          >
            生成
          </Button>
          <Button
            variant="primary"
            size="md"
            className="w-full shrink-0 sm:w-auto"
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
            aria-label="マージ先ブランチ"
            className="h-9 min-w-32 flex-1 cursor-pointer rounded-lg border border-border bg-bg px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-3 py-2 sm:flex-row sm:items-center">
          <input
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            aria-label="PR タイトル"
            placeholder="PR タイトル"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-border-strong"
          />
          <Button
            variant="primary"
            size="md"
            className="w-full shrink-0 sm:w-auto"
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
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
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
      <div
        className="min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto p-3"
        aria-busy={loading || undefined}
      >
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
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-faint" role="status" aria-live="polite">
              {payload.error ||
                (payload.files.length === 0
                  ? "変更はありません"
                  : sessionFilter !== "all" && touchedPaths?.size
                    ? sessionFilter === "current"
                      ? "このセッションが変更したファイルはありません（別セッション・外部の変更があります）"
                      : "別セッション・外部の変更はありません（このセッションの変更があります）"
                    : `${filter === "tracked" ? "既存の変更" : "新規ファイル"}はありません`)}
            </p>
            {payload.files.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilter("all");
                  setSessionFilter("all");
                }}
              >
                すべて表示
              </Button>
            )}
          </div>
        )}
        {files.map((f) => (
          <FileDiffBlock
            key={f.path}
            file={f}
            expanded={Boolean(expanded[f.path])}
            selected={!deselected[f.path]}
            sideBySide={sideBySide}
            busy={busy}
            onToggle={() =>
              setExpanded((prev) => ({ ...prev, [f.path]: !prev[f.path] }))
            }
            onSelect={(v) =>
              setDeselected((prev) => ({ ...prev, [f.path]: !v }))
            }
            onEdit={() => void openInEditor(f.path)}
            onDelete={() => deleteFile(f.path)}
            anchorRef={(el) => {
              if (el) fileRefs.current.set(f.path, el);
              else fileRefs.current.delete(f.path);
            }}
            externalChange={
              touchedPaths !== undefined &&
              touchedPaths.size > 0 &&
              !touchedPaths.has(f.path)
            }
          />
        ))}
      </div>
    </div>
  );
}
