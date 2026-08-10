import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { archiveProject, ServiceError } from "@/lib/workspace-service";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  try {
    await archiveProject(id);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}