"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";
import type { PermissionRequest } from "@/lib/types";

export function PermissionCard({
  request,
  onReply,
  onEnableFullAccess,
}: {
  request: PermissionRequest;
  onReply: (
    request: PermissionRequest,
    response: "once" | "always" | "reject",
  ) => Promise<void>;
  /** Approve this request and switch composer to フルアクセス */
  onEnableFullAccess?: () => void;
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

  const onExtra = async (value: string) => {
    if (!value) return;
    if (value === "always") {
      await reply("always");
      return;
    }
    if (value === "full") {
      setBusy("full");
      setError(null);
      try {
        // Reply first so enabling full-access auto-approve cannot race a
        // second POST for this same request id.
        await onReply(request, "once");
        onEnableFullAccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "応答に失敗しました");
        setBusy(null);
      }
    }
  };

  return (
    <div className="rounded-xl border border-warning/40 bg-warning-bg p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
        <ShieldAlert className="h-4 w-4" />
        権限の承認が必要です
      </div>
      <p className="mb-1 break-all font-mono text-sm">{request.permission}</p>
      {request.patterns.length > 0 && (
        <ul className="mb-3 min-w-0 space-y-0.5">
          {request.patterns.map((p) => (
            <li key={p} className="truncate font-mono text-xs text-muted">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="md"
          busy={busy === "once"}
          disabled={busy !== null}
          onClick={() => void reply("once")}
        >
          許可
        </Button>
        <select
          defaultValue=""
          disabled={busy !== null}
          aria-label="追加の許可オプション"
          title="常に許可 / フルアクセス"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            void onExtra(v);
          }}
          className="h-10 cursor-pointer rounded-lg border border-border bg-surface px-2.5 text-sm text-muted outline-none hover:text-text disabled:opacity-50"
        >
          <option value="" disabled>
            オプション…
          </option>
          <option value="always">常に許可</option>
          <option value="full">フルアクセス</option>
        </select>
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
