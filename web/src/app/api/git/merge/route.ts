import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { assertSafeBranchName, runGit } from "@/lib/git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local merge of current HEAD into target branch (default: main/master),
 * or merge target into current — controlled by `into`.
 *
 * into=current (default): git merge <branch>  (bring branch into current)
 * into=branch: checkout target, merge current tip, then optionally return
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    directory?: string;
    branch?: string;
    into?: "current" | "branch";
    noFf?: boolean;
    message?: string;
  } | null;

  if (!body?.directory || !body.branch?.trim()) {
    return NextResponse.json(
      { error: "directory and branch are required" },
      { status: 400 },
    );
  }

  try {
    assertSafeBranchName(body.branch.trim());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid branch" },
      { status: 400 },
    );
  }

  const check = assertAllowedDirectory(body.directory);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const branch = body.branch.trim();
  const into = body.into ?? "current";

  const head = await runGit(check.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head.code !== 0) {
    return NextResponse.json(
      { error: head.stderr.trim() || "cannot read HEAD" },
      { status: 500 },
    );
  }
  const currentBranch = head.stdout.trim();

  if (into === "branch") {
    const co = await runGit(check.path, ["checkout", branch]);
    if (co.code !== 0) {
      return NextResponse.json(
        { error: co.stderr.trim() || `checkout ${branch} failed` },
        { status: 500 },
      );
    }
    const args = ["merge"];
    if (body.noFf) args.push("--no-ff");
    if (body.message?.trim()) args.push("-m", body.message.trim());
    args.push(currentBranch);
    const merge = await runGit(check.path, args);
    if (merge.code !== 0) {
      // try return to original branch
      await runGit(check.path, ["checkout", currentBranch]);
      return NextResponse.json(
        {
          error: merge.stderr.trim() || merge.stdout.trim() || "merge failed",
          conflict: /CONFLICT/i.test(merge.stdout + merge.stderr),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      merged: currentBranch,
      into: branch,
      summary: merge.stdout.trim(),
    });
  }

  const args = ["merge"];
  if (body.noFf) args.push("--no-ff");
  if (body.message?.trim()) args.push("-m", body.message.trim());
  args.push(branch);
  const merge = await runGit(check.path, args);
  if (merge.code !== 0) {
    return NextResponse.json(
      {
        error: merge.stderr.trim() || merge.stdout.trim() || "merge failed",
        conflict: /CONFLICT/i.test(merge.stdout + merge.stderr),
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    merged: branch,
    into: currentBranch,
    summary: merge.stdout.trim(),
  });
}
