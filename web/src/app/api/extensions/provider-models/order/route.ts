import { NextResponse } from "next/server";
import { extensionsErrorResponse } from "@/lib/opencode-extensions/http";
import { saveProviderModelOrder } from "@/lib/opencode-extensions/provider-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderBody = {
  providerOrder?: unknown;
  modelOrder?: unknown;
};

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function parseOrderBody(body: OrderBody) {
  const providerOrder = stringArray(body.providerOrder);
  const modelOrder: Record<string, string[]> = {};
  if (
    body.modelOrder &&
    typeof body.modelOrder === "object" &&
    !Array.isArray(body.modelOrder)
  ) {
    for (const [providerID, order] of Object.entries(body.modelOrder)) {
      const parsed = stringArray(order);
      if (parsed) modelOrder[providerID] = parsed;
    }
  }
  return {
    providerOrder,
    modelOrder: Object.keys(modelOrder).length > 0 ? modelOrder : undefined,
  };
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => undefined)) as OrderBody | undefined;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    await saveProviderModelOrder(parseOrderBody(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err, "並び順を保存できません");
  }
}
