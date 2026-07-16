"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  GitBranch,
  GitGraph,
  RefreshCw,
} from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { getJson } from "@/lib/client";
import { layoutGraph, pickBranchBadges, LANE_COLORS, type GraphRow } from "@/lib/graph-layout";
import type {
  GraphFileChange,
  GraphLogPayload,
  GraphShowPayload,
} from "@/lib/types";

const LANE_W = 14;
const ROW_H = 36;
const DOT_R = 4;

const LANE_STROKE = [
  "var(--accent)",
  "var(--working)",
  "var(--warning)",
  "var(--success)",
  "var(--danger)",
  "var(--muted)",
];

function laneStroke(color: number): string {
  return LANE_STROKE[color % LANE_COLORS] ?? LANE_STROKE[0];
}

function statusTone(s: GraphFileChange["status"]): string {
  if (s === "A") return "bg-success-bg text-success";
  if (s === "D") return "bg-danger-bg text-danger";
  if (s === "M" || s === "R" || s === "C" || s === "T")
    return "bg-warning-bg text-warning";
  return "bg-surface-3 text-muted";
}

function GraphCell({ row }: { row: GraphRow }) {
  const w = Math.max(row.laneCount, 1) * LANE_W + 8;
  const midY = ROW_H / 2;
  const x = (lane: number) => 8 + lane * LANE_W + LANE_W / 2;
  const nodeStroke = laneStroke(row.color);

  return (
    <svg
      width={w}
      height={ROW_H}
      className="shrink-0 overflow-visible"
      aria-hidden
    >
      {row.passes.map((p) => (
        <line
          key={`pass-${p.lane}`}
          x1={x(p.lane)}
          y1={0}
          x2={x(p.lane)}
          y2={ROW_H}
          fill="none"
          stroke={laneStroke(p.color)}
          strokeWidth={2}
        />
      ))}
      {/* rail into commit */}
      <line
        x1={x(row.lane)}
        y1={0}
        x2={x(row.lane)}
        y2={midY}
        fill="none"
        stroke={nodeStroke}
        strokeWidth={2}
      />
      {/* continue first-parent downward */}
      {row.commit.parents.length > 0 && (
        <line
          x1={x(row.lane)}
          y1={midY}
          x2={x(row.lane)}
          y2={ROW_H}
          fill="none"
          stroke={nodeStroke}
          strokeWidth={2}
        />
      )}
      {row.edges.map((e, i) => {
        if (e.half === "upper") {
          // side lane from above curves into this commit
          return (
            <path
              key={`e-${i}`}
              d={`M ${x(e.fromLane)} 0 C ${x(e.fromLane)} ${midY * 0.55}, ${x(e.toLane)} ${midY * 0.45}, ${x(e.toLane)} ${midY}`}
              fill="none"
              stroke={laneStroke(e.color)}
              strokeWidth={2}
            />
          );
        }
        // fork from this commit down toward extra parent lane
        return (
          <path
            key={`e-${i}`}
            d={`M ${x(e.fromLane)} ${midY} C ${x(e.fromLane)} ${midY + (ROW_H - midY) * 0.45}, ${x(e.toLane)} ${midY + (ROW_H - midY) * 0.55}, ${x(e.toLane)} ${ROW_H}`}
            fill="none"
            stroke={laneStroke(e.color)}
            strokeWidth={2}
          />
        );
      })}
      <circle
        cx={x(row.lane)}
        cy={midY}
        r={row.commit.parents.length > 1 ? DOT_R + 1 : DOT_R}
        fill="var(--bg)"
        stroke={nodeStroke}
        strokeWidth={row.commit.parents.length > 1 ? 2.5 : 2}
      />
    </svg>
  );
}

export function GraphPanel({ directory }: { directory: string }) {
  const [payload, setPayload] = useState<GraphLogPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filesByCommit, setFilesByCommit] = useState<
    Record<string, GraphFileChange[]>
  >({});
  const [fileDiff, setFileDiff] = useState<{
    commit: string;
    path: string;
    text: string;
  } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const commitCountRef = useRef(0);

  const load = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = Boolean(opts?.append);
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const skipCount = append ? commitCountRef.current : 0;
        const data = await getJson<GraphLogPayload>("/api/git/log", {
          directory,
          limit: "80",
          skip: String(skipCount),
        });
        setPayload((prev) => {
          const next =
            append && prev
              ? {
                  ...data,
                  commits: [...prev.commits, ...data.commits],
                  refs: data.refs,
                }
              : data;
          commitCountRef.current = next.commits.length;
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "ログの取得に失敗しました");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [directory],
  );

  useEffect(() => {
    setPayload(null);
    setExpanded(null);
    setFilesByCommit({});
    setFileDiff(null);
    commitCountRef.current = 0;
    void load();
  }, [directory, load]);

  const rows = useMemo(
    () => (payload ? layoutGraph(payload.commits) : []),
    [payload],
  );

  const refsByHash = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of payload?.refs ?? []) {
      const list = map.get(r.hash) ?? [];
      list.push(r.name);
      map.set(r.hash, list);
    }
    return map;
  }, [payload?.refs]);

  const toggleExpand = async (hash: string) => {
    if (expanded === hash) {
      setExpanded(null);
      setFileDiff(null);
      return;
    }
    setExpanded(hash);
    setFileDiff(null);
    if (filesByCommit[hash]) return;
    try {
      const data = await getJson<GraphShowPayload>("/api/git/show", {
        directory,
        commit: hash,
      });
      setFilesByCommit((prev) => ({
        ...prev,
        [hash]: data.files ?? [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "コミット詳細の取得に失敗");
    }
  };

  const openFileDiff = async (commit: string, path: string) => {
    if (fileDiff?.commit === commit && fileDiff.path === path) {
      setFileDiff(null);
      return;
    }
    setFileBusy(true);
    try {
      const data = await getJson<GraphShowPayload>("/api/git/show", {
        directory,
        commit,
        file: path,
      });
      setFileDiff({ commit, path, text: data.diff ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "diff の取得に失敗");
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
        <GitGraph className="h-3.5 w-3.5 text-muted" />
        <span className="text-xs font-semibold text-muted">グラフ</span>
        {payload?.currentBranch && (
          <span
            title={payload.currentBranch}
            className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text"
          >
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            {payload.currentBranch}
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          title="更新"
          className="h-7 w-7"
          onClick={() => void load()}
        >
          <RefreshCw className={cx("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !payload && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {error && (
          <p className="border-b border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {payload && rows.length === 0 && !loading && (
          <p className="py-10 text-center text-sm text-faint">
            コミットがありません
          </p>
        )}
        {rows.map((row) => {
          const refs = refsByHash.get(row.commit.hash) ?? [];
          const { shown, more } = pickBranchBadges(
            refs,
            payload?.currentBranch ?? null,
            2,
          );
          const open = expanded === row.commit.hash;
          const files = filesByCommit[row.commit.hash];
          return (
            <div
              key={row.commit.hash}
              className={cx(
                "border-b border-border/60",
                open && "bg-surface-2/60",
              )}
            >
              <button
                type="button"
                onClick={() => void toggleExpand(row.commit.hash)}
                className="flex w-full cursor-pointer items-stretch gap-1 px-1 py-0 text-left hover:bg-surface-2"
                style={{ minHeight: ROW_H }}
              >
                <GraphCell row={row} />
                <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2">
                  <ChevronRight
                    className={cx(
                      "h-3 w-3 shrink-0 text-faint transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-text">
                      {row.commit.subject || "(no subject)"}
                    </div>
                    <div className="truncate text-[10px] text-faint">
                      {row.commit.author}
                      <span className="mx-1">·</span>
                      <span className="font-mono">{row.commit.shortHash}</span>
                    </div>
                  </div>
                  {shown.map((name) => (
                    <span
                      key={name}
                      title={name}
                      className={cx(
                        "inline-flex max-w-[7rem] shrink-0 items-center gap-0.5 truncate rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                        name === payload?.currentBranch
                          ? "border-accent/50 bg-accent/15 text-accent"
                          : "border-border bg-surface-2 text-muted",
                      )}
                    >
                      <GitBranch className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                  ))}
                  {more > 0 && (
                    <span
                      title={refs.join(", ")}
                      className="shrink-0 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-faint"
                    >
                      +{more}
                    </span>
                  )}
                </div>
              </button>

              {open && (
                <div className="border-t border-border/40 bg-bg/40 px-2 py-1.5 pl-10">
                  {!files && (
                    <div className="flex justify-center py-3">
                      <Spinner />
                    </div>
                  )}
                  {files && files.length === 0 && (
                    <p className="py-2 text-[11px] text-faint">
                      変更ファイルなし
                    </p>
                  )}
                  {files?.map((f) => (
                    <div key={f.path} className="mb-0.5">
                      <button
                        type="button"
                        disabled={fileBusy}
                        onClick={() => void openFileDiff(row.commit.hash, f.path)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-2"
                      >
                        <span
                          className={cx(
                            "w-4 shrink-0 text-center font-mono text-[10px] font-semibold rounded",
                            statusTone(f.status),
                          )}
                        >
                          {f.status}
                        </span>
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted">
                          {f.path}
                        </span>
                      </button>
                      {fileDiff?.commit === row.commit.hash &&
                        fileDiff.path === f.path && (
                          <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[10px] leading-4 text-muted whitespace-pre-wrap">
                            {fileDiff.text || "(empty diff)"}
                          </pre>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {payload?.hasMore && (
          <div className="flex justify-center py-3">
            <Button
              size="sm"
              variant="secondary"
              busy={loadingMore}
              onClick={() => void load({ append: true })}
            >
              さらに読み込む
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
