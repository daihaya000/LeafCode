import { NextRequest, NextResponse } from "next/server";
import { listArchivedTasks } from "@/lib/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const tasks = await listArchivedTasks();
  return NextResponse.json({ tasks });
}
