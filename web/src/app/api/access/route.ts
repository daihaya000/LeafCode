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

/** Addresses the phone can use (VPN / LAN). OpenCode stays on localhost. */
export async function GET() {
  const host =
    process.env.OPENCODE_WEBUI_HOST ||
    process.env.HOSTNAME_BIND ||
    "0.0.0.0";
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
        url: `http://${info.address}:${PORT}`,
        kind: classify(name),
      });
    }
  }

  addresses.sort((a, b) => {
    const rank = { vpn: 0, lan: 1, other: 2 } as const;
    return rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name);
  });

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
