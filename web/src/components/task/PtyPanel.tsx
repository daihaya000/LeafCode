"use client";

import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { ocJson } from "@/lib/client";

/** Lightweight PTY status panel — full interactive terminal is Phase P2 follow-up. */
export function PtyPanel({ directory }: { directory: string }) {
  const [shells, setShells] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await ocJson<unknown>("/pty", directory);
        if (Array.isArray(data)) {
          setShells(data.map((x) => String((x as { id?: string }).id ?? x)));
        } else if (data && typeof data === "object" && "data" in data) {
          const arr = (data as { data: unknown[] }).data;
          setShells(
            Array.isArray(arr)
              ? arr.map((x) => String((x as { id?: string }).id ?? x))
              : [],
          );
        } else {
          setShells([]);
        }
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "PTY API に接続できません（Desktop 相当の対話ターミナルは今後対応）",
        );
      }
    })();
  }, [directory]);

  return (
    <div className="flex h-full min-w-0 flex-col border-border bg-surface p-3 lg:border-l">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
        <Terminal className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">ターミナル</span>
      </div>
      {error && <p className="min-w-0 text-xs break-words text-faint">{error}</p>}
      {!error && shells.length === 0 && (
        <p className="min-w-0 text-xs break-words text-faint">
          稼働中の PTY はありません。対話入力 UI は次フェーズで追加します。
        </p>
      )}
      <ul className="min-w-0 space-y-1">
        {shells.map((id) => (
          <li
            key={id}
            className="min-w-0 rounded-lg bg-surface-2 px-2 py-1 font-mono text-[11px] break-all text-muted"
          >
            {id}
          </li>
        ))}
      </ul>
    </div>
  );
}
