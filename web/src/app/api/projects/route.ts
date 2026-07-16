import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { listProjects, upsertProject } from "@/lib/db";
import { realPathOrResolved } from "@/lib/allowlist";

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

  const rootPath = realPathOrResolved(path.resolve(body.rootPath));
  const name =
    (body.name && body.name.trim()) ||
    path.basename(rootPath) ||
    "Untitled project";

  const row = upsertProject({
    name,
    rootPath,
    favorite: body.favorite,
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
