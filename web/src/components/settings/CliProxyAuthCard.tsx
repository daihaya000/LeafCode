import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import type { CliLoginProvider } from "@/lib/cli-login";

type AuthResponse = { connected?: boolean };

export type CliProxyAuthCardProps = {
  showHeading?: boolean;
  /** Card title, also the section label when the heading is hidden. */
  title: string;
  headingId: string;
  provider: CliLoginProvider;
  /** GET endpoint reporting whether the CLI is already logged in. */
  authEndpoint: string;
  /** The login command as typed in a terminal, e.g. `claude login`. */
  loginCommand: string;
  description: string;
};

/**
 * Shared CLI Proxy card: state badge, a button that opens a terminal already
 * running the CLI's login command, and a re-check button.
 *
 * Authentication itself always happens in the CLI — LeafCode neither prompts
 * for nor stores API keys. The launch button only automates opening the
 * terminal and entering the command; the interactive part stays with the user.
 */
export function CliProxyAuthCard({
  showHeading = true,
  title,
  headingId,
  provider,
  authEndpoint,
  loginCommand,
  description,
}: CliProxyAuthCardProps) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const load = () => {
    setState("loading");
    void getJson<AuthResponse>(authEndpoint)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authEndpoint]);

  const startLogin = async () => {
    if (launching) return;
    setLaunching(true);
    setNotice(null);
    setLaunchError(null);
    try {
      await sendJson("POST", "/api/provider/cli-login", { provider });
      if (!mountedRef.current) return;
      setNotice(`ターミナルで ${loginCommand} を実行しました。表示された手順を完了したら「再確認」を押してください。`);
    } catch (cause) {
      if (!mountedRef.current) return;
      setLaunchError(cause instanceof Error ? cause.message : "ターミナルを起動できませんでした");
    } finally {
      if (mountedRef.current) setLaunching(false);
    }
  };

  return (
    <section aria-label={showHeading ? undefined : title} aria-labelledby={showHeading ? headingId : undefined}>
      {showHeading && <h2 id={headingId} className="mb-3 text-sm font-semibold text-muted">{title}</h2>}
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">{title}</h3>
              {state !== "loading" && state !== "error" && <Badge tone={connected ? "success" : "neutral"}>{connected ? "接続済み" : "未接続"}</Badge>}
            </div>
            <p className="mt-1 text-xs text-faint">{description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === "loading" && <span className="text-xs text-faint">確認中…</span>}
            {state === "error" && <Button variant="secondary" size="sm" onClick={load}>再試行</Button>}
            {state === "ready" && (
              <>
                <Button size="sm" busy={launching} disabled={launching} onClick={() => void startLogin()}>
                  {launching ? "起動中…" : "ターミナルでログイン"}
                </Button>
                <Button variant="secondary" size="sm" onClick={load}>再確認</Button>
              </>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          「ターミナルでログイン」を押すと <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-text">{loginCommand}</code> を実行したターミナルが開きます。以降の認証操作はターミナルで行い、完了後に再確認してください。
        </p>
        {notice && <p className="mt-2 text-xs text-success" aria-live="polite">{notice}</p>}
        {launchError && <p className="mt-2 text-xs text-danger" role="alert">{launchError}</p>}
      </div>
    </section>
  );
}
