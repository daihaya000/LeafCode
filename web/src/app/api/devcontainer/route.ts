import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { detectDevcontainer } from "@/lib/devcontainer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const directory = req.nextUrl.searchParams.get("directory");
  if (!directory) {
    return NextResponse.json({ error: "directory is required" }, { status: 400 });
  }
  const check = assertAllowedDirectory(directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(detectDevcontainer(check.path));
}
