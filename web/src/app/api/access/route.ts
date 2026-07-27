import { NextResponse } from "next/server";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORT =
  Number(process.env.OPENCODE_WEBUI_PORT) ||
  Number(process.env.PORT) ||
  3000;

type NetAddr = {
  name: string;
  address: string;
  url: string;
  kind: "caddy" | "vpn" | "lan" | "other";
};

type CertificateAddr = {
  name: string;
  address: string;
  url: string;
  kind: "vpn" | "lan" | "other";
};

function classify(name: string): NetAddr["kind"] {
  const n = name.toLowerCase();
  if (
    /vpn|tap|tun|wintun|wireguard|nord|openvpn|tailscale|zerotier|hamachi|softether|forticlient|anyconnect|globalprotect/.test(
      n,
    )
  ) {
    return "vpn";
  }
  if (/wi-?fi|ethernet|wlan|lan|ローカル|local/.test(n)) return "lan";
  return "other";
}

/**
 * When Caddy fronts the WebUI with HTTPS, the host passes the public origin
 * (e.g. https://webui.example.com) via OPENCODE_WEBUI_PUBLIC_URL. In that case
 * the raw http://IP:3000 URLs are wrong — traffic must go through Caddy.
 */
function publicUrl(): string | null {
  const raw = process.env.OPENCODE_WEBUI_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function networkAddresses(port: number): NetAddr[] {
  const addresses: NetAddr[] = [];

  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!list) continue;
    for (const info of list) {
      if (info.internal) continue;
      const family = String(info.family);
      if (family !== "IPv4" && family !== "4") continue;
      addresses.push({
        name,
        address: info.address,
        url: `http://${info.address}:${port}`,
        kind: classify(name),
      });
    }
  }

  addresses.sort((a, b) => {
    const rank = { caddy: 0, vpn: 1, lan: 2, other: 3 } as const;
    return rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name);
  });

  return addresses;
}

function certificateUrls(addresses: NetAddr[]): CertificateAddr[] {
  return addresses.map((a) => ({
    name: a.name,
    address: a.address,
    url: `http://${a.address}:8080/caddy-root.crt`,
    kind: a.kind === "caddy" ? "other" : a.kind,
  }));
}

/** Addresses the phone can use (VPN / LAN). OpenCode stays on localhost. */
export async function GET() {
  const host =
    process.env.OPENCODE_WEBUI_HOST ||
    process.env.HOSTNAME_BIND ||
    "0.0.0.0";

  const publicOrigin = publicUrl();
  if (publicOrigin) {
    // Caddy HTTPS mode: keep the public origin first, but still expose the raw
    // WebUI URLs for users who intentionally bypass Caddy on trusted networks.
    const rawAddresses = networkAddresses(PORT);
    return NextResponse.json({
      bind: host,
      port: PORT,
      publicUrl: publicOrigin,
      localUrl: `http://127.0.0.1:${PORT}`,
      addresses: [
        {
          name: "Caddy (HTTPS)",
          address: publicOrigin,
          url: publicOrigin,
          kind: "caddy" as const,
        },
        ...rawAddresses,
      ],
      certificateUrls: certificateUrls(rawAddresses),
      hint: "Caddy 経由の HTTPS で公開中です。スマホからは下の URL を開いてください。",
    });
  }

  const addresses = networkAddresses(PORT);

  return NextResponse.json({
    bind: host,
    port: PORT,
    localUrl: `http://127.0.0.1:${PORT}`,
    addresses,
    hint:
      host === "127.0.0.1"
        ? "WebUI が localhost のみ待ち受け中です。スマホから使うには OPENCODE_WEBUI_HOST=0.0.0.0 で再起動してください。"
        : "スマホは VPN 接続後、下の URL（VPN 優先）を開いてください。Windows ファイアウォールでポート 3000 を許可する必要がある場合があります。",
  });
}
