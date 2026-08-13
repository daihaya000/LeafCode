import { NextResponse } from "next/server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";
import { isWorkflowModeEnabled } from "@/lib/workflow-feature";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let opencode: { ok: boolean; version?: string; error?: string } = {
    ok: false,
  };
  try {
    const res = await fetch(`${OPENCODE_BASE_URL}/global/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const body = (await res.json()) as { healthy?: boolean; version?: string };
      opencode = { ok: Boolean(body.healthy), version: body.version };
    } else {
      opencode = { ok: false, error: `status ${res.status}` };
    }
  } catch (err) {
    opencode = {
      ok: false,
      error: err instanceof Error ? err.message : "unreachable",
    };
  }

  return withReadCache(
    NextResponse.json({
      webui: { ok: true },
      opencode,
      opencodeBaseUrl: OPENCODE_BASE_URL,
      workflowModeEnabled: isWorkflowModeEnabled(),
    }),
    { maxAge: 10, staleWhileRevalidate: 60 },
  );
}
