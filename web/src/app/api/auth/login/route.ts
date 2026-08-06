import { NextRequest, NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/client-ip";
import { resolveHostControlUrl } from "@/lib/host-control";

/**
 * Header carrying the caller's address to the host control plane.
 *
 * The control plane only ever sees a loopback connection from this BFF, so it
 * cannot work the address out itself. It is used for the audit log and the
 * per-IP login rate limit, never for authorization.
 */
const CLIENT_IP_HEADER = "x-ocw-client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    username?: string;
    password?: string;
  } | null;

  if (!body?.username || !body?.password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 },
    );
  }

  const base = resolveHostControlUrl();
  const clientIp = clientIpFromRequest(req);
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(clientIp ? { [CLIENT_IP_HEADER]: clientIp } : {}),
      },
      body: JSON.stringify({
        username: body.username,
        password: body.password,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    // Forward the host's Set-Cookie header (if any) and JSON body.
    const setCookie = res.headers.get("set-cookie");
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      username?: string;
      error?: string;
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (setCookie) {
      headers["set-cookie"] = setCookie;
    }

    if (!res.ok || !data.ok) {
      return NextResponse.json(
        { error: data.error || "invalid credentials" },
        { status: res.ok ? 401 : res.status, headers },
      );
    }

    return NextResponse.json(
      { ok: true, username: data.username || body.username },
      { status: 200, headers },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `ホストに接続できません: ${err.message}`
            : "ホストに接続できません",
      },
      { status: 502 },
    );
  }
}
