import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Claude CLI Proxy delegates authentication entirely to the `claude` CLI;
// WebUI never stores a Claude API key itself. This mirrors the credential
// discovery logic in vendor/claude-cli-proxy (packages/claude-cli-proxy/dist)
// so the badge can reflect the real login state without duplicating the proxy.
function getConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  return override && override.length > 0 ? override : path.join(os.homedir(), ".claude");
}

function isClaudeAuthenticated(): boolean {
  const envTokens = [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
    process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ];
  if (envTokens.some((token) => token && token.trim().length > 0)) return true;
  return fs.existsSync(path.join(getConfigDir(), ".credentials.json"));
}

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  return NextResponse.json({ connected: isClaudeAuthenticated() });
}
