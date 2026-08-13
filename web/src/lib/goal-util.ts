import type { IntelligenceVariant } from "./model-variants";
import type { SessionStatus } from "./types";

import { memoryInjectionFor } from "./memory";
import {
  collaborationContextFor,
  prependCollaborationContext,
} from "./collaboration-context";

export type GoalLoopStatus =
  | "queued"
  | "running"
  | "paused"
  | "verifying_completed"
  | "completed"
  | "blocked"
  | "stopped";

/**
 * Which prompt the current (or most recent) `running` turn is answering.
 * Stored explicitly because inferring it from the tail of `progress` misreads a
 * normal goal reply as a verification reply after a pause/resume, which made a
 * completion claim unreachable. See docs/specs/goal-loop.md invariant I6.
 */
export type GoalLoopTurnKind = "goal" | "verification";

/**
 * Why a loop is `paused`. Stored as an enum instead of being matched out of the
 * Japanese `error` text: rewording the message used to silently change control
 * flow. See docs/specs/goal-loop.md invariant I5.
 */
export type GoalLoopPauseReason =
  | ""
  | "user"
  | "manual_send"
  | "turn_limit"
  | "unreadable_result"
  | "turn_timeout"
  | "unknown_delivery"
  | "transcript_unreadable"
  | "boundary_lost"
  | "verification_rejected"
  | "scheduler_error";

export const GOAL_LOOP_PAUSE_REASONS = new Set<string>([
  "",
  "user",
  "manual_send",
  "turn_limit",
  "unreadable_result",
  "turn_timeout",
  "unknown_delivery",
  "transcript_unreadable",
  "boundary_lost",
  "verification_rejected",
  "scheduler_error",
]);

export function toPauseReason(value: unknown): GoalLoopPauseReason {
  return typeof value === "string" && GOAL_LOOP_PAUSE_REASONS.has(value)
    ? (value as GoalLoopPauseReason)
    : "";
}

export function toTurnKind(value: unknown): GoalLoopTurnKind {
  return value === "verification" ? "verification" : "goal";
}

export type GoalLoopProgress = {
  time: string;
  status: "progress" | "completed" | "verifying_completed" | "verified_completed" | "blocked";
  summary: string;
  next?: string;
  evidence?: string;
};

export type GoalLoopDto = {
  id: string;
  workspaceId: string;
  sessionId: string;
  status: GoalLoopStatus;
  goal: string;
  acceptance: string[];
  maxTurns: number;
  turnCount: number;
  lastMessageId: string | null;
  lastPromptAt: string | null;
  agent: string | null;
  providerID: string | null;
  modelID: string | null;
  variant: IntelligenceVariant | null;
  progress: GoalLoopProgress[];
  summary: string;
  evidence: string;
  blockedReason: string;
  error: string;
  revision: number;
  turnKind: GoalLoopTurnKind;
  pauseReason: GoalLoopPauseReason;
  rejectedClaims: number;
  pauseRequested: boolean;
  /**
   * 完走モード: 完了宣言・検証ターンを使わず、指定の maxTurns まで goal ターンを
   * 必ず回す。作成時のみ設定。既定 false。
   */
  forceFullRun: boolean;
  /**
   * ユーザーが手動で片付けたループ。行は残るがパネルは表示せず、稼働中扱いも
   * しない。終了したループのカードが消せず、新規ループの導線まで塞いでいた
   * 問題への対処。
   */
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GoalLoopRow = {
  id: string;
  workspace_id: string;
  opencode_session_id: string;
  status: GoalLoopStatus;
  goal: string;
  acceptance: string;
  max_turns: number;
  turn_count: number;
  last_message_id: string | null;
  last_prompt_at: string | null;
  agent: string | null;
  provider_id: string | null;
  model_id: string | null;
  variant: string | null;
  progress: string;
  summary: string;
  evidence: string;
  blocked_reason: string;
  error: string;
  revision: number;
  turn_kind: string;
  pause_reason: string;
  rejected_claims: number;
  pause_requested: number;
  force_full_run: number;
  dismissed: number;
  created_at: string;
  updated_at: string;
};

export type StatusMap = Record<string, SessionStatus>;

export const TERMINAL_STATUSES: GoalLoopStatus[] = ["completed", "blocked", "stopped"];
