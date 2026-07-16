"use client";

import { useCallback, useEffect, useState } from "react";

export function FileSearch({
  directory,
  open,
  onClose,
}: {
  directory: string;
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!directory) return;
    setError(null);
    try {
      const u = new URL("/api/files/search", window.location.origin);
      u.searchParams.set("directory", directory);
      u.searchParams.set("q", q);
      u.searchParams.set("limit", "80");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `search failed: ${res.status}`);
        return;
      }
      setFiles(body.files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "search failed");
    }
  }, [directory, q]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(), 150);
    return () => clearTimeout(t);
  }, [open, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]">
      <div className="w-full max-w-xl rounded-lg border border-white/15 bg-[#12181f] shadow-xl">
        <div className="flex gap-2 border-b border-white/10 p-3">
          <input
            autoFocus
            className="min-h-12 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-base outline-none focus:border-sky-500"
            placeholder="Search files…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-md bg-white/10 px-3 text-sm"
          >
            Esc
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2 text-sm">
          {error && <li className="px-2 py-2 text-red-300">{error}</li>}
          {!error && files.length === 0 && (
            <li className="px-2 py-6 text-white/40">No matches</li>
          )}
          {files.map((f) => (
            <li
              key={f}
              className="rounded-md px-3 py-2 font-mono text-xs text-white/85 hover:bg-white/10"
            >
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
