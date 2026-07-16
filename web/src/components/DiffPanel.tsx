"use client";

import { useCallback, useEffect, useState } from "react";

type DiffPayload = {
  status: string;
  diff: string;
  gitError: string | null;
  sessionDiff: unknown;
  sessionDiffError: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "diff failed");
    } finally {
      setLoading(false);
    }
  }, [directory, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionText =
    data?.sessionDiff == null
      ? ""
      : typeof data.sessionDiff === "string"
        ? data.sessionDiff
        : JSON.stringify(data.sessionDiff, null, 2);

  return (
    <div className="flex max-h-[45dvh] flex-col border-t border-white/10 bg-[#0a0e12]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-sm font-medium">Diff</span>
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
      <div className="overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {error && <p className="text-red-300">{error}</p>}
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
