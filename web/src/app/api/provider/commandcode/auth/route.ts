import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CommandCode CLI Proxy delegates authentication entirely to the `command-code`
// CLI; WebUI never stores an API key itself. This mirrors the auth-file
// discovery logic in vendor/commandcode-cli-proxy so the badge can reflect the
// real login state without duplicating the proxy.
function getConfigDir(): string {
  const override = process.env.COMMANDCODE_CONFIG_DIR;
  return override && override.length > 0 ? override : path.join(os.homedir(), ".commandcode");
}

const secretPath = () => path.join(getConfigDir(), "auth.json");

function readSecrets(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(secretPath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const token = readSecrets().apiKey;
  return NextResponse.json({ connected: typeof token === "string" && token.length > 0 });
}
