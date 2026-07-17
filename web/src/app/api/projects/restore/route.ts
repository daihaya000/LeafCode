import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { realPathOrResolved } from "@/lib/allowlist";
import {
  adoptProjectFromManifest,
  restoreAllKnownProjects,
} from "@/lib/project-session-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Restore session bindings from project-local manifests.
 *
 * - No body: restore every project already known to the DB.
 * - `{ rootPath }`: register (upsert) that repository and restore its sessions,
 *   even if the global DB has no record of it yet (e.g. fresh machine / clone).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    rootPath?: string;
  } | null;

  if (body?.rootPath && typeof body.rootPath === "string") {
    const rootPath = realPathOrResolved(path.resolve(body.rootPath));
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
