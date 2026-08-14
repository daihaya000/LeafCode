import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { getJson } from "@/lib/client";

type AuthResponse = { connected?: boolean };

export function CursorCliProxyAuth({ showHeading = true }: { showHeading?: boolean }) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const mountedRef = useRef(false);

  const load = () => {
    setState("loading");
    void getJson<AuthResponse>("/api/provider/cursor/auth")
      .then((result) => {
        if (!mountedRef.current) return;
        setConnected(result.connected === true);
        setState("ready");
      })
      .catch(() => {
        if (mountedRef.current) setState("error");
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, []);

  return (
    <section aria-label={showHeading ? undefined : "Cursor CLI Proxy"} aria-labelledby={showHeading ? "cursor-cli-proxy-heading" : undefined}>
      {showHeading && <h2 id="cursor-cli-proxy-heading" className="mb-3 text-sm font-semibold text-muted">Cursor CLI Proxy</h2>}
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Cursor CLI Proxy</h3>
              {state !== "loading" && state !== "error" && <Badge tone={connected ? "success" : "neutral"}>{connected ? "接続済み" : "未接続"}</Badge>}
            </div>
            <p className="mt-1 text-xs text-faint">
              Cursor CLIをローカルプロキシ経由で使用します。認証情報はCursor CLI側で管理されるため、LeafCodeでAPIキーを入力・保存する必要はありません。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === "loading" && <span className="text-xs text-faint">確認中…</span>}
            {state === "error" && <Button variant="secondary" size="sm" onClick={load}>再試行</Button>}
            {state === "ready" && !connected && <Button variant="secondary" size="sm" onClick={load}>再確認</Button>}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          未認証の場合はターミナルで <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-text">cursor-agent login</code> を実行し、認証後に再確認してください。
        </p>
      </div>
    </section>
  );
}
