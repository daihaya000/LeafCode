import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  readQwenNativeSettings,
  writeQwenNativeSettings,
  type QwenNativeSettings,
} from "@/lib/profiles/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `providerID::modelID` 形式のみ受け付ける。 */
const MODEL_RE = /^[^\s:][^\s]*::[^\s]+$/;

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeInput(body: unknown): QwenNativeSettings | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (typeof value.enabled !== "boolean") return null;
  if (typeof value.opencodeModel !== "string") return null;
  const opencodeModel = value.opencodeModel.trim();
  // 事前解析は OpenCode 登録モデルのみ。有効化するならモデル指定が必須。
  if (value.enabled && !MODEL_RE.test(opencodeModel)) return null;
  if (opencodeModel && !MODEL_RE.test(opencodeModel)) return null;
  if (!isFinitePositive(value.timeoutMs)) return null;
  return {
    enabled: value.enabled,
    opencodeModel,
    timeoutMs: value.timeoutMs,
  };
}

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  return NextResponse.json(readQwenNativeSettings());
}

export async function PUT(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  const sanitized = sanitizeInput(body);
  if (!sanitized) {
    return NextResponse.json(
      { error: "画像解析設定が不正です" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(writeQwenNativeSettings(sanitized));
  } catch {
    return NextResponse.json(
      { error: "画像解析設定を保存できません" },
      { status: 500 },
    );
  }
}
