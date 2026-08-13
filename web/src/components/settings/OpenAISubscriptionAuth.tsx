import { Badge, Button } from "@/components/ui";
import { ExternalLink } from "lucide-react";
import { useSubscriptionOAuth } from "./use-subscription-oauth";

type AuthMethod = { type?: unknown; label?: unknown };

function isConnected(value: unknown): boolean {
  return Array.isArray(value) && value.includes("openai");
}

function isBrowserOAuth(method: AuthMethod | undefined): boolean {
  return (
    method?.type === "oauth" &&
    typeof method.label === "string" &&
    /browser|ブラウザ/i.test(method.label)
  );
}

export function OpenAISubscriptionAuth({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
  const auth = useSubscriptionOAuth({
    providerKey: "openai",
    methodsEndpoint: "/api/opencode/provider/auth",
    providerEndpoint: "/api/opencode/provider",
    authorizeEndpoint: "/api/provider/openai/oauth/authorize",
    popupName: "openai-auth",
    findMethodIndex: (methods: AuthMethod[]) =>
      methods.findIndex(isBrowserOAuth),
    isConnected,
    notAvailableMessage: "OpenAI のブラウザ認証方式が利用できません",
    loadErrorMessage: "OpenAI の認証状態を取得できませんでした",
    timeoutMessage: "認証完了を確認できませんでした。認証後に再確認してください。",
    startErrorMessage: "OpenAI のブラウザ認証を開始できませんでした",
  });
  const { state, connected, methodIndex, authUrl, instructions, error } = auth;

  return (
    <section
      aria-label={showHeading ? undefined : "OpenAI サブスクリプション"}
      aria-labelledby={showHeading ? "openai-subscription-heading" : undefined}
    >
      {showHeading && (
        <h2
          id="openai-subscription-heading"
          className="mb-3 text-sm font-semibold text-muted"
        >
          OpenAI サブスクリプション
        </h2>
      )}
      <div className="rounded-xl border border-border bg-surface px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">ChatGPT Plus / Pro</h3>
              {state !== "loading" && state !== "error" && (
                <Badge tone={connected ? "success" : "neutral"}>
                  {connected ? "接続済み" : "未接続"}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-faint">
              API キーを入力せず、OpenAI のアカウントをブラウザで認証します。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === "loading" && (
              <span className="text-xs text-faint">確認中…</span>
            )}
            {state === "error" && (
              <Button variant="secondary" size="sm" onClick={() => void auth.load()}>
                再試行
              </Button>
            )}
            {(state === "ready" || state === "connected") && (
              <Button
                size="sm"
                onClick={() => void auth.start()}
                disabled={methodIndex === null}
              >
                {connected ? "再認証" : "ブラウザで認証"}
              </Button>
            )}
            {state === "starting" && (
              <Button size="sm" busy>
                認証を準備中…
              </Button>
            )}
            {state === "waiting" && (
              <Button
                variant="secondary"
                size="sm"
                busy={auth.checking}
                disabled={auth.checking}
                onClick={() => void auth.checkConnection()}
              >
                {auth.checking ? "確認中…" : "認証完了を確認"}
              </Button>
            )}
          </div>
        </div>
        {state === "waiting" && (
          <p className="mt-3 text-xs text-muted" aria-live="polite">
            認証ページを開いています。完了すると自動で接続状態を更新します。
          </p>
        )}
        {instructions && <p className="mt-2 text-xs text-faint">{instructions}</p>}
        {authUrl && state !== "connected" && (
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            認証ページを開く
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
