"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const busyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const abortController = new AbortController();
    refreshAbortRef.current = abortController;
    const requestId = ++refreshRequestRef.current;
    try {
      const [approvalsRes, pairingRes] = await Promise.all([
        timedFetch("/api/host/browser-bridge/approvals", {
          timeoutMs: 3000,
          signal: abortController.signal,
        }),
        timedFetch("/api/host/browser-bridge/pairing", {
          timeoutMs: 3000,
          signal: abortController.signal,
        }),
      ]);
      const approvalsData = (await approvalsRes.json()) as { approvals?: Approval[]; available?: boolean };
      const pairingData = (await pairingRes.json()) as { requests?: PairingRequest[]; available?: boolean };
      if (!approvalsRes.ok || !pairingRes.ok) throw new Error("Browser Bridgeに接続できません");
      if (
        !mountedRef.current ||
        requestId !== refreshRequestRef.current ||
        abortController.signal.aborted
      ) return;
      setApprovals(Array.isArray(approvalsData.approvals) ? approvalsData.approvals : []);
      setPairingRequests(Array.isArray(pairingData.requests) ? pairingData.requests : []);
      setAvailable(approvalsData.available === true || pairingData.available === true);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (
        !mountedRef.current ||
        requestId !== refreshRequestRef.current ||
        abortController.signal.aborted
      ) return;
      setError(err instanceof Error ? err.message : "承認一覧を取得できません");
    } finally {
      if (refreshAbortRef.current === abortController) {
        refreshAbortRef.current = null;
      }
    }
  }, []);
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (!visible) {
        refreshRequestRef.current += 1;
        refreshAbortRef.current?.abort();
        refreshAbortRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!pageVisible) return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      mountedRef.current = false;
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
      refreshRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [pageVisible, refresh]);
  const decide = async (approvalId: string, decision: "allow" | "deny") => {
    const busyKey = `approval:${approvalId}`;
    if (busyRef.current) return;
    busyRef.current = busyKey;
    setBusy(busyKey);
    try {
      const res = await timedFetch(`/api/host/browser-bridge/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
        timeoutMs: 3000,
      });
      if (!res.ok) throw new Error("承認の更新に失敗しました");
      if (!mountedRef.current) return;
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "承認の更新に失敗しました");
    } finally {
      busyRef.current = null;
      if (mountedRef.current) setBusy(null);
    }
  };
  const decidePairing = async (requestId: string, decision: "allow" | "deny") => {
    const busyKey = `pairing:${requestId}`;
    if (busyRef.current) return;
    busyRef.current = busyKey;
    setBusy(busyKey);
    try {
      const res = await timedFetch(`/api/host/browser-bridge/pairing/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
        timeoutMs: 3000,
      });
      if (!res.ok) throw new Error("ペアリング要求の更新に失敗しました");
      if (!mountedRef.current) return;
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ペアリング要求の更新に失敗しました");
    } finally {
      busyRef.current = null;
      if (mountedRef.current) setBusy(null);
    }
  };
  if (!available && !error) return null;
  return <section className="rounded-lg border border-border bg-card p-4" aria-label="Browser Bridge 承認">
    <h3 className="text-sm font-semibold">Browser Bridge 承認</h3>
    {error ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-danger">{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refresh()}
          disabled={busy !== null}
        >
          再試行
        </Button>
      </div>
    ) : null}
    {pairingRequests.map((request) => <div key={request.requestId} className="mt-3 rounded-md bg-muted p-3">
      <p className="text-sm font-medium">拡張機能のペアリング要求</p><p className="mt-1 break-all text-xs text-muted-foreground">{request.origin}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" busy={busy === `pairing:${request.requestId}`} disabled={busy !== null} onClick={() => void decidePairing(request.requestId, "allow")}>許可</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decidePairing(request.requestId, "deny")}>拒否</Button></div>
    </div>)}
    {approvals.map((approval) => <div key={approval.approvalId} className="mt-3 rounded-md bg-muted p-3">
      <p className="text-sm font-medium">{approval.tool}</p><p className="mt-1 break-all text-xs text-muted-foreground">{approval.origin}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" busy={busy === `approval:${approval.approvalId}`} disabled={busy !== null} onClick={() => void decide(approval.approvalId, "allow")}>許可</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(approval.approvalId, "deny")}>拒否</Button></div>
    </div>)}
    {available && !error && approvals.length === 0 && pairingRequests.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">保留中の承認はありません。</p> : null}
  </section>;
}
