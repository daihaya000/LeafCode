import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, latestBindings, listSessionBindings } from "@/lib/db";
import { OcError } from "@/lib/oc-server";
import { setSessionSkillPermission } from "@/lib/opencode-skill-permission";
import type { SkillPermission } from "@/lib/skill-permission";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  permission?: unknown;
  taskId?: unknown;
  sessionId?: unknown;
};

function isSkillPermission(value: unknown): value is SkillPermission {
  return value === "allow" || value === "deny";
}

function failure(err: unknown) {
  if (err instanceof OcError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: "failed to update skill permission" },
    { status: 502 },
  );
}

/**
 * Narrow session-write endpoint. It accepts only a skill permission value and a
 * known taskId (+ optional sessionId), then applies a session-scoped `skill`
 * ruleset. When sessionId is omitted, the workspace's latest binding is used.
 * It never accepts an arbitrary directory, agent, or config payload.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body !== "object" || !isSkillPermission(body.permission)) {
    return NextResponse.json({ error: "invalid skill permission" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (!keys.every((key) => ["permission", "taskId", "sessionId"].includes(key))) {
    return NextResponse.json(
      { error: "invalid skill permission request" },
      { status: 400 },
    );
  }
  if (typeof body.taskId !== "string" || !body.taskId.trim()) {
    return NextResponse.json(
      { error: "invalid skill permission target" },
      { status: 400 },
    );
  }
  if (
    body.sessionId !== undefined &&
    (typeof body.sessionId !== "string" || !body.sessionId.trim())
  ) {
    return NextResponse.json(
      { error: "invalid skill permission session" },
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
      const belongs = listSessionBindings(body.taskId).some(
        (b) => b.opencode_session_id === requested,
      );
      if (!belongs) {
        return NextResponse.json({ error: "task not found" }, { status: 404 });
      }
      sessionId = requested;
    } else {
      sessionId = latestBindings().get(body.taskId)?.opencode_session_id;
    }

    if (!sessionId) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    await setSessionSkillPermission(
      workspace.absolute_path,
      sessionId,
      body.permission,
    );
    return NextResponse.json({ permission: body.permission });
  } catch (err) {
    return failure(err);
  }
}
