import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { listProjects, upsertProject } from "@/lib/db";
import { resolveValidatedAllowlistPath } from "@/lib/path-validation";
import { restoreProjectFromManifest } from "@/lib/project-session-sync";
import { destroyProject, ServiceError } from "@/lib/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const projects = listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    rootPath: p.root_path,
    favorite: Boolean(p.favorite),
    lastOpenedAt: p.last_opened_at,
    createdAt: p.created_at,
  }));
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    rootPath?: string;
    favorite?: boolean;
  } | null;

  if (!body?.rootPath || typeof body.rootPath !== "string") {
    return NextResponse.json({ error: "rootPath is required" }, { status: 400 });
  }
  const validation = resolveValidatedAllowlistPath(body.rootPath);
  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const rootPath = validation.canonicalPath;
  // This endpoint is the "open or create" entry point and upserts by
  // rootPath, so it must never let a caller-supplied name overwrite an
  // already-registered project's display name with something unrelated to
  // its folder (e.g. a test/smoke script). The name is always derived from
  // the folder itself; use PATCH /api/projects for an explicit rename.
  const name = path.basename(rootPath) || "Untitled project";

  const row = upsertProject({
    name,
    rootPath,
    favorite: body.favorite,
  });

  // Restore any sessions recorded in the repo's local manifest so opening a
  // project brings back its prior sessions (survives DB reset / fresh clone).
  const restored = restoreProjectFromManifest(rootPath, row.id);

  return NextResponse.json({
    project: {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      favorite: Boolean(row.favorite),
      lastOpenedAt: row.last_opened_at,
      createdAt: row.created_at,
    },
    restored,
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    favorite?: boolean;
    name?: string;
  } | null;

  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { getDb } = await import("@/lib/db");
  const existing = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(body.id) as
    | {
        id: string;
        name: string;
        root_path: string;
        favorite: number;
      }
    | undefined;

  if (!existing) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const name = body.name?.trim() || existing.name;
  const favorite =
    body.favorite === undefined ? Boolean(existing.favorite) : body.favorite;

  const row = upsertProject({
    name,
    rootPath: existing.root_path,
    favorite,
  });

  return NextResponse.json({
    project: {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      favorite: Boolean(row.favorite),
      lastOpenedAt: row.last_opened_at,
      createdAt: row.created_at,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const id =
    req.nextUrl.searchParams.get("id") ||
    ((await req.json().catch(() => null)) as { id?: string } | null)?.id;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const result = await destroyProject(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
