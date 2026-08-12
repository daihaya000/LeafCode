import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, latestBindings, listSessionBindings } from "@/lib/db";
import { OcError } from "@/lib/oc-server";
import {
  listChildSessionIds,
  setSessionEditPermission,
} from "@/lib/opencode-access-mode";
import type { AccessMode } from "@/lib/access-mode";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  mode?: unknown;
  taskId?: unknown;
  sessionId?: unknown;
};

function isAccessMode(value: unknown): value is AccessMode {
  return value === "ask" || value === "full";
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
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body !== "object" || !isAccessMode(body.mode)) {
    return NextResponse.json({ error: "invalid access mode" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (!keys.every((key) => ["mode", "taskId", "sessionId"].includes(key))) {
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

  try {
    const workspace = getWorkspace(body.taskId);
    if (!workspace) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }

    let sessionId: string | undefined;
    if (typeof body.sessionId === "string" && body.sessionId.trim()) {
      const requested = body.sessionId.trim();
      const bindings = listSessionBindings(body.taskId);
      const belongs = bindings.some((b) => b.opencode_session_id === requested);
      if (belongs) {
        sessionId = requested;
      } else {
        // Subagent sessions are not bound, but they still need the parent's
        // 確認する / フルアクセス ceiling or child writes skip approval cards.
        for (const binding of bindings) {
          const children = await listChildSessionIds(
            workspace.absolute_path,
            binding.opencode_session_id,
          );
          if (children.includes(requested)) {
            sessionId = requested;
            break;
          }
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
    await setSessionEditPermission(
      workspace.absolute_path,
      sessionId,
      body.mode,
    );
    return NextResponse.json({ mode: body.mode });
  } catch (err) {
    return failure(err);
  }
}
