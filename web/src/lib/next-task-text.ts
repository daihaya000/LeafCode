/**
 * Pure helpers for the Home "次のタスクを提案" feature.
 *
 * Unlike NextAction (which reads a bound session's conversation), Home has no
 * session yet. The proposal is derived from the selected project's repository
 * state instead: current branch, working-tree status, pending diff, recent
 * commits and recently created task names.
 *
 * These functions have no side effects and do not touch the filesystem,
 * network, or any OpenCode session. They are covered by unit tests.
 *
 * Suggestion normalization, count sanitation and the regeneration exclusion
 * block are shared with NextAction (see ./next-action-text).
 */

import { formatPreviousSuggestionsBlock } from "./next-action-text";

/** Hard cap on the `git status --short` block sent to the model. */
export const NEXT_TASK_STATUS_MAX_CHARS = 4_000;

/** Hard cap on the unified diff block sent to the model. */
export const NEXT_TASK_DIFF_MAX_CHARS = 8_000;

/** Hard cap on how many recent commits are listed. */
export const NEXT_TASK_COMMIT_MAX_COUNT = 20;

/** Hard cap on how many recent task names are listed. */
export const NEXT_TASK_RECENT_TASK_MAX_COUNT = 10;

/** Hard cap on a single commit subject / task name line. */
export const NEXT_TASK_LINE_MAX_CHARS = 200;

export type RepoCommit = {
  shortHash: string;
  subject: string;
};

export type RepoSnapshot = {
  /** Display name of the selected project. */
  projectName: string;
  /** Current branch name, or null when it could not be resolved. */
  currentBranch: string | null;
  /** `git status --short` output (may be empty on a clean tree). */
  status: string;
  /** Staged + unstaged unified diff (may be empty on a clean tree). */
  diff: string;
  /** Recent commits, newest first. */
  commits: RepoCommit[];
  /** Recently created task display names for this project, newest first. */
  recentTasks: string[];
};

/**
 * System instruction for the temporary next-task session. It must produce a
 * single actionable Japanese instruction describing a *new* task to start,
 * with no preamble, no headings, no multiple candidates, and no markdown.
 */
export const NEXT_TASK_SYSTEM_INSTRUCTION = [
  "あなたはリポジトリの状態を読み、次に着手すべきタスクを提案するアシスタントです。",
  "以下のリポジトリ情報に基づいて、ユーザーが次に開始すべきタスクの指示を1件だけ出力してください。",
  "ルール:",
  "- 日本語で書く",
  "- 実行可能な1件のタスク指示のみを出力する",
  "- 説明・前置き・見出し・番号付け・候補の列挙は禁止",
  "- 未コミットの変更・未完了の作業・直近のコミットの流れを読み、価値のある次工程を選ぶ",
  "- 対象ファイルや機能名を含む具体的な指示にする",
  "- 「確認してください」「対応してください」のように対象や動作が曖昧な指示は禁止",
  "- テスト・レビュー・コミットは、リポジトリの状態から必要性が明確な場合に限る",
  "- リポジトリ情報から読み取れない事実や、存在しないファイルを前提にしない",
  "- 直近のタスク一覧が示されている場合は、それらの単純な繰り返しを避ける",
  "- 既出の提案が提示されている場合は、それらと同一または表現を変えただけの実質的に重複する指示を避け、別の観点のタスクを提案する",
  "- 出力は指示文1件だけ。余計な文字・引用符・改行を含めない",
].join("\n");

/**
 * Cap `text` to `max` code points, appending a truncation marker when it was
 * actually shortened. Code points (not UTF-16 units) are used so multi-byte
 * Japanese text and surrogate pairs are never split mid-character.
 */
function truncate(text: string, max: number): string {
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  return `${cps.slice(0, max).join("")}\n…(以下省略)`;
}

/** Trim a single line and cap it so one pathological entry cannot dominate. */
function line(text: string): string {
  return truncate(text.trim().replace(/\r?\n/g, " "), NEXT_TASK_LINE_MAX_CHARS);
}

/**
 * Build the user prompt body from a repository snapshot. Sections that carry
 * no information are omitted entirely so the model is not fed empty headings.
 *
 * Returns an empty string when the snapshot has nothing actionable at all
 * (clean tree, no commits, no task history) — the caller turns that into a
 * 400 rather than prompting the model with an empty repository description.
 *
 * When `previousSuggestions` is non-empty (regeneration), the shared
 * exclusion block is appended so the model avoids repeating shown proposals.
 */
export function formatRepoSnapshotForPrompt(
  snapshot: RepoSnapshot,
  previousSuggestions: string[] = [],
): string {
  const status = snapshot.status.trim();
  const diff = snapshot.diff.trim();
  const commits = snapshot.commits.slice(0, NEXT_TASK_COMMIT_MAX_COUNT);
  const recentTasks = snapshot.recentTasks
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, NEXT_TASK_RECENT_TASK_MAX_COUNT);

  // Nothing to reason about: refuse rather than ask the model to invent work.
  if (!status && !diff && commits.length === 0 && recentTasks.length === 0) {
    return "";
  }

  const sections: string[] = [
    "以下のリポジトリの状態に基づいて、次に開始すべきタスクの指示を1件だけ出力してください。",
    "",
    `【プロジェクト】\n${line(snapshot.projectName) || "(名称不明)"}`,
  ];

  if (snapshot.currentBranch) {
    sections.push(`【現在のブランチ】\n${line(snapshot.currentBranch)}`);
  }

  sections.push(
    status
      ? `【未コミットの変更 (git status --short)】\n${truncate(status, NEXT_TASK_STATUS_MAX_CHARS)}`
      : "【未コミットの変更】\nなし（作業ツリーはクリーン）",
  );

  if (diff) {
    sections.push(
      `【変更差分 (git diff)】\n${truncate(diff, NEXT_TASK_DIFF_MAX_CHARS)}`,
    );
  }

  if (commits.length > 0) {
    const list = commits
      .map((c) => `- ${c.shortHash} ${line(c.subject)}`)
      .join("\n");
    sections.push(`【最近のコミット（新しい順）】\n${list}`);
  }

  if (recentTasks.length > 0) {
    const list = recentTasks.map((t) => `- ${line(t)}`).join("\n");
    sections.push(`【最近のタスク（新しい順）】\n${list}`);
  }

  return sections.join("\n\n") + formatPreviousSuggestionsBlock(previousSuggestions);
}
