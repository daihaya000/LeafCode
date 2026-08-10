import { NextResponse } from "next/server";
import { listArchivedProjects } from "@/lib/db";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const projects = listArchivedProjects().map((p) => ({
    id: p.id,
    name: p.name,
    rootPath: p.root_path,
    favorite: Boolean(p.favorite),
    lastOpenedAt: p.last_opened_at,
    createdAt: p.created_at,
  }));
  return NextResponse.json({ projects });
}