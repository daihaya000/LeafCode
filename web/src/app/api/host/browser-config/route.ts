import { NextRequest, NextResponse } from "next/server";
import { resolveHostControlUrl } from "@/lib/host-control";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forward(method: string, req: NextRequest, body?: unknown) {
  const headers: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const init: RequestInit = { method, headers, cache: "no-store", signal: AbortSignal.timeout(5000) };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(`${resolveHostControlUrl()}/browser/config`, init);
}

async function response(res: Response) {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  try {
    return response(await forward("GET", req));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? `ホストに接続できません: ${err.message}` : "ホストに接続できません" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { autoOpenBrowser?: unknown } | null;
  if (typeof body?.autoOpenBrowser !== "boolean") {
    return NextResponse.json({ error: "autoOpenBrowser must be a boolean" }, { status: 400 });
  }
  try {
    return response(await forward("POST", req, { autoOpenBrowser: body.autoOpenBrowser }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? `ホストに接続できません: ${err.message}` : "ホストに接続できません" }, { status: 502 });
  }
}
