"use client";

import { useCallback, useEffect, useState } from "react";

type DiffPayload = {
  status: string;
  diff: string;
  gitError: string | null;
  sessionDiff: unknown;
  sessionDiffError: string | null;
};

type BranchInfo = {
  current: string;
  branches: string[];
  defaultTarget: string | null;
};

export function DiffPanel({
  directory,
  sessionId,
  onClose,
}: {
  directory: string;
  sessionId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DiffPayload | null>(null);
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    if (!directory) return;
    const u = new URL("/api/git/branches", window.location.origin);
    u.searchParams.set("directory", directory);
    const res = await fetch(u.toString(), { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return;
    const info = body as BranchInfo;
    setBranches(info);
    setMergeTarget((prev) => prev || info.defaultTarget || "");
  }, [directory]);

  const load = useCallback(async () => {
    if (!directory) return;
    setLoading(true);
    setError(null);
    try {
      const u = new URL("/api/diff", window.location.origin);
      u.searchParams.set("directory", directory);
      if (sessionId) u.searchParams.set("sessionId", sessionId);
      const res = await fetch(u.toString(), { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `diff failed: ${res.status}`);
        return;
      }
      setData(body as DiffPayload);
      await loadBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "diff failed");
    } finally {
      setLoading(false);
    }
  }, [directory, sessionId, loadBranches]);

  useEffect(() => {
    void load();
  }, [load]);

  const commit = async () => {
    if (!directory || !message.trim()) return;
    setCommitting(true);
    setError(null);
    setCommitResult(null);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory,
          message: message.trim(),
          all: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `commit failed: ${res.status}`);
        return;
      }
      setCommitResult(body.summary ?? "committed");
      setMessage("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const merge = async (into: "current" | "branch") => {
    if (!directory || !mergeTarget.trim()) return;
    setMerging(true);
    setError(null);
    setMergeResult(null);
    try {
      const res = await fetch("/api/git/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory,
          branch: mergeTarget.trim(),
          into,
          noFf: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.conflict
            ? `Merge conflict — resolve in an external tool. ${body.error ?? ""}`
            : (body.error ?? `merge failed: ${res.status}`),
        );
        return;
      }
      setMergeResult(body.summary || `merged ${body.merged} → ${body.into}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "merge failed");
    } finally {
      setMerging(false);
    }
  };

  const sessionText =
    data?.sessionDiff == null
      ? ""
      : typeof data.sessionDiff === "string"
        ? data.sessionDiff
        : JSON.stringify(data.sessionDiff, null, 2);

  const hasChanges = Boolean(data?.status?.trim() || data?.diff?.trim());

  return (
    <div className="flex max-h-[55dvh] flex-col border-t border-white/10 bg-[#0a0e12]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-sm font-medium">Diff / Commit / Merge</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-10 rounded-md bg-white/10 px-3 text-sm hover:bg-white/15 disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md bg-white/10 px-3 text-sm hover:bg-white/15"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10 px-3 py-2">
        <input
          className="min-h-11 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-sm outline-none focus:border-sky-500"
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="button"
          disabled={committing || !message.trim() || !hasChanges}
          onClick={() => void commit()}
          className="min-h-11 rounded-md bg-emerald-700 px-4 text-sm font-medium disabled:opacity-40"
        >
          Commit all
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-xs text-white/45">
          {branches ? `on ${branches.current}` : "branch…"}
        </span>
        <select
          className="min-h-11 min-w-[10rem] flex-1 rounded-md border border-white/15 bg-black/30 px-2 text-sm"
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.target.value)}
        >
          <option value="">Select branch</option>
          {(branches?.branches ?? [])
            .filter((b) => b !== branches?.current)
            .map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
        </select>
        <button
          type="button"
          disabled={merging || !mergeTarget || hasChanges}
          title={hasChanges ? "Commit or stash first" : undefined}
          onClick={() => void merge("current")}
          className="min-h-11 rounded-md bg-sky-700 px-3 text-sm disabled:opacity-40"
        >
          Merge into current
        </button>
        <button
          type="button"
          disabled={merging || !mergeTarget || hasChanges}
          onClick={() => void merge("branch")}
          className="min-h-11 rounded-md bg-sky-900 px-3 text-sm disabled:opacity-40"
        >
          Merge current into target
        </button>
      </div>

      <div className="overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {error && <p className="mb-2 text-red-300">{error}</p>}
        {commitResult && (
          <p className="mb-2 text-emerald-300">Committed: {commitResult}</p>
        )}
        {mergeResult && (
          <p className="mb-2 text-sky-300">Merged: {mergeResult}</p>
        )}
        {data?.gitError && (
          <p className="mb-2 text-amber-200">git: {data.gitError}</p>
        )}
        {data && !data.gitError && (
          <>
            <p className="mb-1 text-white/45">git status</p>
            <pre className="mb-3 whitespace-pre-wrap font-mono text-white/80">
              {data.status.trim() || "(clean)"}
            </pre>
            <p className="mb-1 text-white/45">git diff</p>
            <pre className="mb-3 whitespace-pre-wrap font-mono text-emerald-100/90">
              {data.diff.trim() || "(no diff)"}
            </pre>
          </>
        )}
        {sessionId && (
          <>
            <p className="mb-1 text-white/45">OpenCode session diff</p>
            {data?.sessionDiffError && (
              <p className="text-amber-200">{data.sessionDiffError}</p>
            )}
            <pre className="whitespace-pre-wrap font-mono text-sky-100/90">
              {sessionText || "(empty)"}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
