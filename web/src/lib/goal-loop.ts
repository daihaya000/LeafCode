import {
  getSetting,
  markCollaborationSnapshotCompacted,
  releaseSessionCompactionLock,
  tryAcquireSessionCompactionLock,
} from "./db";
import { computeContextUsage } from "./context-usage";
import {
  clampThreshold,
  DEFAULT_TOKEN_SAVING_THRESHOLD,
  isTokenSavingMode,
} from "./token-saving-settings";
import { OcError, ocServer } from "./oc-server";
import {
  SESSION_STATUS_PATH,
  activeCompactPath,
  activeSessionMessagePath,
} from "./opencode-paths";
import type { MessageWithParts } from "./types";
import { unwrapOcData } from "./oc-server";
import {
  isTransientOpenCodeError,
  providerModelsMap,
  retryTransientOpenCode,
  type GoalLoopCompactionResult,
  type GoalLoopDto,
  type ProviderResponse,
  COMPACT_LOCK_TTL_MS,
  COMPACT_POLL_MS,
  COMPACT_TIMEOUT_MS,
  MESSAGE_TIMEOUT_MS,
  STATUS_TIMEOUT_MS,
  type StatusMap,
} from "./goal-util";
export type {
  GoalLoopDto,
  GoalLoopPauseReason,
  GoalLoopProgress,
  GoalLoopTurnKind,
} from "./goal-util";
export {
  resetSchedulerTickingForTest,
  runGoalLoopSchedulerTick,
  startGoalLoopScheduler,
  stopGoalLoopSchedulerForTest,
} from "./goal-scheduler";
export { goalLoopTestSeams, processLoop } from "./goal-scheduler";
export {
  applyAssistantResult,
  deliveredGoalResultAfterUnknownPrompt,
  isUnknownPromptDeliveryPause,
} from "./goal-state";
export {
  createGoalLoop,
  getGoalLoop,
  listRunnableGoalLoops,
  pauseGoalLoopForManualSend,
  updateGoalLoopMaxTurns,
  updateGoalLoopStatus,
} from "./goal-db";
export type { ManualSendPauseResult } from "./goal-db";


export async function autoCompactGoalLoop(
  loop: GoalLoopDto,
  directory: string,
  messages: MessageWithParts[],
): Promise<GoalLoopCompactionResult> {
  const mode = getSetting("token-saving");
  if (!isTokenSavingMode(mode) || mode !== "auto") return "not_needed";

  let providers: ProviderResponse;
  try {
    providers = await retryTransientOpenCode(() =>
      ocServer<ProviderResponse>(directory, "/provider", { timeoutMs: STATUS_TIMEOUT_MS }),
    );
  } catch (err) {
    // Provider metadata is only a preflight read for optional auto-compact.
    // A temporary engine/network outage must not turn a queued loop into a
    // permanent pause before its first prompt; the next scheduler tick retries.
    if (isTransientOpenCodeError(err)) return "retry";
    throw err;
  }
  const usage = computeContextUsage(messages, providerModelsMap(providers));
  const threshold = clampThreshold(
    Number(getSetting("token-saving-threshold") ?? DEFAULT_TOKEN_SAVING_THRESHOLD),
  );
  if (!usage || usage.pct < threshold) return "not_needed";

  const ownerId = `goal-loop:${loop.id}`;
  if (!tryAcquireSessionCompactionLock(loop.sessionId, ownerId, Date.now(), COMPACT_LOCK_TTL_MS)) {
    return "conflict";
  }
  try {
    // Must go through the path builder. Interpolating
    // `assertSafeOpenCodeSessionId(...)` (which returns void) produced
    // `/api/session/undefined/compact`, and the engine answered 400
    // "Invalid session ID" — a non-transient error that paused the loop with
    // `scheduler_error` and reproduced on every resume.
    await ocServer(directory, activeCompactPath(loop.sessionId), {
      method: "POST",
      body: {},
      timeoutMs: COMPACT_TIMEOUT_MS,
    });

    const deadline = Date.now() + COMPACT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, COMPACT_POLL_MS));
      const status = await retryTransientOpenCode(() =>
        ocServer<StatusMap>(directory, SESSION_STATUS_PATH, { timeoutMs: STATUS_TIMEOUT_MS }),
      );
      if (status[loop.sessionId] && status[loop.sessionId].type !== "idle") continue;
      const rawMessages = await retryTransientOpenCode(() =>
        ocServer<unknown>(directory, activeSessionMessagePath(loop.sessionId), {
          timeoutMs: MESSAGE_TIMEOUT_MS,
        }),
      );
      // v2 message endpoints wrap the list in `{ data: [...] }`.
      const currentMessages = unwrapOcData<MessageWithParts>(rawMessages);
      const currentUsage = computeContextUsage(currentMessages, providerModelsMap(providers));
      if (
        currentMessages.length < messages.length ||
        currentUsage === null ||
        currentUsage.used < usage.used
      ) {
        try {
          markCollaborationSnapshotCompacted(loop.workspaceId, loop.sessionId);
        } catch {
          // Context recovery remains best-effort if the local DB is unavailable.
        }
        return "compacted";
      }
    }
    throw new OcError("OpenCodeのコンテキスト圧縮完了を確認できませんでした。", 408);
  } finally {
    releaseSessionCompactionLock(loop.sessionId, ownerId);
  }
}



