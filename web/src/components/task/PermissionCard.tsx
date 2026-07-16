"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";
import type { PermissionRequest } from "@/lib/types";

export function PermissionCard({
  request,
  onReply,
}: {
  request: PermissionRequest;
  onReply: (
    request: PermissionRequest,
    response: "once" | "always" | "reject",
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reply = async (response: "once" | "always" | "reject") => {
    setBusy(response);
    setError(null);
    try {
      await onReply(request, response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "応答に失敗しました");
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-warning/40 bg-warning-bg p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
        <ShieldAlert className="h-4 w-4" />
        権限の承認が必要です
      </div>
      <p className="mb-1 font-mono text-sm">{request.permission}</p>
      {request.patterns.length > 0 && (
        <ul className="mb-3 space-y-0.5">
          {request.patterns.map((p) => (
            <li key={p} className="truncate font-mono text-xs text-muted">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          busy={busy === "once"}
          disabled={busy !== null}
          onClick={() => void reply("once")}
        >
          許可
        </Button>
        <Button
          size="md"
          busy={busy === "always"}
          disabled={busy !== null}
          onClick={() => void reply("always")}
        >
          常に許可
        </Button>
        <Button
          variant="ghost"
          size="md"
          busy={busy === "reject"}
          disabled={busy !== null}
          onClick={() => void reply("reject")}
        >
          拒否
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
