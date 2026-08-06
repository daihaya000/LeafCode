import { NextResponse } from "next/server";
import { rejectUnlessLocalOrAuthenticated } from "@/lib/local-request";
import { getJob } from "@/lib/profiles/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const denied = await rejectUnlessLocalOrAuthenticated(req);
  if (denied) return denied;

  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "ジョブが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({
    state: job.state,
    copied: job.copied,
    total: job.total,
    note: job.note,
    error: job.error,
  });
}
