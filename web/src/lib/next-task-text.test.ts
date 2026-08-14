import { describe, expect, it } from "vitest";
import {
  formatRepoSnapshotForPrompt,
  NEXT_TASK_COMMIT_MAX_COUNT,
  NEXT_TASK_DIFF_MAX_CHARS,
  NEXT_TASK_RECENT_TASK_MAX_COUNT,
  NEXT_TASK_STATUS_MAX_CHARS,
  type RepoSnapshot,
} from "./next-task-text";

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    projectName: "LeafCode",
    currentBranch: "master",
    status: " M web/src/lib/a.ts",
    diff: "diff --git a/a.ts b/a.ts",
    commits: [{ shortHash: "abc1234", subject: "初期実装" }],
    recentTasks: ["ログイン画面を作る"],
    ...overrides,
  };
}

describe("formatRepoSnapshotForPrompt", () => {
  it("includes every populated section", () => {
    const text = formatRepoSnapshotForPrompt(snapshot());
    expect(text).toContain("【プロジェクト】");
    expect(text).toContain("LeafCode");
    expect(text).toContain("【現在のブランチ】");
    expect(text).toContain("master");
    expect(text).toContain("【未コミットの変更 (git status --short)】");
    expect(text).toContain("web/src/lib/a.ts");
    expect(text).toContain("【変更差分 (git diff)】");
    expect(text).toContain("【最近のコミット（新しい順）】");
    expect(text).toContain("- abc1234 初期実装");
    expect(text).toContain("【最近のタスク（新しい順）】");
    expect(text).toContain("- ログイン画面を作る");
  });

  it("returns an empty string when the snapshot has nothing actionable", () => {
    expect(
      formatRepoSnapshotForPrompt(
        snapshot({ status: "", diff: "", commits: [], recentTasks: [] }),
      ),
    ).toBe("");
  });

  it("still builds a prompt when only the task history is available", () => {
    const text = formatRepoSnapshotForPrompt(
      snapshot({ status: "", diff: "", commits: [] }),
    );
    expect(text).toContain("【最近のタスク（新しい順）】");
    // A clean tree is stated explicitly rather than omitted, so the model
    // does not assume there are pending edits.
    expect(text).toContain("なし（作業ツリーはクリーン）");
  });

  it("omits the branch and diff sections when they are unavailable", () => {
    const text = formatRepoSnapshotForPrompt(
      snapshot({ currentBranch: null, diff: "   " }),
    );
    expect(text).not.toContain("【現在のブランチ】");
    expect(text).not.toContain("【変更差分");
  });

  it("truncates an oversized status block", () => {
    const text = formatRepoSnapshotForPrompt(
      snapshot({ status: "x".repeat(NEXT_TASK_STATUS_MAX_CHARS + 500) }),
    );
    expect(text).toContain("…(以下省略)");
    expect(text).not.toContain("x".repeat(NEXT_TASK_STATUS_MAX_CHARS + 1));
  });

  it("truncates an oversized diff block", () => {
    const text = formatRepoSnapshotForPrompt(
      snapshot({ diff: "y".repeat(NEXT_TASK_DIFF_MAX_CHARS + 500) }),
    );
    expect(text).toContain("…(以下省略)");
    expect(text).not.toContain("y".repeat(NEXT_TASK_DIFF_MAX_CHARS + 1));
  });

  it("caps the commit and task lists", () => {
    const commits = Array.from({ length: 50 }, (_, i) => ({
      shortHash: `hash${i}`,
      subject: `件名${i}`,
    }));
    const recentTasks = Array.from({ length: 50 }, (_, i) => `タスク${i}`);
    const text = formatRepoSnapshotForPrompt(snapshot({ commits, recentTasks }));

    expect(text).toContain("件名0");
    expect(text).not.toContain(`件名${NEXT_TASK_COMMIT_MAX_COUNT}`);
    expect(text).toContain("タスク0");
    expect(text).not.toContain(`タスク${NEXT_TASK_RECENT_TASK_MAX_COUNT}`);
  });

  it("flattens newlines inside a commit subject so list items stay one line", () => {
    const text = formatRepoSnapshotForPrompt(
      snapshot({
        commits: [{ shortHash: "abc1234", subject: "件名\n本文が続く" }],
      }),
    );
    expect(text).toContain("- abc1234 件名 本文が続く");
  });

  it("drops blank task names", () => {
    const text = formatRepoSnapshotForPrompt(
      snapshot({ recentTasks: ["  ", "実タスク", ""] }),
    );
    expect(text).toContain("- 実タスク");
    expect(text).not.toContain("- \n");
  });

  it("appends the exclusion block only on regeneration", () => {
    expect(formatRepoSnapshotForPrompt(snapshot())).not.toContain(
      "既出の提案",
    );
    const regenerated = formatRepoSnapshotForPrompt(snapshot(), ["提案A"]);
    expect(regenerated).toContain("【避けるべき既出の提案】");
    expect(regenerated).toContain("- 提案A");
  });
});
