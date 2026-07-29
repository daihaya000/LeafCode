"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { timedFetch } from "@/lib/client";

type Approval = {
  approvalId: string;
  tool: string;
  origin: string;
  createdAt: number;
};

export function BrowserBridgeApprovals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await timedFetch("/api/host/browser-bridge/approvals", { timeoutMs: 3000 });
      const data = (await res.json()) as { approvals?: Approval[]; available?: boolean };
      if (!res.ok) throw new Error("Browser Bridgeに接続できません");
      setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      setAvailable(data.available === true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "承認一覧を取得できません");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const decide = async (approvalId: string, decision: "allow" | "deny") => {
    setBusy(approvalId);
    try {
      const res = await timedFetch(`/api/host/browser-bridge/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
        timeoutMs: 3000,
      });
      if (!res.ok) throw new Error("承認の更新に失敗しました");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "承認の更新に失敗しました");
    } finally {
      setBusy(null);
    }
  };
  if (!available && !error) return null;
  return <section className="rounded-lg border border-border bg-card p-4" aria-label="Browser Bridge 承認">
    <h3 className="text-sm font-semibold">Browser Bridge 承認</h3>
    {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    {approvals.map((approval) => <div key={approval.approvalId} className="mt-3 rounded-md bg-muted p-3">
      <p className="text-sm font-medium">{approval.tool}</p><p className="mt-1 break-all text-xs text-muted-foreground">{approval.origin}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy === approval.approvalId} onClick={() => void decide(approval.approvalId, "allow")}>許可</Button><Button size="sm" variant="outline" disabled={busy === approval.approvalId} onClick={() => void decide(approval.approvalId, "deny")}>拒否</Button></div>
    </div>)}
    {available && !error && approvals.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">保留中の承認はありません。</p> : null}
  </section>;
}
