import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { getSetting } from "@/lib/db";
import { requireAuthorized } from "@/lib/api-guard";
import { OcError, ocServer } from "@/lib/oc-server";
import { GENERATION_MODEL_EFFORT_SETTING_KEY, GENERATION_MODEL_SETTING_KEY } from "@/lib/generation-model";
import { SESSION_LIST_PATH, sessionMessagePath, sessionPath } from "@/lib/opencode-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM =
  "Gitコミットメッセージを日本語で1行だけ生成してください。" +
  "変更内容を正確に要約し、50文字以内、説明や引用符は不要です。";

type InputFile = {
  path?: unknown;
  untracked?: unknown;
  additions?: unknown;
  deletions?: unknown;
  hunks?: unknown;
};

function normalizeFiles(value: unknown): InputFile[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).filter((file): file is InputFile => {
    if (!file || typeof file !== "object") return false;
    const path = (file as InputFile).path;
    return typeof path === "string" && path.length > 0 && path.length <= 500;
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const directory = typeof body?.directory === "string" ? body.directory : "";
  const check = assertAllowedDirectory(directory);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const files = normalizeFiles(body?.files);
  if (files.length === 0) {
    return NextResponse.json({ error: "files are required" }, { status: 400 });
  }

  const configuredModel = getSetting(GENERATION_MODEL_SETTING_KEY);
  if (!configuredModel) {
    return NextResponse.json({ error: "generation model is not configured" }, { status: 409 });
  }
  const [providerID, modelID] = configuredModel.split("::");
  const configuredEffort = getSetting(GENERATION_MODEL_EFFORT_SETTING_KEY) || undefined;
  const transcript = files
    .map((file) => JSON.stringify({
      path: file.path,
      untracked: file.untracked === true,
      additions: typeof file.additions === "number" ? file.additions : 0,
      deletions: typeof file.deletions === "number" ? file.deletions : 0,
      hunks: file.hunks,
    }))
    .join("\n")
    .slice(0, 100_000);

  let tempId: string | null = null;
  try {
    const temp = await ocServer<{ id: string }>(check.path, SESSION_LIST_PATH, {
      method: "POST",
      body: { title: "commit-message-gen" },
    });
    tempId = temp.id;
    const ids = await ocServer<unknown>(check.path, "/experimental/tool/ids");
    if (!Array.isArray(ids) || ids.length === 0) throw new Error("failed to read tool ids");
    const tools: Record<string, boolean> = {};
    for (const id of ids) if (typeof id === "string") tools[id] = false;
    const result = await ocServer<{ parts?: { type: string; text?: string }[] }>(
      check.path,
      sessionMessagePath(tempId),
      {
        method: "POST",
        timeoutMs: 30_000,
        body: {
          system: SYSTEM,
          model: { providerID, modelID },
          ...(configuredEffort ? { variant: configuredEffort } : {}),
          tools,
          parts: [{ type: "text", text: transcript }],
        },
      },
    );
    const message = (result.parts ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!.trim())
      .join(" ")
      .replace(/^["'「『]+|["'」』]+$/g, "")
      .split(/\r?\n/)[0]
      .trim()
      .slice(0, 100);
    if (!message) throw new Error("empty commit message");
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to generate commit message" },
      { status: err instanceof OcError ? err.status : 502 },
    );
  } finally {
    if (tempId) await ocServer(check.path, sessionPath(tempId), { method: "DELETE" }).catch(() => undefined);
  }
}
