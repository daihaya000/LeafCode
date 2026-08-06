import { NextRequest, NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";
import { rejectUnlessLocal } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// User management is host-only. Without this guard any LAN client could create
// itself an account (or delete everyone else's) with no credentials at all,
// which would defeat the login gate it is supposed to feed.

async function forwardToHost(method: string, body?: unknown) {
  const base = resolveHostControlUrl();
  const init: RequestInit = {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(`${base}/users`, init);
}

export async function GET(req: NextRequest) {
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  try {
    const res = await forwardToHost("GET");
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
    return NextResponse.json({ users: data.users ?? [] });
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
  const denied = rejectUnlessLocal(req);
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
    const res = await forwardToHost("POST", {
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
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { username?: string } | null;
  if (!body?.username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }
  try {
    const res = await forwardToHost("DELETE", { username: body.username });
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
