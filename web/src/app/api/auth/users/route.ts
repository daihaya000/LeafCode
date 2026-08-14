import { NextRequest, NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";
import { requireAuthorized } from "@/lib/api-guard";
import { hostForwardHeaders } from "@/lib/local-request";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// User management is host-only. Without this guard any LAN client could create
// itself an account (or delete everyone else's) with no credentials at all,
// which would defeat the login gate it is supposed to feed.

async function forwardToHost(method: string, req: NextRequest, body?: unknown) {
  const base = resolveHostControlUrl();
  const init: RequestInit = {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  };
  // Forwarding the browser's session cookie lets the host verify who is
  // asking. Without it, POST/DELETE always 403 from the host now that
  // creating or removing a user requires an admin session. A loopback caller
  // (operator on the host PC) is additionally marked as local, which the host
  // treats as admin without a session.
  const cookie = req.headers.get("cookie");
  const headers: Record<string, string> = cookie ? { cookie } : {};
  Object.assign(headers, hostForwardHeaders(req));
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return fetch(`${base}/users`, init);
}

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    const res = await forwardToHost("GET", req);
    const data = (await res.json().catch(() => ({}))) as {
      users?: { username: string; updatedAt: string }[];
      error?: string;
    };
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "users unavailable" },
        { status: res.status },
      );
    }
    return withReadCache(NextResponse.json({ users: data.users ?? [] }), {
      maxAge: 30,
      staleWhileRevalidate: 300,
    });
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

export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

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
  try {
    const res = await forwardToHost("POST", req, {
      username: body.username,
      password: body.password,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
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

export async function DELETE(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { username?: string } | null;
  if (!body?.username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }
  try {
    const res = await forwardToHost("DELETE", req, { username: body.username });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
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
