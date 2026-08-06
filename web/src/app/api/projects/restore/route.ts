import { NextRequest, NextResponse } from "next/server";
import {
  adoptProjectFromManifest,
  restoreAllKnownProjects,
} from "@/lib/project-session-sync";
import { resolveValidatedAllowlistPath } from "@/lib/path-validation";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Restore session bindings from machine-local manifests
 * (`<dataDir>/projects/<key>/sessions.json`).
 *
 * - No body: restore every project already known to the DB.
 * - `{ rootPath }`: register (upsert) that repository and restore its sessions
 *   from the machine-local manifest. A legacy in-repo manifest is still
 *   migrated if present. `rootPath` must pass the same allowlist path
 *   validation as POST /api/projects (protected paths, UNC, drive roots).
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    rootPath?: string;
  } | null;

  if (body?.rootPath && typeof body.rootPath === "string") {
    const validation = resolveValidatedAllowlistPath(body.rootPath);
    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const rootPath = validation.canonicalPath;
    const result = adoptProjectFromManifest(rootPath);
    if (!result) {
      return NextResponse.json(
        { error: "no manifest found for that path" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      project: {
        id: result.project.id,
        name: result.project.name,
        rootPath: result.project.root_path,
      },
      restored: result.restored,
    });
  }

  const restored = restoreAllKnownProjects();
  return NextResponse.json({ restored });
}
