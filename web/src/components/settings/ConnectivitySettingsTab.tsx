import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { Check, Copy, Download } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { getJson, sendJson } from "@/lib/client";

type AccessInfo = {
  bind: string;
  port: number;
  localUrl: string;
  hint: string;
  addresses: {
    name: string;
    address: string;
    url: string;
    kind: "caddy" | "vpn" | "lan" | "other" | "local";
  }[];
  certificateUrls?: {
    name: string;
    address: string;
    url: string;
    kind: "vpn" | "lan" | "other";
  }[];
};

type AllowFirewallState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/**
 * Settings の「接続性」タブ（REFACTORING_PLAN 5-c / IMPROVEMENT 1-1）。
 * スマホ/VPN アクセス表示とポート許可を自己完結で持つ。
 */
export function ConnectivitySettingsTab() {
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [allowFirewallState, setAllowFirewallState] =
    useState<AllowFirewallState>({ kind: "idle" });
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void getJson<AccessInfo>("/api/access")
      .then(setAccess)
      .catch(() => {});
  }, []);

  const copyUrl = async (url: string) => {
    const ok = await copyText(url);
    if (!ok) return;
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopied(url);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      if (mountedRef.current) setCopied(null);
    }, 1500);
  };

  // Elevated (UAC) netsh call waits on the user's confirmation dialog, so the
  // timeout must be generous — much longer than the other host-control calls.
  const doAllowFirewall = async () => {
    setAllowFirewallState({ kind: "busy" });
    try {
      const data = await sendJson<{ alreadyExists?: boolean; port?: number }>(
        "POST",
        "/api/host/allow-firewall",
        {},
        undefined,
        { timeoutMs: 70_000 },
      );
      if (!mountedRef.current) return;
      const port = data.port ?? access?.port ?? 3000;
      setAllowFirewallState({
        kind: "success",
        message: data.alreadyExists
          ? `既に許可済みです（TCP ${port} 番）`
          : `ファイアウォールでポート ${port} 番を許可しました`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setAllowFirewallState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "ポート許可に失敗しました",
      });
    }
  };

  const kindLabel = (kind: string) =>
    kind === "caddy"
      ? "Caddy"
      : kind === "vpn"
        ? "VPN"
        : kind === "lan"
          ? "LAN"
          : kind === "local"
            ? "Local"
            : "その他";

  // Wi-Fi / Ethernet(LAN) の直接 IP リンクは表示せず、代わりに 127.0.0.1
  // (このPC自身からの動作確認用) を先頭に出す。VPN / Caddy はそのまま表示。
  const displayAddresses = (() => {
    const filtered = (access?.addresses ?? []).filter((a) => a.kind !== "lan");
    if (access?.localUrl) {
      filtered.unshift({
        name: "Localhost",
        address: "127.0.0.1",
        url: access.localUrl,
        kind: "local",
      });
    }
    return filtered;
  })();

  return (
    <>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted">
          スマホ / VPN アクセス
        </h2>
        <p className="mb-3 text-xs text-faint">
          {access?.hint ??
            "VPN 接続後、PC の VPN アドレス:3000 をスマホブラウザで開きます。"}
        </p>
        <ul className="space-y-2">
          {displayAddresses.map((a) => (
            <li
              key={`${a.name}-${a.address}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-nowrap"
            >
              <Badge
                tone={
                  a.kind === "caddy"
                    ? "warning"
                    : a.kind === "vpn"
                      ? "success"
                      : "neutral"
                }
              >
                {kindLabel(a.kind)}
              </Badge>
              <div className="min-w-0 flex-1">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-sm text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                  {a.url}
                </a>
                <p className="truncate text-[11px] text-faint">{a.name}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="URL をコピー"
                aria-label={copied === a.url ? "URLをコピー済み" : "URLをコピー"}
                onClick={() => void copyUrl(a.url)}
              >
                {copied === a.url ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </li>
          ))}
          {access && displayAddresses.length === 0 && (
            <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint">
              利用可能なネットワークアドレスがありません
            </li>
          )}
        </ul>
        {(access?.certificateUrls?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted">
                  Caddy HTTPS用ルートCA証明書
                </p>
                <p className="mt-0.5 text-[11px] text-faint">
                  このWebUIへHTTPS接続する端末で証明書警告を消すには、端末ごとに
                  ルートCA証明書をダウンロードしてインストールしてください。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {access?.certificateUrls?.map((cert) => (
                  <a
                    key={`${cert.name}-${cert.address}`}
                    href={cert.url}
                    download="caddy-root.crt"
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {kindLabel(cert.kind)}接続の端末用CA証明書をダウンロード
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            busy={allowFirewallState.kind === "busy"}
            disabled={allowFirewallState.kind === "busy"}
            onClick={() => void doAllowFirewall()}
          >
            ポートを許可
          </Button>
          {allowFirewallState.kind === "success" && (
            <span className="text-xs text-success">
              {allowFirewallState.message}
            </span>
          )}
          {allowFirewallState.kind === "error" && (
            <span role="alert" className="text-xs text-danger">
              {allowFirewallState.message}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-faint">
          同一ネットワークでも開けない場合は Windows ファイアウォールが原因です。上のボタンでポートを許可できます（管理者権限の確認ダイアログが表示されます）。
          手動で行う場合は管理者で{" "}
          <code className="rounded bg-surface-2 px-1">
            scripts\allow-firewall-3000.bat
          </code>{" "}
          を実行するか、PowerShell（管理者）で:
          <br />
          <code className="mt-1 block break-all rounded bg-surface-2 px-1 py-0.5">
            netsh advfirewall firewall add rule name=&quot;OpenCode WebUI&quot;
            dir=in action=allow protocol=TCP localport=
            {access?.port ?? 3000}
          </code>
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted">Remote Workspace</h2>
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          未実装（501）。VPN + ローカルパスで代替してください。
        </p>
      </section>
    </>
  );
}
