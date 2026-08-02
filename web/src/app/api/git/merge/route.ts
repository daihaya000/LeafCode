import { NextRequest, NextResponse } from "next/server";
import { assertAllowedDirectory } from "@/lib/allowlist";
import { invalidateDirStat } from "@/lib/dirstat";
import { assertSafeBranchName, runGit } from "@/lib/git";
import {
  assertNoActiveWorkflowForDirectory,
  WorkflowServiceError,
} from "@/lib/workflow-service";

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
  try {
    assertNoActiveWorkflowForDirectory(check.path);
  } catch (error) {
    if (error instanceof WorkflowServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
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
      const stderr = co.stderr.trim();
      // In worktree isolation the merge target (main/master) is usually checked
      // out in the project's main folder, so `git checkout <target>` here fails
      // with "already checked out". Surface an actionable message instead of a
      // raw 500 the user cannot act on.
      const inUseElsewhere = /already checked out|already used by worktree/i.test(
        stderr,
      );
      return NextResponse.json(
        {
          error: inUseElsewhere
            ? `対象ブランチ「${branch}」は別の作業ツリー（メインのフォルダ等）でチェックアウト中のため、この worktree からは反映できません。メインのフォルダで「取り込む ←」を使うか、PR を作成してください。`
            : stderr || `checkout ${branch} failed`,
          worktreeConflict: inUseElsewhere || undefined,
        },
        { status: inUseElsewhere ? 409 : 500 },
      );
    }
    const args = ["merge"];
    if (body.noFf) args.push("--no-ff");
    if (body.message?.trim()) args.push("-m", body.message.trim());
    args.push(currentBranch);
    const merge = await runGit(check.path, args);
    if (merge.code !== 0) {
      // Abort the in-progress (conflicted) merge first: while MERGE_HEAD exists
      // and the index has unmerged entries, `git checkout` fails with "you need
      // to resolve your current index first", which would strand this worktree
      // on the target branch with conflict markers. --abort restores HEAD/index.
      await runGit(check.path, ["merge", "--abort"]).catch(() => undefined);
      const back = await runGit(check.path, ["checkout", currentBranch]);
      if (back.code !== 0) {
        return NextResponse.json(
          {
            error:
              (merge.stderr.trim() || merge.stdout.trim() || "merge failed") +
              `（元ブランチ「${currentBranch}」への復帰にも失敗: ${back.stderr.trim() || "checkout failed"}。現在は「${branch}」上の可能性があります）`,
            conflict: /CONFLICT/i.test(merge.stdout + merge.stderr),
            strandedOn: branch,
            restored: null,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: merge.stderr.trim() || merge.stdout.trim() || "merge failed",
          conflict: /CONFLICT/i.test(merge.stdout + merge.stderr),
        },
        { status: 409 },
      );
    }
    // Restore the working tree to the branch the caller started on. Without
    // this the worktree is left checked out on the merge target (e.g. main),
    // so subsequent diffs/commits in this workspace would silently target it.
    const restore = await runGit(check.path, ["checkout", currentBranch]);
    if (restore.code !== 0) {
      return NextResponse.json(
        {
          error: `マージは成功しましたが元ブランチ「${currentBranch}」へ戻れませんでした: ${restore.stderr.trim() || "checkout failed"}。作業ツリーは「${branch}」上です`,
          mergeSucceeded: true,
          merged: currentBranch,
          into: branch,
          summary: merge.stdout.trim(),
          restored: null,
          strandedOn: branch,
        },
        { status: 500 },
      );
    }
    invalidateDirStat(check.path);
    return NextResponse.json({
      ok: true,
      merged: currentBranch,
      into: branch,
      summary: merge.stdout.trim(),
      restored: currentBranch,
    });
  }

  const args = ["merge"];
  if (body.noFf) args.push("--no-ff");
  if (body.message?.trim()) args.push("-m", body.message.trim());
  args.push(branch);
  const merge = await runGit(check.path, args);
  if (merge.code !== 0) {
    // Abort the in-progress (conflicted) merge to restore the working tree to
    // a clean state. Without this, MERGE_HEAD remains and the user is stuck
    // in a conflicted state with no easy recovery (R37#1).
    await runGit(check.path, ["merge", "--abort"]).catch(() => undefined);
    return NextResponse.json(
      {
        error: merge.stderr.trim() || merge.stdout.trim() || "merge failed",
        conflict: /CONFLICT/i.test(merge.stdout + merge.stderr),
      },
      { status: 409 },
    );
  }

  invalidateDirStat(check.path);
  return NextResponse.json({
    ok: true,
    merged: branch,
    into: currentBranch,
    summary: merge.stdout.trim(),
  });
}
