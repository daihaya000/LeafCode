import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";

type AuthResponse = { connected?: boolean };

export function CommandCodeAuth() {
  const [connected, setConnected] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    void getJson<AuthResponse>("/api/provider/commandcode/auth")
      .then((result) => {
        if (!mountedRef.current) return;
        setConnected(result.connected === true);
        setState("ready");
      })
      .catch(() => {
        if (mountedRef.current) setState("error");
      });
    return () => { mountedRef.current = false; };
  }, []);

  const save = async () => {
    if (!key.trim() || state === "saving") return;
    setState("saving");
    setMessage(null);
    try {
      await sendJson("POST", "/api/provider/commandcode/auth", { key });
      if (!mountedRef.current) return;
      setKey("");
      setConnected(true);
      setState("saved");
      setMessage("保存しました。反映にはOpenCodeの再起動が必要です。");
    } catch (cause) {
      if (!mountedRef.current) return;
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "CommandCode APIキーを保存できませんでした");
    }
  };

  return (
    <section aria-labelledby="commandcode-auth-heading">
      <h2 id="commandcode-auth-heading" className="mb-3 text-sm font-semibold text-muted">CommandCode</h2>
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">CommandCode API</h3>
              {state !== "loading" && state !== "error" && <Badge tone={connected ? "success" : "neutral"}>{connected ? "接続済み" : "未接続"}</Badge>}
            </div>
            <p className="mt-1 text-xs text-faint">APIキーはCommandCode CLIの認証ストアへ保存します。CLI経由のローカルプロキシを使用し、キー自体は表示・ログ出力しません。</p>
          </div>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="CommandCode APIキー" aria-label="CommandCode APIキー" autoComplete="off" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-primary sm:w-56" />
            <Button size="sm" onClick={() => void save()} disabled={!key.trim() || state === "saving"} busy={state === "saving"}>保存</Button>
          </div>
        </div>
        {state === "saved" && message && <p className="mt-3 text-xs text-success" aria-live="polite">{message}</p>}
        {state === "error" && message && <p className="mt-3 text-xs text-danger" role="alert">{message}</p>}
      </div>
    </section>
  );
}
