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
    <div className="flex h-full flex-col border-l border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
        <Terminal className="h-3.5 w-3.5" />
        ターミナル
      </div>
      {error && <p className="text-xs text-faint">{error}</p>}
      {!error && shells.length === 0 && (
        <p className="text-xs text-faint">
          稼働中の PTY はありません。対話入力 UI は次フェーズで追加します。
        </p>
      )}
      <ul className="space-y-1">
        {shells.map((id) => (
          <li
            key={id}
            className="rounded-lg bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted"
          >
            {id}
          </li>
        ))}
      </ul>
    </div>
  );
}
