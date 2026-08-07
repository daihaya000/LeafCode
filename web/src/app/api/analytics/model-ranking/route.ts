import { NextResponse } from "next/server";
import { getDb, listWorkspacesJoined } from "@/lib/db";
import { ocServer } from "@/lib/oc-server";
import { rankModelUsage } from "@/lib/model-ranking";
import { sessionMessagePath } from "@/lib/opencode-paths";
import type { MessageWithParts } from "@/lib/types";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Binding = { workspace_id: string; opencode_session_id: string };

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const workspaces = listWorkspacesJoined();
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const bindings = getDb()
    .prepare("SELECT workspace_id, opencode_session_id FROM session_bindings")
    .all() as Binding[];

  const histories = await Promise.all(
    bindings.flatMap((binding) => {
      const workspace = byId.get(binding.workspace_id);
      if (!workspace) return [];
      // `sessionMessagePath` throws on a malformed id (corrupt binding row).
      // Build it inside the try so one bad row degrades to "no history for this
      // session" instead of failing the whole ranking request.
      let path: string;
      try {
        path = sessionMessagePath(binding.opencode_session_id);
      } catch {
        return [];
      }
      return [
        ocServer<MessageWithParts[]>(workspace.absolute_path, path, {
          timeoutMs: 2500,
        })
          .then((messages) => ({ sessionId: binding.opencode_session_id, messages }))
          .catch(() => null),
      ];
    }),
  );

  return NextResponse.json({
    rankings: rankModelUsage(
      histories.filter(
        (history): history is { sessionId: string; messages: MessageWithParts[] } =>
          history !== null && Array.isArray(history.messages),
      ),
    ),
  });
}
