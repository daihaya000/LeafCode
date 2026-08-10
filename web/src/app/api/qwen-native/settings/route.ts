import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  QWEN_NATIVE_DEFAULTS,
  readQwenNativeSettings,
  writeQwenNativeSettings,
  type QwenNativeSettings,
} from "@/lib/profiles/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeInput(body: unknown): QwenNativeSettings | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (typeof value.enabled !== "boolean") return null;
  if (value.source !== "endpoint" && value.source !== "opencode") return null;
  if (typeof value.opencodeModel !== "string") return null;
  if (value.source === "opencode" && !value.opencodeModel.trim()) return null;
  if (typeof value.baseUrl !== "string" || !value.baseUrl.trim()) return null;
  if (typeof value.model !== "string" || !value.model.trim()) return null;
  if (typeof value.apiKey !== "string") return null;
  if (!isFinitePositive(value.timeoutMs)) return null;
  if (!isFinitePositive(value.maxTokens)) return null;
  return {
    enabled: value.enabled,
    source: value.source,
    opencodeModel: value.opencodeModel.trim(),
    baseUrl: value.baseUrl.trim(),
    model: value.model.trim(),
    apiKey: value.apiKey.trim() || QWEN_NATIVE_DEFAULTS.apiKey,
    timeoutMs: value.timeoutMs,
    maxTokens: value.maxTokens,
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
