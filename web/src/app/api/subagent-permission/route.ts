import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, latestBindings } from "@/lib/db";
import { OcError } from "@/lib/oc-server";
import {
  setSessionTaskPermission,
  type TaskPermission,
} from "@/lib/opencode-task-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  permission?: unknown;
  taskId?: unknown;
};

function isTaskPermission(value: unknown): value is TaskPermission {
  return value === "allow" || value === "deny";
}

function failure(err: unknown) {
  if (err instanceof OcError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: "failed to update task permission" },
    { status: 502 },
  );
}

/**
 * Narrow session-write endpoint. It accepts only a task permission value and a
 * known taskId, then applies a session-scoped `task` ruleset to the task's
 * live OpenCode session. It never accepts an arbitrary directory, agent, or
 * config payload.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body !== "object" || !isTaskPermission(body.permission)) {
    return NextResponse.json({ error: "invalid task permission" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (!keys.every((key) => ["permission", "taskId"].includes(key))) {
    return NextResponse.json(
      { error: "invalid task permission request" },
      { status: 400 },
    );
  }
  if (typeof body.taskId !== "string" || !body.taskId.trim()) {
    return NextResponse.json(
      { error: "invalid task permission target" },
      { status: 400 },
    );
  }

  try {
    const workspace = getWorkspace(body.taskId);
    const sessionId = latestBindings().get(body.taskId)?.opencode_session_id;
    if (!workspace || !sessionId) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    await setSessionTaskPermission(
      workspace.absolute_path,
      sessionId,
      body.permission,
    );
    return NextResponse.json({ permission: body.permission });
  } catch (err) {
    return failure(err);
  }
}
