import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, latestBindings, listSessionBindings } from "@/lib/db";
import { OcError } from "@/lib/oc-server";
import {
  isSessionUnderRoots,
  listDescendantSessionIds,
  setSessionEditPermission,
} from "@/lib/opencode-access-mode";
import type { AccessMode } from "@/lib/access-mode";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ENSURE_SESSION_IDS = 32;

type RequestBody = {
  mode?: unknown;
  taskId?: unknown;
  sessionId?: unknown;
  ensureSessionIds?: unknown;
};

function isAccessMode(value: unknown): value is AccessMode {
  return value === "ask" || value === "full";
}

function parseEnsureSessionIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ENSURE_SESSION_IDS) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const id = entry.trim();
    if (!id || id.length > 256) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function failure(err: unknown) {
  if (err instanceof OcError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: "failed to update access mode" },
    { status: 502 },
  );
}

/**
 * Narrow session-write endpoint. It accepts only an access mode and a known
 * taskId (+ optional sessionId), then applies a session-scoped `edit` ruleset
 * so 確認する actually makes the engine ask before edit / write / apply_patch.
 * When sessionId is omitted, the workspace's latest binding is used. It never
 * accepts an arbitrary directory, agent, or config payload.
 *
 * `ensureSessionIds` carries ids from `session.created` so a lagging
 * `/children` listing cannot permanently skip the ceiling on a new subagent.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body !== "object" || !isAccessMode(body.mode)) {
    return NextResponse.json({ error: "invalid access mode" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (
    !keys.every((key) =>
      ["mode", "taskId", "sessionId", "ensureSessionIds"].includes(key),
    )
  ) {
    return NextResponse.json(
      { error: "invalid access mode request" },
      { status: 400 },
    );
  }
  if (typeof body.taskId !== "string" || !body.taskId.trim()) {
    return NextResponse.json(
      { error: "invalid access mode target" },
      { status: 400 },
    );
  }
  if (
    body.sessionId !== undefined &&
    (typeof body.sessionId !== "string" || !body.sessionId.trim())
  ) {
    return NextResponse.json(
      { error: "invalid access mode session" },
      { status: 400 },
    );
  }
  const ensureSessionIds = parseEnsureSessionIds(body.ensureSessionIds);
  if (ensureSessionIds === null) {
    return NextResponse.json(
      { error: "invalid ensure session ids" },
      { status: 400 },
    );
  }

  try {
    const workspace = getWorkspace(body.taskId);
    if (!workspace) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }

    const bindings = listSessionBindings(body.taskId);
    const boundRoots = new Set(
      bindings.map((binding) => binding.opencode_session_id),
    );

    let sessionId: string | undefined;
    if (typeof body.sessionId === "string" && body.sessionId.trim()) {
      const requested = body.sessionId.trim();
      const belongs = boundRoots.has(requested);
      if (belongs) {
        sessionId = requested;
      } else {
        // Subagent sessions (including nested grandchildren) are not bound,
        // but they still need the parent's 確認する / フルアクセス ceiling or
        // child writes skip approval cards.
        for (const binding of bindings) {
          const descendants = await listDescendantSessionIds(
            workspace.absolute_path,
            binding.opencode_session_id,
          );
          if (descendants.includes(requested)) {
            sessionId = requested;
            break;
          }
        }
        if (!sessionId) {
          const underBound = await isSessionUnderRoots(
            workspace.absolute_path,
            requested,
            boundRoots,
          );
          if (underBound) sessionId = requested;
        }
        if (!sessionId) {
          return NextResponse.json({ error: "task not found" }, { status: 404 });
        }
      }
    } else {
      sessionId = latestBindings().get(body.taskId)?.opencode_session_id;
    }

    if (!sessionId) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }

    const roots = new Set(boundRoots);
    roots.add(sessionId);
    const verifiedEnsure: string[] = [];
    for (const ensureId of ensureSessionIds) {
      if (ensureId === sessionId || roots.has(ensureId)) continue;
      if (await isSessionUnderRoots(workspace.absolute_path, ensureId, roots)) {
        verifiedEnsure.push(ensureId);
        roots.add(ensureId);
      }
    }

    await setSessionEditPermission(
      workspace.absolute_path,
      sessionId,
      body.mode,
      verifiedEnsure,
    );
    return NextResponse.json({ mode: body.mode });
  } catch (err) {
    return failure(err);
  }
}
