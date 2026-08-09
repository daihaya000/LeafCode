import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  deleteMemory,
  getMemoryById,
  isMemoryKind,
  logMemoryAudit,
  updateMemory,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseRevisionParam(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
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
    expectedRevision?: unknown;
    content?: unknown;
    kind?: unknown;
  } | null;
  if (!body || typeof body !== "object") return badRequest("invalid body");
  if (typeof body.workspaceId !== "string" || !body.workspaceId) {
    return badRequest("workspaceId is required");
  }
  if (
    typeof body.expectedRevision !== "number" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  ) {
    return badRequest("expectedRevision is required");
  }
  const expectedRevision = body.expectedRevision;

  const patch: { content?: string; kind?: Parameters<typeof updateMemory>[3]["kind"] } = {};
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
    updated = updateMemory(id, body.workspaceId, expectedRevision, patch);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "invalid update");
  }
  if (!updated) {
    const current = getMemoryById(id, body.workspaceId);
    return current
      ? NextResponse.json(
          { error: "memory changed in another session", memory: current },
          { status: 409 },
        )
      : NextResponse.json({ error: "memory not found" }, { status: 404 });
  }

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
  const expectedRevisionParam = req.nextUrl.searchParams.get("expected_revision");
  const expectedRevision = parseRevisionParam(expectedRevisionParam);
  if (!workspaceId) return badRequest("workspace_id is required");
  if (expectedRevision === null) {
    return badRequest("expected_revision is required");
  }
  if (!deleteMemory(id, workspaceId, expectedRevision)) {
    const current = getMemoryById(id, workspaceId);
    return current
      ? NextResponse.json(
          { error: "memory changed in another session", memory: current },
          { status: 409 },
        )
      : NextResponse.json({ error: "memory not found" }, { status: 404 });
  }
  logMemoryAudit("delete", { memoryId: id, workspaceId });
  return NextResponse.json({ ok: true });
}
