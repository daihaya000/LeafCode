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

type PairingRequest = {
  requestId: string;
  origin: string;
  createdAt: number;
};

export function BrowserBridgeApprovals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [approvalsRes, pairingRes] = await Promise.all([
        timedFetch("/api/host/browser-bridge/approvals", { timeoutMs: 3000 }),
        timedFetch("/api/host/browser-bridge/pairing", { timeoutMs: 3000 }),
      ]);
      const approvalsData = (await approvalsRes.json()) as { approvals?: Approval[]; available?: boolean };
      const pairingData = (await pairingRes.json()) as { requests?: PairingRequest[]; available?: boolean };
      if (!approvalsRes.ok || !pairingRes.ok) throw new Error("Browser Bridgeに接続できません");
      setApprovals(Array.isArray(approvalsData.approvals) ? approvalsData.approvals : []);
      setPairingRequests(Array.isArray(pairingData.requests) ? pairingData.requests : []);
      setAvailable(approvalsData.available === true || pairingData.available === true);
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
  const decidePairing = async (requestId: string, decision: "allow" | "deny") => {
    setBusy(requestId);
    try {
      const res = await timedFetch(`/api/host/browser-bridge/pairing/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
        timeoutMs: 3000,
      });
      if (!res.ok) throw new Error("ペアリング要求の更新に失敗しました");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ペアリング要求の更新に失敗しました");
    } finally {
      setBusy(null);
    }
  };
  if (!available && !error) return null;
  return <section className="rounded-lg border border-border bg-card p-4" aria-label="Browser Bridge 承認">
    <h3 className="text-sm font-semibold">Browser Bridge 承認</h3>
    {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    {pairingRequests.map((request) => <div key={request.requestId} className="mt-3 rounded-md bg-muted p-3">
      <p className="text-sm font-medium">拡張機能のペアリング要求</p><p className="mt-1 break-all text-xs text-muted-foreground">{request.origin}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy === request.requestId} onClick={() => void decidePairing(request.requestId, "allow")}>許可</Button><Button size="sm" variant="outline" disabled={busy === request.requestId} onClick={() => void decidePairing(request.requestId, "deny")}>拒否</Button></div>
    </div>)}
    {approvals.map((approval) => <div key={approval.approvalId} className="mt-3 rounded-md bg-muted p-3">
      <p className="text-sm font-medium">{approval.tool}</p><p className="mt-1 break-all text-xs text-muted-foreground">{approval.origin}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy === approval.approvalId} onClick={() => void decide(approval.approvalId, "allow")}>許可</Button><Button size="sm" variant="outline" disabled={busy === approval.approvalId} onClick={() => void decide(approval.approvalId, "deny")}>拒否</Button></div>
    </div>)}
    {available && !error && approvals.length === 0 && pairingRequests.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">保留中の承認はありません。</p> : null}
  </section>;
}
