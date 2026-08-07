import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { directoryHeaders } from "@/lib/directory-header";
import { gitDiff, gitStatus } from "@/lib/git";
import { OPENCODE_BASE_URL } from "@/lib/opencode";
import { sessionDiffPath } from "@/lib/opencode-paths";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const directory = req.nextUrl.searchParams.get("directory");
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }

  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let status = "";
  let diff = "";
  let gitError: string | null = null;
  try {
    status = await gitStatus(check.path);
    diff = await gitDiff(check.path);
  } catch (err) {
    gitError = err instanceof Error ? err.message : "git failed";
  }

  let sessionDiff: unknown = null;
  let sessionDiffError: string | null = null;
  if (sessionId) {
    try {
      const url = new URL(sessionDiffPath(sessionId), OPENCODE_BASE_URL);
      url.searchParams.set("directory", check.path);
      const res = await fetch(url, {
        headers: directoryHeaders(check.path),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        sessionDiff = ct.includes("json") ? await res.json() : await res.text();
      } else {
        sessionDiffError = `opencode diff ${res.status}`;
      }
    } catch (err) {
      sessionDiffError = err instanceof Error ? err.message : "opencode unreachable";
    }
  }

  return NextResponse.json({
    directory: check.path,
    status,
    diff,
    gitError,
    sessionDiff,
    sessionDiffError,
  });
}
