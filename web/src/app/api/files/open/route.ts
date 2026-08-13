import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { gitPathspecError } from "@/lib/git-pathspec";
import { openInEditor } from "@/lib/open-in-editor";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Open a changed file in the editor:
 * - VSCode: opens the repository folder and activates the target file tab.
 * - otherwise: the OS default handler.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    directory?: string;
    path?: string;
  } | null;

  if (!body?.directory || !body.path) {
    return errorResponse("directory and path are required", 400);
  }
  const pathErr = gitPathspecError(body.path, { rejectWebuiMeta: true });
  if (pathErr) {
    return errorResponse(pathErr, 400);
  }

  const check = assertAllowedDirectory(body.directory);
  if (!check.ok) {
    return errorResponse(check.error, check.status);
  }

  const abs = path.resolve(check.path, body.path);
  if (!isUnder(check.path, abs)) {
    return errorResponse("file path is outside the project", 403);
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return errorResponse("file was not found", 404);
  }
  if (!stat.isFile()) {
    return errorResponse("path is not a file", 400);
  }

  const result = openInEditor({ directory: check.path, file: abs });
  return NextResponse.json({ ok: true, editor: result.editor });
}
