import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { getWorkspace, latestBindings } from "@/lib/db";
import { OcError, ocServer } from "@/lib/oc-server";
import {
  setAgentTaskPermission,
  type TaskPermission,
} from "@/lib/opencode-task-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  permission?: unknown;
  directory?: unknown;
  agent?: unknown;
  taskId?: unknown;
};

function isTaskPermission(value: unknown): value is TaskPermission {
  return value === "allow" || value === "deny";
}

function failure(err: unknown) {
  if (err instanceof OcError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "failed to update task permission" }, { status: 502 });
}

/**
 * Narrow config-write endpoint. It accepts only a task permission value and
 * resolves the target executor either from a known task session or from the
 * selected, currently registered primary agent before a new task is created.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body || typeof body !== "object" || !isTaskPermission(body.permission)) {
    return NextResponse.json({ error: "invalid task permission" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (!keys.every((key) => ["permission", "directory", "agent", "taskId"].includes(key))) {
    return NextResponse.json({ error: "invalid task permission request" }, { status: 400 });
  }

  try {
    if (typeof body.taskId === "string") {
      if (typeof body.directory !== "undefined" || typeof body.agent !== "undefined") {
        return NextResponse.json({ error: "invalid task permission target" }, { status: 400 });
      }
      const workspace = getWorkspace(body.taskId);
      const sessionId = latestBindings().get(body.taskId)?.opencode_session_id;
      if (!workspace || !sessionId) {
        return NextResponse.json({ error: "task not found" }, { status: 404 });
      }
      const session = await ocServer<{ agent?: unknown }>(
        workspace.absolute_path,
        `/session/${encodeURIComponent(sessionId)}`,
      );
      if (typeof session.agent !== "string" || !session.agent.trim()) {
        return NextResponse.json({ error: "execution agent is not available" }, { status: 409 });
      }
      await setAgentTaskPermission(
        workspace.absolute_path,
        session.agent,
        body.permission,
      );
      return NextResponse.json({ permission: body.permission });
    }

    if (typeof body.directory !== "string" || typeof body.agent !== "string") {
      return NextResponse.json({ error: "invalid task permission target" }, { status: 400 });
    }
    const check = assertAllowedDirectory(body.directory);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    await setAgentTaskPermission(check.path, body.agent, body.permission);
    return NextResponse.json({ permission: body.permission });
  } catch (err) {
    return failure(err);
  }
}
