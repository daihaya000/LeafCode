import { NextRequest, NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Host-only, like /api/auth/users: turning Windows-account login on decides
// whether LAN clients may send the operator's real Windows password here, so it
// must not be flippable from the LAN itself.

async function forwardToHost(method: string, body?: unknown) {
  const init: RequestInit = {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(`${resolveHostControlUrl()}/auth/config`, init);
}

function hostUnreachable(err: unknown) {
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

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const res = await forwardToHost("GET");
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        { error: (data.error as string) || "auth config unavailable" },
        { status: res.status },
      );
    }
    return NextResponse.json({
      windowsAuth: data.windowsAuth === true,
      windowsAuthSupported: data.windowsAuthSupported === true,
      hasUsers: data.hasUsers === true,
    });
  } catch (err) {
    return hostUnreachable(err);
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { windowsAuth?: unknown } | null;
  if (typeof body?.windowsAuth !== "boolean") {
    return NextResponse.json(
      { error: "windowsAuth must be a boolean" },
      { status: 400 },
    );
  }

  try {
    const res = await forwardToHost("POST", { windowsAuth: body.windowsAuth });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        { error: (data.error as string) || "auth config update failed" },
        { status: res.status },
      );
    }
    return NextResponse.json({
      ok: true,
      windowsAuth: data.windowsAuth === true,
      windowsAuthSupported: data.windowsAuthSupported === true,
      hasUsers: data.hasUsers === true,
    });
  } catch (err) {
    return hostUnreachable(err);
  }
}
