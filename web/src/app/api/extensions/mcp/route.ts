import { NextRequest, NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { listMcpServers } from "@/lib/opencode-extensions/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    return NextResponse.json({ servers: await listMcpServers() });
  } catch (err) {
    return extensionsErrorResponse(err, "MCP サーバー一覧を取得できません");
  }
}
