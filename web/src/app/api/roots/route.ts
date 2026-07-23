import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { addAllowedRoot, listAllowedRoots, removeAllowedRoot, setSetting } from "@/lib/db";
import { resolveValidatedAllowlistPath } from "@/lib/path-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ roots: listAllowedRoots() });
}

export async function DELETE(req: NextRequest) {
  const targetPath = new URL(req.url).searchParams.get("path");
  if (!targetPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  const resolved = path.resolve(targetPath);
  const roots = listAllowedRoots();
  const exists = roots.some((root) => root.toLowerCase() === resolved.toLowerCase());
  if (!exists) {
    return NextResponse.json({ error: "root not found" }, { status: 404 });
  }
  removeAllowedRoot(resolved);
  return NextResponse.json({ roots: listAllowedRoots() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  if (!body?.path || typeof body.path !== "string") {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  const validation = resolveValidatedAllowlistPath(body.path);
  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  try {
    addAllowedRoot(validation.canonicalPath);
    setSetting("lastDirectory", validation.canonicalPath);
    return NextResponse.json({ roots: listAllowedRoots() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to add root" },
      { status: 400 },
    );
  }
}
