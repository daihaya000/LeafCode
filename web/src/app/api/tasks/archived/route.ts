import { NextResponse } from "next/server";
import { listArchivedTasks } from "@/lib/task-service";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const tasks = await listArchivedTasks();
  return NextResponse.json({ tasks });
}
