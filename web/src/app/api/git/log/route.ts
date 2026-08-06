import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { gitBranchRefs, gitLogGraph } from "@/lib/git";
import type { GraphLogPayload } from "@/lib/types";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const directory = req.nextUrl.searchParams.get("directory");
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }
  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "80");
  const skip = Number(req.nextUrl.searchParams.get("skip") ?? "0");

  try {
    const [{ commits, hasMore }, { refs, currentBranch }] = await Promise.all([
      gitLogGraph(check.path, Number.isFinite(limit) ? limit : 80, Number.isFinite(skip) ? skip : 0),
      gitBranchRefs(check.path),
    ]);
    const payload: GraphLogPayload = {
      commits,
      refs,
      currentBranch,
      hasMore,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "git log failed",
        commits: [],
        refs: [],
        currentBranch: null,
        hasMore: false,
      },
      { status: 400 },
    );
  }
}
