import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { gitCommitFileDiff, gitCommitFiles } from "@/lib/git";
import type { GraphShowPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const directory = req.nextUrl.searchParams.get("directory");
  const commit = req.nextUrl.searchParams.get("commit");
  const file = req.nextUrl.searchParams.get("file");
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }
  if (!commit) {
    return NextResponse.json({ error: "commit is required" }, { status: 400 });
  }
  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  try {
    if (file) {
      const diff = await gitCommitFileDiff(check.path, commit, file);
      const payload: GraphShowPayload = { commit, diff };
      return NextResponse.json(payload);
    }
    const files = await gitCommitFiles(check.path, commit);
    const payload: GraphShowPayload = { commit, files };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "git show failed" },
      { status: 400 },
    );
  }
}
