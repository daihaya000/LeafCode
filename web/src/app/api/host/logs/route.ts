import { NextResponse } from "next/server";
import { hostLogsPath, resolveHostControlUrl } from "@/lib/host-control";
import { rejectUnlessLocal } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LogEntry = {
  seq: number;
  ts: number;
  source: "host" | "opencode" | "webui" | "web-build" | "caddy";
  level: "log" | "error";
  text: string;
};

export async function GET(req: Request) {
  // Log lines can include directory paths and other host-machine details, so
  // this is guarded the same as /restart rather than left open like /health.
  const denied = rejectUnlessLocal(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const rawSince = url.searchParams.get("since");
  const since =
    rawSince !== null && Number.isFinite(Number(rawSince))
      ? Number(rawSince)
      : null;

  const base = resolveHostControlUrl();
  try {
    const res = await fetch(`${base}${hostLogsPath(since)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `host control failed: ${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json().catch(() => ({}))) as {
      entries?: unknown;
      nextSeq?: unknown;
    };
    return NextResponse.json({
      entries: Array.isArray(data.entries) ? (data.entries as LogEntry[]) : [],
      nextSeq: typeof data.nextSeq === "number" ? data.nextSeq : 0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `ホストログを取得できません: ${err.message}`
            : "ホストログを取得できません",
        hint: "start-webui.bat（トレイホスト）が起動しているか確認してください",
      },
      { status: 502 },
    );
  }
}
