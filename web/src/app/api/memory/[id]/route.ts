import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  deleteMemory,
  isMemoryKind,
  logMemoryAudit,
  updateMemory,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** PATCH /api/memory/:id  — edit content / kind. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id } = await params;
  if (!id) return badRequest("invalid memory id");

  const body = (await req.json().catch(() => null)) as {
    workspaceId?: unknown;
    content?: unknown;
    kind?: unknown;
  } | null;
  if (!body || typeof body !== "object") return badRequest("invalid body");
  if (typeof body.workspaceId !== "string" || !body.workspaceId) {
    return badRequest("workspaceId is required");
  }

  const patch: { content?: string; kind?: Parameters<typeof updateMemory>[2]["kind"] } = {};
  if (body.content !== undefined) {
    if (typeof body.content !== "string") return badRequest("content must be a string");
    patch.content = body.content;
  }
  if (body.kind !== undefined) {
    if (!isMemoryKind(body.kind)) return badRequest("invalid kind");
    patch.kind = body.kind;
  }

  let updated: ReturnType<typeof updateMemory>;
  try {
    updated = updateMemory(id, body.workspaceId, patch);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "invalid update");
  }
  if (!updated) return NextResponse.json({ error: "memory not found" }, { status: 404 });

  logMemoryAudit("update", { memoryId: id, workspaceId: updated.workspaceId });
  return NextResponse.json({ memory: updated });
}

/** DELETE /api/memory/:id — delete a memory (reject on a candidate). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const { id } = await params;
  if (!id) return badRequest("invalid memory id");

  const workspaceId = req.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) return badRequest("workspace_id is required");
  if (!deleteMemory(id, workspaceId)) {
    return NextResponse.json({ error: "memory not found" }, { status: 404 });
  }
  logMemoryAudit("delete", { memoryId: id, workspaceId });
  return NextResponse.json({ ok: true });
}
