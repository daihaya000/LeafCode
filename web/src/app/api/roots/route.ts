import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { addAllowedRoot, listAllowedRoots, setSetting } from "@/lib/db";
import { realPathOrResolved } from "@/lib/allowlist";
import { validateAllowlistPath } from "@/lib/path-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ roots: listAllowedRoots() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  if (!body?.path || typeof body.path !== "string") {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  const validationError = validateAllowlistPath(body.path);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  const resolved = path.resolve(body.path);
  try {
    // Prefer real path so symlink roots are stored as their real location
    const real = realPathOrResolved(resolved);
    addAllowedRoot(real);
    setSetting("lastDirectory", real);
    return NextResponse.json({ roots: listAllowedRoots() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to add root" },
      { status: 400 },
    );
  }
}
