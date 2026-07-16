"use client";

import { useState } from "react";
import { RotateCcw, Shrink } from "lucide-react";
import { Button } from "@/components/ui";
import { ocJson } from "@/lib/client";

export function SessionActions({
  directory,
  sessionId,
  onDone,
}: {
  directory: string;
  sessionId: string;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "失敗しました");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        title="コンテキスト圧縮 (compact)"
        busy={busy === "compact"}
        disabled={busy !== null}
        onClick={() =>
          void run("compact", async () => {
            await ocJson(`/api/session/${sessionId}/compact`, directory, {
              method: "POST",
              body: {},
            });
          })
        }
      >
        <Shrink className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="直前を巻き戻し (revert)"
        busy={busy === "revert"}
        disabled={busy !== null}
        onClick={() =>
          void run("revert", async () => {
            await ocJson(`/session/${sessionId}/revert`, directory, {
              method: "POST",
              body: {},
            });
          })
        }
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      {error && (
        <span className="max-w-[8rem] truncate text-[10px] text-danger" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
