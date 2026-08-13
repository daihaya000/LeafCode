import { NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listMcpServers } from "@/lib/opencode-extensions/mcp";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    return withReadCache(NextResponse.json({ servers: await listMcpServers() }));
  } catch (err) {
    return extensionsErrorResponse(err, "MCP サーバー一覧を取得できません");
  }
}
