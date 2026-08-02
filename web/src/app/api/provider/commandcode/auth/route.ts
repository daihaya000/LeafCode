import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const secretPath = () => path.join(os.homedir(), ".commandcode", "auth.json");

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

function writeSecrets(secrets: Record<string, unknown>): void {
  const file = secretPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

export async function GET() {
  const token = readSecrets().apiKey;
  return NextResponse.json({ connected: typeof token === "string" && token.length > 0 });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as { key?: unknown } | undefined;
  if (typeof body?.key !== "string" || body.key.trim().length === 0 || body.key.length > 4096) {
    return NextResponse.json({ error: "CommandCode CLI認証キーを入力してください" }, { status: 400 });
  }
  try {
    writeSecrets({ ...readSecrets(), apiKey: body.key.trim(), userId: "webui", userName: "WebUI", keyName: "webui", authenticatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch {
    return NextResponse.json({ error: "CommandCode CLI認証キーの保存に失敗しました" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const secrets = readSecrets();
    for (const key of ["apiKey", "userId", "userName", "keyName", "authenticatedAt"]) delete secrets[key];
    writeSecrets(secrets);
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch {
    return NextResponse.json({ error: "CommandCode認証の解除に失敗しました" }, { status: 500 });
  }
}
