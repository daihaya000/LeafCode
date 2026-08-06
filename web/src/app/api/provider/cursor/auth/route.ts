import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cursor CLI Proxy delegates authentication entirely to the `cursor-agent` CLI;
// WebUI never stores a Cursor API key itself. This mirrors the auth-file
// discovery logic in vendor/cursor-cli-proxy (packages/cursor-cli-proxy/src/auth.ts)
// so the badge can reflect the real login state without duplicating the proxy.
function getHomeDir(): string {
  const override = process.env.CURSOR_ACP_HOME_DIR;
  return override && override.length > 0 ? override : os.homedir();
}

function getPossibleAuthPaths(): string[] {
  const home = getHomeDir();
  const paths: string[] = [];
  const authFiles = ["cli-config.json", "auth.json"];
  const isDarwin = process.platform === "darwin";
  if (isDarwin) {
    for (const file of authFiles) paths.push(path.join(home, ".cursor", file));
    for (const file of authFiles) paths.push(path.join(home, ".config", "cursor", file));
  } else {
    for (const file of authFiles) paths.push(path.join(home, ".config", "cursor", file));
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig && xdgConfig !== path.join(home, ".config")) {
      for (const file of authFiles) paths.push(path.join(xdgConfig, "cursor", file));
    }
    for (const file of authFiles) paths.push(path.join(home, ".cursor", file));
  }
  return paths;
}

function isCursorAuthenticated(): boolean {
  const apiKey = process.env.CURSOR_API_KEY;
  if (apiKey && apiKey.trim().length > 0) return true;
  return getPossibleAuthPaths().some((authPath) => {
    try {
      return fs.existsSync(authPath);
    } catch {
      return false;
    }
  });
}

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  return NextResponse.json({ connected: isCursorAuthenticated() });
}
