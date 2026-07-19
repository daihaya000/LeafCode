import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyUsage, parseCodexBarSnapshot } from "@/lib/addons/codexbar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Location of CodexBar's exported usage snapshot (override via env for tests). */
function snapshotPath(): string {
  const override = process.env.OPENCODE_WEBUI_CODEXBAR_SNAPSHOT;
  if (override && override.trim()) return override.trim();
  const appData =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "CodexBar", "usage-snapshot.json");
}

export async function GET() {
  const file = snapshotPath();

  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      code === "ENOENT"
        ? "CodexBar のスナップショットが見つかりません（未起動の可能性）"
        : `スナップショットの読み込みに失敗しました（${code ?? "unknown"}）`;
    // Always 200 so the client can render an "unavailable" state gracefully.
    return NextResponse.json(emptyUsage(reason));
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json(emptyUsage("スナップショットの JSON 解析に失敗しました"));
  }

  return NextResponse.json(parseCodexBarSnapshot(json));
}
