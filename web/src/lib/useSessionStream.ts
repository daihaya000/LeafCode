"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { apiUrl, ApiError, ocJson } from "./client";
import type { IntelligenceVariant } from "./model-variants";
import { dropRecentlyReplied, rememberReplied, wasRecentlyReplied } from "./recently-replied";
import { isSseConnectStalled, isSseSilent, SSE_SILENCE_MS } from "./sse-health";
import type {
  MessageInfo,
  MessageWithParts,
  Part,
  PermissionRequest,
  QuestionInfo,
  QuestionRequest,
  SessionRevert,
  SessionStatus,
  Todo,
} from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "down";

export type StreamState = {
  scopeKey: string;
  messages: MessageWithParts[];
  status: SessionStatus | null;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  todos: Todo[];
  revert: SessionRevert | null;
  connection: ConnectionState;
  sessionError: string | null;
  loaded: boolean;
  /** Start timestamp of the in-flight sendCommand/sendPrompt, for elapsed UI. */
  mutationStartedAt: number | null;
  /** Last published elapsed ms for display/warning thresholds. */
  mutationElapsedMs: number | null;
};

export type StreamAction =
  | { kind: "reset"; scopeKey: string; cached?: StreamState }
  | { kind: "init"; messages: MessageWithParts[] }
  | { kind: "mergeRestMessages"; messages: MessageWithParts[] }
  | { kind: "messageUpdated"; info: MessageInfo }
  | { kind: "messageRemoved"; messageID: string }
  | { kind: "partUpdated"; part: Part }
  | { kind: "partRemoved"; messageID: string; partID: string }
  | {
      kind: "partTextDelta";
      messageID: string;
      partID: string;
      delta: string;
      partType: "text" | "reasoning";
      sessionID?: string;
    }
  | { kind: "status"; status: SessionStatus }
  | { kind: "permissionAsked"; request: PermissionRequest }
  | { kind: "permissionReplied"; requestId: string }
  | { kind: "permissionsSynced"; requests: PermissionRequest[]; keepLocalV2?: boolean; syncStartedAt?: number }
  | { kind: "questionAsked"; request: QuestionRequest }
  | { kind: "questionsSynced"; requests: QuestionRequest[]; keepLocalV2?: boolean; syncStartedAt?: number }
  | { kind: "questionReplied"; requestId: string }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "revert"; revert: SessionRevert | null }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "sessionError"; message: string | null }
  | { kind: "mutationStarted"; startedAt: number }
  | { kind: "mutationElapsed"; elapsedMs: number };

/** Default timeout for prompt/abort mutations so a hung engine cannot freeze the composer. */
export const SESSION_MUTATION_TIMEOUT_MS = 60_000;

/** Stop a session that has remained busy for too long, then retry it once. */
export const SESSION_HANG_TIMEOUT_MS = 5 * 60_000;

type AutoRetryRequest = {
  path: string;
  body: Record<string, unknown>;
  timeoutMs: number;
};

/**
 * `session.command` is proxied by the BFF as a long-running synchronous
 * mutation with up to a 290s upstream timeout (see
 * `LONG_RUNNING_UPSTREAM_TIMEOUT_MS` in `app/api/opencode/[...path]/route.ts`).
 * The default 60s client timeout aborts the request well before the BFF can
 * legitimately finish (e.g. `/loop 2m`), so `sendCommand` alone uses this
 * longer timeout, kept just above the BFF's 290s (and within the route's
 * 300s `maxDuration`) so the BFF—not the client—produces the terminal
 * (Japanese 408) response when the upstream truly times out.
 */
/**
 * `session.command` is proxied by the BFF with a shorter timeout (see
 * LONG_RUNNING_UPSTREAM_TIMEOUT_MS in app/api/opencode/[...path]/route.ts).
 * Keep the client timeout just above the BFF timeout so the BFF produces the
 * terminal (Japanese 408) response, but short enough that a hung command does
 * not leave the session unresponsive for many minutes.
 */
export const SESSION_COMMAND_TIMEOUT_MS = 125_000;

/**
 * While a visible session is busy, periodically reconcile from REST. Some
 * environments keep the SSE connection open with heartbeats while dropping
 * message events; without this, the view can stay stale until browser reload.
 */
export const ACTIVE_SESSION_RECONCILE_MS = 3_000;

/**
 * Upper bound for the adaptive reconcile delay.
 *
 * One reconcile pass issues eight requests, including the session's full message
 * history. On a saturated engine a single pass can take tens of seconds, and
 * re-asking every {@link ACTIVE_SESSION_RECONCILE_MS} only deepens the backlog,
 * so the next pass is delayed to roughly how long the last one actually took.
 */
export const MAX_ACTIVE_RECONCILE_MS = 30_000;

/**
 * When the SSE stream is live and this session emitted an event within this
 * window, the periodic reconcile trusts SSE for the message list and skips the
 * full `/session/{id}/message` refetch.
 *
 * That endpoint returns the entire session history — measured at ~2.9 MB on a
 * long session, which the engine needs >20s to serialize. Refetching it every
 * few seconds saturates the engine, and the resulting slowness hits *every*
 * request including `/event`, which surfaces as an unstable connection. The
 * refetch still runs whenever SSE cannot be trusted (not live, no recent event
 * for this session, or no messages loaded yet), which is exactly the case the
 * reconcile exists to recover from.
 */
export const MESSAGE_REFETCH_TRUST_SSE_MS = 10_000;

/** Per-pass options for a REST resync. */
export type ResyncOptions = {
  /**
   * Allow skipping the full `/session/{id}/message` refetch when SSE is live and
   * recently active for this session. Only the periodic reconcile sets this;
   * mount, reconnect and lifecycle-event resyncs always refetch.
   */
  trustSseForMessages?: boolean;
};

/** Delay before the next active-session reconcile, adapted to engine latency. */
export function nextReconcileDelayMs(
  lastResyncMs: number,
  baseMs: number = ACTIVE_SESSION_RECONCILE_MS,
  maxMs: number = MAX_ACTIVE_RECONCILE_MS,
): number {
  if (!Number.isFinite(lastResyncMs) || lastResyncMs <= 0) return baseMs;
  return Math.min(maxMs, Math.max(baseMs, Math.round(lastResyncMs)));
}

/**
 * True when the periodic reconcile can rely on SSE for the message list and skip
 * the full-history refetch. See {@link MESSAGE_REFETCH_TRUST_SSE_MS}.
 */
export function shouldTrustSseForMessages(input: {
  connection: ConnectionState;
  /** Time since the last SSE event scoped to this session. */
  sessionQuietMs: number;
  messageCount: number;
  trustWindowMs?: number;
}): boolean {
  if (input.connection !== "live") return false;
  if (input.messageCount <= 0) return false;
  return (
    input.sessionQuietMs < (input.trustWindowMs ?? MESSAGE_REFETCH_TRUST_SSE_MS)
  );
}

const CANCELLED_TOOL_FAILURE_MESSAGES = new Set([
  "aborted",
  "tool execution aborted",
  "cancelled",
  "canceled",
  "tool execution cancelled",
  "tool execution canceled",
]);

/** Classify the known abort/cancel tool failure messages as a neutral terminal state. */
export function classifyToolFailureStatus(
  message: string | undefined,
): "cancelled" | "error" {
  if (!message) return "error";
  return CANCELLED_TOOL_FAILURE_MESSAGES.has(message.trim().toLowerCase())
    ? "cancelled"
    : "error";
}

function normalizeCancelledToolPart(part: Part): Part {
  if (
    part.type !== "tool" ||
    !part.state?.error ||
    classifyToolFailureStatus(part.state.error) !== "cancelled" ||
    part.state.status === "cancelled"
  ) {
    return part;
  }
  return { ...part, state: { ...part.state, status: "cancelled" } };
}

/**
 * Consecutive REST idle snapshots required before overriding a live-SSE busy
 * state. Reconcile runs at least every `ACTIVE_SESSION_RECONCILE_MS`, so this is
 * a few seconds of agreement — enough to rule out a single lagging snapshot.
 * `STUCK_BUSY_QUIET_MS` is the wall-clock half of the same guard, so a slow
 * engine that stretches the interval (see `nextReconcileDelayMs`) cannot make
 * this trip sooner than intended.
 */
export const STUCK_BUSY_IDLE_STREAK = 3;

/**
 * Session-scoped SSE silence required before overriding a live-SSE busy state.
 * Multi-step turns emit message/part events continuously, so this much quiet
 * plus repeated REST idle means the turn really ended and the terminal
 * `session.idle` / `session.status` event was dropped.
 */
export const STUCK_BUSY_QUIET_MS = 12_000;

/**
 * When a mutation is in flight but the engine has stopped tracking the
 * session (`/session/status` omits it), wait this long before assuming the
 * terminal SSE event was lost and synthesizing idle. This preserves the lock
 * while the engine is still registering the turn, but unlocks the composer
 * when the event was genuinely dropped.
 */
export const MUTATION_LOST_EVENT_GRACE_MS = 20_000;

/**
 * Decide whether a REST `/session/status` snapshot should replace local status.
 * After sendPrompt/sendCommand we hold `pendingMutation` until SSE busy/idle; if
 * those events are missed, REST must still unlock the composer and clear the flag.
 */
export function resolveResyncStatus(opts: {
  pendingMutation: boolean;
  preferRestStatus: boolean;
  connection: ConnectionState;
  currentType: SessionStatus["type"] | undefined | null;
  next: SessionStatus;
  /** Consecutive REST idle snapshots seen while local status stayed busy. */
  idleStreak?: number;
  /** Time since the last SSE event scoped to this session. */
  sessionQuietMs?: number;
}): { apply: boolean; clearPending: boolean } {
  if (opts.pendingMutation) {
    const clearPending =
      opts.next.type === "busy" ||
      opts.next.type === "retry" ||
      opts.next.type === "idle";
    return { apply: true, clearPending };
  }
  const cur = opts.currentType;
  // A heartbeating SSE connection can keep reporting "live" while the engine's
  // terminal idle event is lost (proxy buffering / dropped events). Without an
  // escape hatch the view stays "working" until the user reloads the browser,
  // so repeated REST idle plus session-scoped SSE silence wins over the
  // stale-idle suppression below.
  const stuckBusy =
    (opts.idleStreak ?? 0) >= STUCK_BUSY_IDLE_STREAK &&
    (opts.sessionQuietMs ?? 0) >= STUCK_BUSY_QUIET_MS;
  // While SSE is live, REST can lag and report idle mid-turn. After SSE
  // disconnect/reconnect or abort, preferRestStatus trusts the REST snapshot.
  const staleIdle =
    !opts.preferRestStatus &&
    !stuckBusy &&
    opts.connection === "live" &&
    (cur === "busy" || cur === "retry") &&
    opts.next.type === "idle";
  // After genuine idle, lagging REST busy must not re-lock — unless we just
  // optimistically unlocked (abort) and need the truth from REST.
  const staleBusy =
    !opts.preferRestStatus &&
    cur === "idle" &&
    (opts.next.type === "busy" || opts.next.type === "retry");
  return { apply: !staleIdle && !staleBusy, clearPending: false };
}

export function createInitialStreamState(scopeKey = ""): StreamState {
  return {
    scopeKey,
    messages: [],
    status: null,
    permissions: [],
    questions: [],
    todos: [],
    revert: null,
    connection: "connecting",
    sessionError: null,
    loaded: false,
    mutationStartedAt: null,
    mutationElapsedMs: null,
  };
}

const SESSION_STATE_CACHE_MAX = 12;
const sessionStateCache = new Map<string, StreamState>();

function rememberSessionState(state: StreamState) {
  if (!state.scopeKey) return;
  sessionStateCache.delete(state.scopeKey);
  sessionStateCache.set(state.scopeKey, state);
  while (sessionStateCache.size > SESSION_STATE_CACHE_MAX) {
    const oldest = sessionStateCache.keys().next().value;
    if (typeof oldest !== "string") break;
    sessionStateCache.delete(oldest);
  }
}

function readCachedSessionState(scopeKey: string): StreamState | undefined {
  const cached = sessionStateCache.get(scopeKey);
  if (!cached) return undefined;
  sessionStateCache.delete(scopeKey);
  sessionStateCache.set(scopeKey, cached);
  return cached;
}

/** Hide soft-reverted messages the way OpenCode Desktop does. */
export function filterRevertedMessages(
  messages: MessageWithParts[],
  revert: SessionRevert | null,
): MessageWithParts[] {
  if (!revert?.messageID) return messages;
  const out: MessageWithParts[] = [];
  for (const m of messages) {
    if (m.info.id > revert.messageID) continue;
    if (m.info.id < revert.messageID) {
      out.push(m);
      continue;
    }
    // id === revert.messageID
    if (!revert.partID) continue;
    const idx = m.parts.findIndex((p) => p.id === revert.partID);
    if (idx <= 0) continue;
    out.push({ ...m, parts: m.parts.slice(0, idx) });
  }
  return out;
}

/**
 * Marker prepended to every goal-loop prompt (see `buildGoalPrompt`).
 * User messages starting with this are WebUI-internal system prompts and must
 * never appear in the chat timeline.
 */
export const GOAL_LOOP_PROMPT_MARKER = "<!-- webui-goal-loop-prompt -->";

/**
 * Drop goal-loop system-prompt user messages from the timeline. The loop
 * prompts the engine with a long instruction block that should not surface as
 * a normal user turn. Identified by the `GOAL_LOOP_PROMPT_MARKER` prefix on the
 * first text part.
 */
export function filterGoalLoopMessages(
  messages: MessageWithParts[],
): MessageWithParts[] {
  return messages.filter((m) => {
    if (m.info.role !== "user") return true;
    const first = m.parts.find((p) => p.type === "text");
    if (!first || first.type !== "text") return true;
    return !(first.text ?? "").startsWith(GOAL_LOOP_PROMPT_MARKER);
  });
}

/**
 * Hide OpenCode's internal post-compaction continuation turn. OpenCode stores
 * this as a synthetic user text part with `compaction_continue` metadata so
 * the model can resume after automatic context compaction; it is not a user
 * submission and must not be rendered as one.
 */
export function filterCompactionContinueMessages(
  messages: MessageWithParts[],
): MessageWithParts[] {
  return messages.filter((message) => {
    if (message.info.role !== "user") return true;
    return !message.parts.some(
      (part) =>
        part.type === "text" &&
        part.synthetic === true &&
        part.metadata?.compaction_continue === true,
    );
  });
}

/**
 * Strip the trailing fenced JSON block the goal loop asks the model to emit.
 * The block carries the structured turn result
 * (`{"status","summary","next","evidence"}`) and is noise in a normal chat.
 * Only removes a trailing block whose parsed object looks like a goal result;
 * a generic trailing ```json block is left untouched.
 */
export function stripGoalLoopJsonBlock(text: string): string {
  const match = text.match(/\n*```json\s*([\s\S]*?)```\s*$/);
  if (!match) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return text;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return text;
  }
  const r = parsed as Record<string, unknown>;
  if (
    r.status === "progress" ||
    r.status === "completed" ||
    r.status === "blocked" ||
    r.status === "verified_completed"
  ) {
    return text.slice(0, match.index).replace(/\n+$/, "");
  }
  return text;
}

function upsertPart(parts: Part[], part: Part): Part[] {
  const idx = parts.findIndex((p) => p.id === part.id);
  if (idx === -1) return [...parts, part];
  const prev = parts[idx]!;
  const next = parts.slice();
  // Merge tool parts so streaming session.next.* patches keep the tool name
  // and prior state fields when later events omit them.
  if (prev.type === "tool" && part.type === "tool") {
    next[idx] = {
      ...prev,
      ...part,
      tool:
        part.tool && part.tool !== "tool" ? part.tool : (prev.tool ?? part.tool),
      state: {
        status: part.state?.status ?? prev.state?.status ?? "pending",
        input: part.state?.input ?? prev.state?.input,
        output: part.state?.output ?? prev.state?.output,
        title: part.state?.title ?? prev.state?.title,
        error: part.state?.error ?? prev.state?.error,
        metadata: part.state?.metadata ?? prev.state?.metadata,
        time: { ...prev.state?.time, ...part.state?.time },
      },
      time: { ...prev.time, ...part.time },
    };
    return next;
  }
  if (
    (prev.type === "text" || prev.type === "reasoning") &&
    prev.type === part.type
  ) {
    const nextText =
      part.text !== undefined && part.text.length > 0
        ? part.text
        : (prev.text ?? part.text);
    next[idx] = {
      ...prev,
      ...part,
      text: nextText,
      time: { ...prev.time, ...part.time },
    };
    return next;
  }
  next[idx] = part;
  return next;
}

function mergeRestPart(local: Part | undefined, rest: Part): Part {
  const normalized = normalizeCancelledToolPart(rest);
  if (!local) return normalized;
  if (
    (local.type === "text" || local.type === "reasoning") &&
    local.type === normalized.type
  ) {
    const localText = local.text ?? "";
    const restText = normalized.text ?? "";
    // REST snapshots can lag behind live deltas mid-turn. Keep the longer
    // local prefix only for text-like parts; terminal metadata still comes
    // from REST so missed end events are recovered.
    const text =
      localText.startsWith(restText) && localText.length > restText.length
        ? localText
        : restText;
    return {
      ...local,
      ...normalized,
      text,
      time: { ...local.time, ...normalized.time },
    };
  }
  if (local.type === "tool" && normalized.type === "tool") {
    return upsertPart([local], normalized)[0]!;
  }
  return normalized;
}

function mergeRestMessages(
  localMessages: MessageWithParts[],
  restMessages: MessageWithParts[],
): MessageWithParts[] {
  const localById = new Map(localMessages.map((m) => [m.info.id, m]));
  const restIds = new Set(restMessages.map((m) => m.info.id));
  const merged = restMessages.map((restMessage) => {
    const localMessage = localById.get(restMessage.info.id);
    if (!localMessage) {
      return {
        ...restMessage,
        parts: restMessage.parts.map(normalizeCancelledToolPart),
      };
    }
    const localParts = new Map(localMessage.parts.map((p) => [p.id, p]));
    return {
      ...localMessage,
      ...restMessage,
      parts: restMessage.parts.map((part) =>
        mergeRestPart(localParts.get(part.id), part),
      ),
    };
  });
  // Mid-stream REST can be behind locally received SSE deltas. Keep local-only
  // placeholders until a non-streaming init can authoritatively prune them.
  for (const localMessage of localMessages) {
    if (!restIds.has(localMessage.info.id)) merged.push(localMessage);
  }
  return merged;
}

export function sessionStreamReducer(
  state: StreamState,
  action: StreamAction,
): StreamState {
  switch (action.kind) {
    case "reset":
      if (action.cached) {
        return {
          ...action.cached,
          scopeKey: action.scopeKey,
          connection: "connecting",
          sessionError: null,
        };
      }
      return createInitialStreamState(action.scopeKey);
    case "init":
      return {
        ...state,
        messages: action.messages.map((message) => ({
          ...message,
          parts: message.parts.map(normalizeCancelledToolPart),
        })),
        loaded: true,
      };
    case "mergeRestMessages":
      return {
        ...state,
        messages: mergeRestMessages(state.messages, action.messages),
        loaded: true,
      };
    case "messageUpdated": {
      const idx = state.messages.findIndex((m) => m.info.id === action.info.id);
      if (idx === -1) {
        return {
          ...state,
          loaded: true,
          messages: [...state.messages, { info: action.info, parts: [] }],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = { ...messages[idx], info: action.info };
      return { ...state, loaded: true, messages };
    }
    case "messageRemoved":
      return {
        ...state,
        messages: state.messages.filter((m) => m.info.id !== action.messageID),
      };
    case "partUpdated": {
      const part = normalizeCancelledToolPart(action.part);
      const idx = state.messages.findIndex((m) => m.info.id === part.messageID);
      if (idx === -1) {
        // part for an unseen message — create a placeholder entry
        return {
          ...state,
          loaded: true,
          messages: [
            ...state.messages,
            {
              info: { id: part.messageID, role: "assistant" },
              parts: [part],
            },
          ],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = {
        ...messages[idx],
        parts: upsertPart(messages[idx].parts, part),
      };
      return { ...state, loaded: true, messages };
    }
    case "partRemoved": {
      const idx = state.messages.findIndex((m) => m.info.id === action.messageID);
      if (idx === -1) return state;
      const messages = state.messages.slice();
      messages[idx] = {
        ...messages[idx],
        parts: messages[idx].parts.filter((p) => p.id !== action.partID),
      };
      return { ...state, messages };
    }
    case "partTextDelta": {
      const idx = state.messages.findIndex((m) => m.info.id === action.messageID);
      const existing =
        idx === -1
          ? undefined
          : state.messages[idx].parts.find((p) => p.id === action.partID);
      const nextPart: Part = {
        id: action.partID,
        messageID: action.messageID,
        sessionID: action.sessionID ?? existing?.sessionID,
        type: action.partType,
        text: `${existing?.text ?? ""}${action.delta}`,
        ...(existing?.time ? { time: existing.time } : {}),
      };
      if (idx === -1) {
        return {
          ...state,
          loaded: true,
          messages: [
            ...state.messages,
            {
              info: { id: action.messageID, role: "assistant" },
              parts: [nextPart],
            },
          ],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = {
        ...messages[idx],
        parts: upsertPart(messages[idx].parts, nextPart),
      };
      return { ...state, loaded: true, messages };
    }
    case "status":
      return { ...state, status: action.status };
    case "permissionAsked": {
      if (state.permissions.some((p) => p.id === action.request.id)) return state;
      return { ...state, permissions: [...state.permissions, action.request] };
    }
    case "permissionReplied":
      return {
        ...state,
        permissions: state.permissions.filter((p) => p.id !== action.requestId),
      };
    case "permissionsSynced": {
      const restIds = new Set(action.requests.map((r) => r.id));
      const keptLocal = state.permissions.filter((p) => {
        if (restIds.has(p.id)) return false;
        if (action.keepLocalV2 && p.version === "v2") return true;
        if (
          typeof action.syncStartedAt === "number" &&
          p.receivedAt > action.syncStartedAt
        ) {
          return true;
        }
        return false;
      });
      return { ...state, permissions: [...action.requests, ...keptLocal] };
    }
    case "questionAsked": {
      if (state.questions.some((q) => q.id === action.request.id)) return state;
      return { ...state, questions: [...state.questions, action.request] };
    }
    case "questionsSynced": {
      const restIds = new Set(action.requests.map((r) => r.id));
      const keptLocal = state.questions.filter((q) => {
        if (restIds.has(q.id)) return false;
        if (action.keepLocalV2 && q.version === "v2") return true;
        if (
          typeof action.syncStartedAt === "number" &&
          q.receivedAt > action.syncStartedAt
        ) {
          return true;
        }
        return false;
      });
      return { ...state, questions: [...action.requests, ...keptLocal] };
    }
    case "questionReplied":
      return {
        ...state,
        questions: state.questions.filter((q) => q.id !== action.requestId),
      };
    case "todos":
      return { ...state, todos: action.todos };
    case "revert":
      return { ...state, revert: action.revert };
    case "connection":
      return { ...state, connection: action.connection };
    case "sessionError":
      return { ...state, sessionError: action.message };
    case "mutationStarted":
      return {
        ...state,
        mutationStartedAt: action.startedAt,
        mutationElapsedMs: 0,
      };
    case "mutationElapsed":
      return { ...state, mutationElapsedMs: action.elapsedMs };
    default:
      return state;
  }
}

/** Live view of one OpenCode session: initial fetch + SSE incremental updates. */
export function useSessionStream(directory: string | null, sessionId: string | null) {
  const scopeKey = `${directory ?? ""}\u0000${sessionId ?? ""}`;
  const [state, dispatch] = useReducer(
    sessionStreamReducer,
    scopeKey,
    (key) => readCachedSessionState(key) ?? createInitialStreamState(key),
  );
  const sessionRef = useRef(sessionId);
  const scopeRef = useRef(scopeKey);
  const resyncGenRef = useRef(0);
  const statusRef = useRef(state.status);
  /** After sendPrompt/sendCommand until busy/idle SSE — suppress message init races. */
  const pendingMutationRef = useRef(false);
  const abortingRef = useRef(false);
  const [aborting, setAborting] = useState(false);
  const connectionRef = useRef<ConnectionState>(state.connection);
  /** After SSE reconnect, trust REST status for one resync (may have gone idle offline). */
  const preferRestStatusRef = useRef(false);
  /** Consecutive REST idle snapshots seen while local status stayed busy. */
  const idleStreakRef = useRef(0);
  /** Last SSE event scoped to this session — proves the turn is still running. */
  const sessionActivityAtRef = useRef(Date.now());
  /** Track safety net timers to clear on unmount/session change */
  const safetyNetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tracks elapsed-time tick for the in-flight mutation. */
  const mutationElapsedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationStartedAtRef = useRef<number | null>(null);
  const autoRetryRequestRef = useRef<AutoRetryRequest | null>(null);
  const autoRetryUsedRef = useRef(false);
  /** Stable ref to the latest abort() so sendPrompt/sendCommand can call it without a circular dep. */
  const abortRef = useRef<(reason?: string) => Promise<void>>(async () => {});
  /** The single in-flight resync pass, if any — see the `resync` wrapper. */
  const resyncInFlightRef = useRef<Promise<void> | null>(null);
  /** A resync was requested while one was already running. */
  const resyncQueuedRef = useRef(false);
  /** False once any queued caller needs the full message refetch. */
  const resyncQueuedTrustSseRef = useRef(true);
  /** Wall-clock duration of the last resync pass, for the adaptive reconcile delay. */
  const lastResyncMsRef = useRef(0);
  const messageCountRef = useRef(state.messages.length);
  sessionRef.current = sessionId;
  scopeRef.current = scopeKey;
  statusRef.current = state.status;
  connectionRef.current = state.connection;
  messageCountRef.current = state.messages.length;

  const clearMutationTimers = useCallback(() => {
    if (mutationElapsedTimerRef.current) {
      clearTimeout(mutationElapsedTimerRef.current);
      mutationElapsedTimerRef.current = null;
    }
    if (safetyNetTimerRef.current) {
      clearTimeout(safetyNetTimerRef.current);
      safetyNetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    dispatch({ kind: "reset", scopeKey, cached: readCachedSessionState(scopeKey) });
    pendingMutationRef.current = false;
    mutationStartedAtRef.current = null;
    autoRetryRequestRef.current = null;
    autoRetryUsedRef.current = false;
    preferRestStatusRef.current = false;
    idleStreakRef.current = 0;
    sessionActivityAtRef.current = Date.now();
    // A slow pass on the previous session must not delay the new session's first
    // reconcile.
    lastResyncMsRef.current = 0;
    clearMutationTimers();
  }, [scopeKey, clearMutationTimers]);

  // A session can keep its SSE connection alive while the active turn itself
  // is stuck (for example, a detached shell process). Abort only after the
  // full turn has been busy for five minutes, then retry the exact request
  // once after abort() has completed and resync has observed the idle state.
  useEffect(() => {
    const busy = state.status?.type === "busy" || state.status?.type === "retry";
    if (!busy || !directory || !sessionId || !autoRetryRequestRef.current || autoRetryUsedRef.current) {
      if (!busy) {
        mutationStartedAtRef.current = null;
        autoRetryRequestRef.current = null;
        autoRetryUsedRef.current = false;
      }
      return;
    }
    const startedAt = mutationStartedAtRef.current ?? Date.now();
    const remaining = Math.max(0, SESSION_HANG_TIMEOUT_MS - (Date.now() - startedAt));
    const timer = window.setTimeout(() => {
      const request = autoRetryRequestRef.current;
      if (!request || autoRetryUsedRef.current) return;
      autoRetryUsedRef.current = true;
      autoRetryRequestRef.current = null;
      void (async () => {
        await abortRef.current(
          `5分間応答がないため停止し、同じ処理を1回だけ再開します`,
        );
        if (sessionRef.current !== sessionId || scopeRef.current !== scopeKey) return;
        mutationStartedAtRef.current = Date.now();
        dispatch({ kind: "status", status: { type: "busy" } });
        dispatch({ kind: "sessionError", message: "ハング検知後に自動再開しました" });
        try {
          await ocJson(request.path, directory, {
            method: "POST",
            body: request.body,
            timeoutMs: request.timeoutMs,
          });
        } catch (error) {
          dispatch({
            kind: "sessionError",
            message: error instanceof Error ? error.message : "自動再開に失敗しました",
          });
        }
      })();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [directory, scopeKey, sessionId, state.status?.type]);

  useEffect(() => {
    rememberSessionState(state);
  }, [state]);

  // Cleanup safety net + elapsed timers on unmount
  useEffect(() => {
    return () => {
      clearMutationTimers();
    };
  }, [clearMutationTimers]);

  const runResync = useCallback(async (options?: ResyncOptions) => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    const requestedScope = `${directory}\u0000${sid}`;
    const gen = ++resyncGenRef.current;
    const syncStartedAt = Date.now();
    const stale = () =>
      scopeRef.current !== requestedScope || gen !== resyncGenRef.current;

    // The full-history refetch is by far the most expensive call in this pass,
    // so the periodic reconcile skips it while SSE is provably delivering.
    const skipMessages =
      options?.trustSseForMessages === true &&
      shouldTrustSseForMessages({
        connection: connectionRef.current,
        sessionQuietMs: Date.now() - sessionActivityAtRef.current,
        messageCount: messageCountRef.current,
      });

    let messageError: unknown = null;
    if (!skipMessages) {
      try {
        const rows = await ocJson<MessageWithParts[]>(
          `/session/${sid}/message`,
          directory,
        );
        if (stale()) return;
        // While streaming, a full REST replace can wipe in-flight session.next
        // deltas that the server snapshot has not caught up to yet.
        // Do not require `loaded` — opening an already-busy session can receive
        // SSE deltas before the first resync completes.
        const streaming =
          pendingMutationRef.current ||
          statusRef.current?.type === "busy" ||
          statusRef.current?.type === "retry";
        // Early send before the first REST snapshot can leave messages empty for
        // the whole turn if we skip init while streaming. Allow init when empty.
        const messages = Array.isArray(rows) ? rows : [];
        if (!streaming || messageCountRef.current === 0) {
          dispatch({ kind: "init", messages });
        } else {
          dispatch({ kind: "mergeRestMessages", messages });
        }
      } catch (err) {
        messageError = err;
      }
    }

    try {
      const statuses = await ocJson<Record<string, SessionStatus>>(
        "/session/status",
        directory,
      );
      if (stale()) return;
      const restStatus = statuses[sid];
      const localBusy =
        statusRef.current?.type === "busy" ||
        statusRef.current?.type === "retry";
      // `/session/status` omits sessions the engine is no longer tracking, so a
      // missing entry means "not running" (server-side `task-status.ts` derives
      // the same). Synthesize idle only when a local busy state would otherwise
      // never clear, so a just-sent prompt keeps its lock. While a mutation is
      // pending we wait a short grace period for the engine to emit status; once
      // that grace has passed the terminal SSE event is treated as lost.
      const quietSinceMutation =
        Date.now() - sessionActivityAtRef.current >= MUTATION_LOST_EVENT_GRACE_MS;
      const canSynthesizeIdle =
        localBusy &&
        (!pendingMutationRef.current || quietSinceMutation);
      const next: SessionStatus | undefined =
        restStatus ?? (canSynthesizeIdle ? { type: "idle" } : undefined);
      if (next) {
        if (next.type === "idle" && localBusy) idleStreakRef.current += 1;
        else idleStreakRef.current = 0;
        const decision = resolveResyncStatus({
          pendingMutation: pendingMutationRef.current,
          preferRestStatus: preferRestStatusRef.current,
          connection: connectionRef.current,
          currentType: statusRef.current?.type,
          next,
          idleStreak: idleStreakRef.current,
          sessionQuietMs: Date.now() - sessionActivityAtRef.current,
        });
        if (decision.clearPending) pendingMutationRef.current = false;
        if (decision.apply) {
          idleStreakRef.current = 0;
          dispatch({ kind: "status", status: next });
          // Clear error banner only once the turn is actually idle — a successful
          // message fetch must not hide session.error while status is still busy.
          if (next.type === "idle") {
            dispatch({ kind: "sessionError", message: null });
            // The turn is over: stop the elapsed ticker and clear its display.
            clearMutationTimers();
            dispatch({ kind: "mutationStarted", startedAt: 0 });
          }
        }
      }
    } catch (err) {
      if (!messageError) messageError = err;
    }

    try {
      const session = await ocJson<{ revert?: SessionRevert | null }>(
        `/session/${sid}`,
        directory,
      );
      if (stale()) return;
      dispatch({ kind: "revert", revert: session.revert ?? null });
    } catch {
      if (stale()) return;
      dispatch({ kind: "revert", revert: null });
    }

    // Recover todos
    try {
      const todos = await ocJson<Todo[]>(`/session/${sid}/todo`, directory);
      if (stale()) return;
      if (Array.isArray(todos)) dispatch({ kind: "todos", todos });
    } catch {
      /* non-fatal */
    }

    // Recover pending permissions (v1 list + v2 session-scoped list).
    // Always attempted even when message fetch failed, so answered cards clear.
    try {
      type PermRow = {
        id?: string;
        sessionID?: string;
        permission?: string;
        action?: string;
        patterns?: string[];
        resources?: string[];
      };
      const normalizeList = (pending: unknown): PermRow[] => {
        if (Array.isArray(pending)) return pending as PermRow[];
        if (
          pending &&
          typeof pending === "object" &&
          Array.isArray((pending as { data?: unknown }).data)
        ) {
          return (pending as { data: PermRow[] }).data;
        }
        return [];
      };
      const toRequest = (
        p: PermRow,
        version: "v1" | "v2",
      ): PermissionRequest | null => {
        const id = String(p.id ?? "");
        const sessionID = String(p.sessionID ?? sid);
        if (!id || sessionID !== sid) return null;
        return {
          id,
          version,
          sessionID,
          permission: String(p.permission ?? p.action ?? "permission"),
          patterns: (p.patterns ?? p.resources ?? []) as string[],
          receivedAt: Date.now(),
        };
      };
      const v1raw = await ocJson<unknown>("/permission", directory).catch(
        () => [],
      );
      let v2ok = false;
      let v2raw: unknown = [];
      try {
        v2raw = await ocJson<unknown>(
          `/api/session/${sid}/permission`,
          directory,
        );
        v2ok = true;
      } catch {
        v2ok = false;
      }
      if (stale()) return;
      const byId = new Map<string, PermissionRequest>();
      for (const p of normalizeList(v1raw)) {
        const req = toRequest(p, "v1");
        if (req) byId.set(req.id, req);
      }
      if (v2ok) {
        for (const p of normalizeList(v2raw)) {
          const req = toRequest(p, "v2");
          if (req) byId.set(req.id, req);
        }
      }
      dispatch({
        kind: "permissionsSynced",
        requests: dropRecentlyReplied([...byId.values()]),
        keepLocalV2: !v2ok,
        syncStartedAt,
      });
    } catch {
      /* non-fatal */
    }

    // Recover pending questions (v1 + v2). Same merge rationale as permissions.
    try {
      type QRow = {
        id?: string;
        sessionID?: string;
        questions?: QuestionInfo[];
      };
      const normalizeList = (pending: unknown): QRow[] => {
        if (Array.isArray(pending)) return pending as QRow[];
        if (
          pending &&
          typeof pending === "object" &&
          Array.isArray((pending as { data?: unknown }).data)
        ) {
          return (pending as { data: QRow[] }).data;
        }
        return [];
      };
      const toRequest = (
        q: QRow,
        version: "v1" | "v2",
      ): QuestionRequest | null => {
        const id = String(q.id ?? "");
        const sessionID = String(q.sessionID ?? sid);
        if (!id || sessionID !== sid) return null;
        return {
          id,
          version,
          sessionID,
          questions: q.questions ?? [],
          receivedAt: Date.now(),
        };
      };
      const v1raw = await ocJson<unknown>("/question", directory).catch(
        () => [],
      );
      let v2ok = false;
      let v2raw: unknown = [];
      try {
        v2raw = await ocJson<unknown>(
          `/api/session/${sid}/question`,
          directory,
        );
        v2ok = true;
      } catch {
        v2ok = false;
      }
      if (stale()) return;
      const byId = new Map<string, QuestionRequest>();
      for (const q of normalizeList(v1raw)) {
        const req = toRequest(q, "v1");
        if (req) byId.set(req.id, req);
      }
      if (v2ok) {
        for (const q of normalizeList(v2raw)) {
          const req = toRequest(q, "v2");
          if (req) byId.set(req.id, req);
        }
      }
      dispatch({
        kind: "questionsSynced",
        requests: dropRecentlyReplied([...byId.values()]),
        keepLocalV2: !v2ok,
        syncStartedAt,
      });
    } catch {
      /* non-fatal: SSE will deliver question.asked */
    }

    if (stale()) return;
    if (messageError) {
      dispatch({
        kind: "sessionError",
        message:
          messageError instanceof Error
            ? messageError.message
            : "読み込みに失敗しました",
      });
    }
  }, [directory, clearMutationTimers]);

  /**
   * Serialize resyncs.
   *
   * A pass issues eight sequential requests, so overlapping passes are what turn
   * a merely slow engine into an unusable one: the 3s reconcile used to start a
   * new pass while several earlier ones were still waiting, multiplying the load
   * on the very engine that was already too slow to answer. Only one pass runs at
   * a time; requests that arrive during a pass collapse into a single follow-up
   * pass so the newest state is still picked up.
   *
   * The follow-up keeps the *strictest* option any queued caller asked for: if
   * anything wanted a full refetch, the follow-up refetches.
   */
  const resync = useCallback(
    (options?: ResyncOptions): Promise<void> => {
      if (resyncInFlightRef.current) {
        resyncQueuedRef.current = true;
        if (options?.trustSseForMessages !== true) {
          resyncQueuedTrustSseRef.current = false;
        }
        return resyncInFlightRef.current;
      }
      const run = (async () => {
        let pending = options;
        try {
          for (;;) {
            resyncQueuedRef.current = false;
            resyncQueuedTrustSseRef.current = true;
            const startedAt = Date.now();
            await runResync(pending);
            lastResyncMsRef.current = Date.now() - startedAt;
            if (!resyncQueuedRef.current) break;
            pending = { trustSseForMessages: resyncQueuedTrustSseRef.current };
          }
        } finally {
          resyncInFlightRef.current = null;
          resyncQueuedRef.current = false;
        }
      })();
      resyncInFlightRef.current = run;
      return run;
    },
    [runResync],
  );

  useEffect(() => {
    if (!directory || !sessionId) return;

    const effectScope = `${directory}\u0000${sessionId}`;
    let cancelled = false;
    let es: EventSource | null = null;
    let retryMs = 1000;
    let failStreak = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let nextResyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityAt = Date.now();
    /** When the current EventSource attempt started — drives the connect-stall guard. */
    let connectStartedAt = Date.now();
    /** Accrue session.next.tool.input.delta fragments until .ended / .called. */
    const toolInputBuf = new Map<string, string>();
    const markActivity = () => {
      lastActivityAt = Date.now();
    };
    const scheduleNextResync = () => {
      if (nextResyncTimer) clearTimeout(nextResyncTimer);
      nextResyncTimer = setTimeout(() => {
        nextResyncTimer = null;
        if (scopeRef.current !== effectScope) return;
        void resync();
      }, 300);
    };

    void resync();

    const handleEvent = (raw: string) => {
      markActivity();
      if (scopeRef.current !== effectScope) return;
      let payload: {
        type?: string;
        properties?: Record<string, unknown>;
        data?: Record<string, unknown>;
      };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const type = payload.type ?? "";
      const props = (payload.properties ?? payload.data ?? {}) as Record<
        string,
        unknown
      >;
      const sid = sessionRef.current;
      // Any event that belongs to this session proves the turn is still moving,
      // so it resets the stuck-busy recovery window in `resync`.
      const eventSid =
        (props.sessionID as string | undefined) ??
        (props.info as { sessionID?: string } | undefined)?.sessionID ??
        (props.part as { sessionID?: string } | undefined)?.sessionID;
      if (sid && eventSid === sid) {
        sessionActivityAtRef.current = Date.now();
        idleStreakRef.current = 0;
      }

      if (type === "message.updated") {
        const info = props.info as MessageInfo | undefined;
        const eventSession =
          (props.sessionID as string | undefined) ?? info?.sessionID;
        if (info && eventSession === sid) {
          dispatch({ kind: "messageUpdated", info });
        }
        return;
      }
      if (type === "message.removed") {
        if (props.sessionID === sid && typeof props.messageID === "string") {
          dispatch({ kind: "messageRemoved", messageID: props.messageID });
        }
        return;
      }
      if (type === "message.part.updated") {
        const part = props.part as Part | undefined;
        const eventSession = (props.sessionID as string) ?? part?.sessionID;
        if (part && eventSession === sid) {
          dispatch({ kind: "partUpdated", part });
        }
        return;
      }
      if (type === "message.part.removed") {
        if (
          props.sessionID === sid &&
          typeof props.messageID === "string" &&
          typeof props.partID === "string"
        ) {
          dispatch({
            kind: "partRemoved",
            messageID: props.messageID,
            partID: props.partID,
          });
        }
        return;
      }
      if (type === "session.status") {
        if (props.sessionID === sid && props.status) {
          const status = props.status as SessionStatus;
          if (status.type === "busy" || status.type === "retry" || status.type === "idle") {
            pendingMutationRef.current = false;
          }
          dispatch({ kind: "status", status });
          if (status.type === "idle") {
            dispatch({ kind: "sessionError", message: null });
          }
        }
        return;
      }
      if (type === "session.idle") {
        if (props.sessionID === sid) {
          pendingMutationRef.current = false;
          dispatch({ kind: "status", status: { type: "idle" } });
          dispatch({ kind: "sessionError", message: null });
          // After busy-period init skip, pull the authoritative message list.
          scheduleNextResync();
        }
        return;
      }
      if (type === "session.compacted") {
        if (props.sessionID === sid) {
          scheduleNextResync();
        }
        return;
      }
      if (type === "session.error") {
        const err = props.error as { data?: { message?: string } } | undefined;
        // Only surface errors that clearly belong to this session.
        if (props.sessionID === sid) {
          pendingMutationRef.current = false;
          dispatch({
            kind: "sessionError",
            message: err?.data?.message ?? "セッションでエラーが発生しました",
          });
          // Engine may omit idle after error — trust REST status/messages.
          preferRestStatusRef.current = true;
          void resync().finally(() => {
            preferRestStatusRef.current = false;
          });
        }
        return;
      }
      if (type === "todo.updated") {
        if (props.sessionID === sid && Array.isArray(props.todos)) {
          dispatch({ kind: "todos", todos: props.todos as Todo[] });
        }
        return;
      }
      if (type === "permission.asked" || type === "permission.v2.asked") {
        const id = String(props.id ?? "");
        const sessionID = String(props.sessionID ?? "");
        if (!id || sessionID !== sid) return;
        if (wasRecentlyReplied(id, sessionID)) return;
        dispatch({
          kind: "permissionAsked",
          request: {
            id,
            version: type === "permission.asked" ? "v1" : "v2",
            sessionID,
            permission: String(props.permission ?? props.action ?? "permission"),
            patterns: (props.patterns ?? props.resources ?? []) as string[],
            metadata: props.metadata as Record<string, unknown> | undefined,
            always: props.always as string[] | undefined,
            receivedAt: Date.now(),
          },
        });
        return;
      }
      if (type === "permission.replied" || type === "permission.v2.replied") {
        if (!props.sessionID || props.sessionID !== sid) return;
        const requestId = String(props.requestID ?? props.id ?? "");
        if (requestId) {
          rememberReplied(requestId, props.sessionID as string);
          dispatch({ kind: "permissionReplied", requestId });
        }
        return;
      }
      if (type === "question.asked" || type === "question.v2.asked") {
        const id = String(props.id ?? "");
        const sessionID = String(props.sessionID ?? "");
        if (!id || sessionID !== sid) return;
        if (wasRecentlyReplied(id, sessionID)) return;
        const questions = (props.questions ?? []) as QuestionInfo[];
        dispatch({
          kind: "questionAsked",
          request: {
            id,
            version: type === "question.asked" ? "v1" : "v2",
            sessionID,
            questions,
            receivedAt: Date.now(),
          },
        });
        return;
      }
      if (
        type === "question.replied" ||
        type === "question.rejected" ||
        type === "question.v2.replied" ||
        type === "question.v2.rejected"
      ) {
        if (!props.sessionID || props.sessionID !== sid) return;
        const requestId = String(props.requestID ?? props.id ?? "");
        if (requestId) {
          rememberReplied(requestId, props.sessionID as string);
          dispatch({ kind: "questionReplied", requestId });
        }
        return;
      }

      // OpenCode "session.next.*" streaming events (v2 path).
      if (type.startsWith("session.next.") && sid && props.sessionID === sid) {
        if (
          type === "session.next.text.started" ||
          type === "session.next.reasoning.started"
        ) {
          const partType =
            type === "session.next.reasoning.started" ? "reasoning" : "text";
          const partID = String(
            (partType === "text" ? props.textID : props.reasoningID) ?? "",
          );
          const messageID = String(props.assistantMessageID ?? "");
          if (partID && messageID) {
            dispatch({
              kind: "partUpdated",
              part: {
                id: partID,
                messageID,
                sessionID: sid,
                type: partType,
                text: "",
                time: { start: Number(props.timestamp) || undefined },
              },
            });
          }
          return;
        }
        if (
          type === "session.next.text.delta" ||
          type === "session.next.reasoning.delta"
        ) {
          const partType =
            type === "session.next.reasoning.delta" ? "reasoning" : "text";
          const partID = String(
            (partType === "text" ? props.textID : props.reasoningID) ?? "",
          );
          const messageID = String(props.assistantMessageID ?? "");
          const delta = typeof props.delta === "string" ? props.delta : "";
          if (partID && messageID && delta) {
            dispatch({
              kind: "partTextDelta",
              messageID,
              partID,
              delta,
              partType,
              sessionID: sid,
            });
          }
          return;
        }
        if (
          type === "session.next.text.ended" ||
          type === "session.next.reasoning.ended"
        ) {
          const partType =
            type === "session.next.reasoning.ended" ? "reasoning" : "text";
          const partID = String(
            (partType === "text" ? props.textID : props.reasoningID) ?? "",
          );
          const messageID = String(props.assistantMessageID ?? "");
          if (partID && messageID) {
            const endedText =
              typeof props.text === "string" ? props.text : undefined;
            dispatch({
              kind: "partUpdated",
              part: {
                id: partID,
                messageID,
                sessionID: sid,
                type: partType,
                ...(endedText !== undefined ? { text: endedText } : {}),
                time: {
                  end: Number(props.timestamp) || undefined,
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.input.started") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            toolInputBuf.set(callID, "");
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: String(props.name ?? "tool"),
                callID,
                state: {
                  status: "pending",
                  time: { start: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.input.delta") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          const delta = typeof props.delta === "string" ? props.delta : "";
          if (callID && messageID && delta) {
            const raw = (toolInputBuf.get(callID) ?? "") + delta;
            toolInputBuf.set(callID, raw);
            let input: Record<string, unknown> = { _partial: raw };
            try {
              const parsed = JSON.parse(raw) as unknown;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                input = parsed as Record<string, unknown>;
              }
            } catch {
              /* partial JSON while streaming */
            }
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "pending",
                  input,
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.input.ended") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            const text =
              typeof props.text === "string"
                ? props.text
                : (toolInputBuf.get(callID) ?? "");
            toolInputBuf.delete(callID);
            let input: Record<string, unknown> = {};
            if (text) {
              try {
                const parsed = JSON.parse(text) as unknown;
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  input = parsed as Record<string, unknown>;
                } else {
                  input = { raw: text };
                }
              } catch {
                input = { raw: text };
              }
            }
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "pending",
                  input,
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.called") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            toolInputBuf.delete(callID);
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: String(props.tool ?? "tool"),
                callID,
                state: {
                  status: "running",
                  input: (props.input as Record<string, unknown>) ?? {},
                  time: { start: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          return;
        }
        if (type === "session.next.tool.success") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            const content = Array.isArray(props.content) ? props.content : [];
            const output = content
              .map((c) => {
                if (c && typeof c === "object" && "text" in c) {
                  return String((c as { text?: string }).text ?? "");
                }
                return "";
              })
              .filter(Boolean)
              .join("\n");
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: "completed",
                  output,
                  metadata: (props.structured as Record<string, unknown>) ?? {},
                  time: { end: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          scheduleNextResync();
          return;
        }
        if (type === "session.next.tool.failed") {
          const callID = String(props.callID ?? "");
          const messageID = String(props.assistantMessageID ?? "");
          if (callID && messageID) {
            const err = props.error as { message?: string } | undefined;
            dispatch({
              kind: "partUpdated",
              part: {
                id: callID,
                messageID,
                sessionID: sid,
                type: "tool",
                tool: "tool",
                callID,
                state: {
                  status: classifyToolFailureStatus(err?.message),
                  error: err?.message ?? "tool failed",
                  time: { end: Number(props.timestamp) || undefined },
                },
              },
            });
          }
          scheduleNextResync();
          return;
        }
        if (type === "session.next.step.failed") {
          const err = props.error as { data?: { message?: string }; message?: string } | undefined;
          pendingMutationRef.current = false;
          dispatch({
            kind: "sessionError",
            message:
              err?.data?.message ??
              err?.message ??
              "セッションのステップが失敗しました",
          });
          preferRestStatusRef.current = true;
          void resync().finally(() => {
            preferRestStatusRef.current = false;
          });
          return;
        }
        // Compaction / revert / prompt lifecycle: rely on REST resync.
        scheduleNextResync();
      }
    };

    const connect = (
      isReconnect: boolean,
      reason: "initial" | "error" | "silence" = "initial",
    ) => {
      void reason;
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (es) {
        es.onerror = null;
        es.close();
      }
      dispatch({
        kind: "connection",
        connection: isReconnect ? "reconnecting" : "connecting",
      });
      connectStartedAt = Date.now();
      es = new EventSource(apiUrl("/api/opencode/event", { directory }));

      es.onopen = () => {
        markActivity();
        retryMs = 1000;
        failStreak = 0;
        dispatch({ kind: "connection", connection: "live" });
        if (isReconnect) {
          // After any reconnection (not just error), trust REST status for one
          // resync. The session may have gone idle while disconnected, and the
          // staleIdle guard would otherwise prevent the update (R9#1).
          preferRestStatusRef.current = true;
          void resync().finally(() => {
            preferRestStatusRef.current = false;
          });
        }
      };
      es.onmessage = (ev) => handleEvent(ev.data);
      es.addEventListener("heartbeat", () => {
        markActivity();
      });
      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        failStreak += 1;
        dispatch({
          kind: "connection",
          connection: failStreak >= 5 ? "down" : "reconnecting",
        });
        timer = setTimeout(() => connect(true, "error"), retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
    };

    const silenceWatch = setInterval(() => {
      if (cancelled || !es) return;
      if (es.readyState === EventSource.CONNECTING) {
        // A stalled engine can leave the stream in CONNECTING indefinitely, and
        // the silence check below never fires because it needs an OPEN stream.
        // Without this the WebUI sits in "reconnecting" with nothing to recover
        // it. Only CONNECTING is retried here — a CLOSED stream is already
        // waiting on the backoff timer and must not be reconnected early.
        if (isSseConnectStalled(connectStartedAt, Date.now())) {
          connect(true, "silence");
        }
        return;
      }
      if (es.readyState !== EventSource.OPEN) return;
      if (!isSseSilent(lastActivityAt, Date.now(), SSE_SILENCE_MS)) return;
      connect(true, "silence");
    }, 5_000);

    // Self-scheduling rather than a fixed interval: the next pass is only queued
    // once the previous one has finished, and its delay grows with how long that
    // pass actually took. A fixed 3s interval kept firing into a saturated engine.
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleReconcile(delayMs: number) {
      if (reconcileTimer) clearTimeout(reconcileTimer);
      reconcileTimer = setTimeout(() => {
        void runReconcile();
      }, delayMs);
    }
    async function runReconcile() {
      reconcileTimer = null;
      if (cancelled) return;
      const statusType = statusRef.current?.type;
      const active =
        document.visibilityState === "visible" &&
        (pendingMutationRef.current ||
          statusType === "busy" ||
          statusType === "retry");
      let delayMs = ACTIVE_SESSION_RECONCILE_MS;
      if (active) {
        await resync({ trustSseForMessages: true });
        delayMs = nextReconcileDelayMs(lastResyncMsRef.current);
      }
      if (cancelled) return;
      scheduleReconcile(delayMs);
    }
    scheduleReconcile(ACTIVE_SESSION_RECONCILE_MS);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      markActivity();
      void resync();
    };
    document.addEventListener("visibilitychange", onVisible);

    const onOnline = () => {
      if (cancelled) return;
      markActivity();
      connect(true, "error");
    };
    window.addEventListener("online", onOnline);

    connect(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (nextResyncTimer) clearTimeout(nextResyncTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      clearInterval(silenceWatch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      es?.close();
    };
  }, [directory, sessionId, resync]);

  /**
   * Start an elapsed-time ticker for the in-flight mutation.
   * Returns a function that stops the ticker.
   */
  const startMutationElapsed = useCallback(
    (startedAt: number, onTick?: (elapsedMs: number) => void) => {
      clearMutationTimers();
      dispatch({ kind: "mutationStarted", startedAt });
      const tick = () => {
        const elapsedMs = Date.now() - startedAt;
        dispatch({ kind: "mutationElapsed", elapsedMs });
        onTick?.(elapsedMs);
        mutationElapsedTimerRef.current = setTimeout(tick, 1_000);
      };
      mutationElapsedTimerRef.current = setTimeout(tick, 1_000);
      return clearMutationTimers;
    },
    [clearMutationTimers],
  );

  const sendPrompt = useCallback(
    async (
      text: string,
      opts?: {
        agent?: string;
        model?: { providerID: string; modelID: string };
        files?: { uri: string; mime: string; name?: string }[];
        variant?: IntelligenceVariant;
        /** Pin the target session so an in-flight SessionSwitcher cannot redirect the POST. */
        sessionId?: string;
      },
    ) => {
      const sid = opts?.sessionId ?? sessionRef.current;
      if (!directory || !sid) throw new Error("session not ready");
      // Guard resync init for the whole POST window, not only after success.
      pendingMutationRef.current = true;
      // Start the stuck-busy recovery window at the send, not at the last event
      // of the previous turn.
      sessionActivityAtRef.current = Date.now();
      idleStreakRef.current = 0;
      dispatch({ kind: "sessionError", message: null });
      dispatch({ kind: "status", status: { type: "busy" } });
      const startedAt = Date.now();
      mutationStartedAtRef.current = startedAt;
      const parts: Record<string, unknown>[] = [{ type: "text", text }];
      if (opts?.files && opts.files.length > 0) {
        for (const f of opts.files) {
          parts.push({
            type: "file",
            mime: f.mime,
            url: f.uri,
            ...(f.name ? { filename: f.name } : {}),
          });
        }
      }
      const body: Record<string, unknown> = { parts };
      if (opts?.agent?.trim()) body.agent = opts.agent.trim();
      if (opts?.model?.providerID && opts.model.modelID) {
        body.model = opts.model;
      }
      if (opts?.variant) {
        body.variant = opts.variant;
      }
      autoRetryRequestRef.current = {
        path: `/session/${sid}/prompt_async`,
        body,
        timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
      };
      autoRetryUsedRef.current = false;
      const stopMutationElapsed = startMutationElapsed(startedAt);
      try {
        await ocJson(`/session/${sid}/prompt_async`, directory, {
          method: "POST",
          body,
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        });
      } catch (err) {
        pendingMutationRef.current = false;
        // Do not flip to idle: the engine may still be busy after a client
        // timeout. Prefer REST and resync so status/composer stay truthful.
        preferRestStatusRef.current = true;
        void resync();
        throw err;
      } finally {
        stopMutationElapsed();
        // safety net: events normally arrive first, resync fills any gap
        if (safetyNetTimerRef.current) clearTimeout(safetyNetTimerRef.current);
        safetyNetTimerRef.current = setTimeout(() => {
          safetyNetTimerRef.current = null;
          void resync();
        }, 800);
      }
    },
    [directory, resync, startMutationElapsed],
  );

  const sendCommand = useCallback(
    async (
      command: string,
      args: string,
      opts?: {
        agent?: string;
        model?: { providerID: string; modelID: string };
        files?: { uri: string; mime: string; name?: string }[];
        variant?: IntelligenceVariant;
        sessionId?: string;
      },
    ) => {
      const sid = opts?.sessionId ?? sessionRef.current;
      if (!directory || !sid) throw new Error("session not ready");
      pendingMutationRef.current = true;
      // Start the stuck-busy recovery window at the send, not at the last event
      // of the previous turn.
      sessionActivityAtRef.current = Date.now();
      idleStreakRef.current = 0;
      dispatch({ kind: "sessionError", message: null });
      dispatch({ kind: "status", status: { type: "busy" } });
      const startedAt = Date.now();
      mutationStartedAtRef.current = startedAt;
      const body: Record<string, unknown> = {
        command,
        arguments: args,
      };
      if (opts?.agent?.trim()) body.agent = opts.agent.trim();
      if (opts?.model?.providerID && opts.model.modelID) {
        // OpenAPI session.command expects model as "provider/model" string.
        body.model = `${opts.model.providerID}/${opts.model.modelID}`;
      }
      if (opts?.variant) body.variant = opts.variant;
      if (opts?.files && opts.files.length > 0) {
        body.parts = opts.files.map((f) => ({
          type: "file",
          mime: f.mime,
          url: f.uri,
          ...(f.name ? { filename: f.name } : {}),
        }));
      }
      autoRetryRequestRef.current = {
        path: `/session/${sid}/command`,
        body,
        timeoutMs: SESSION_COMMAND_TIMEOUT_MS,
      };
      autoRetryUsedRef.current = false;
      const stopMutationElapsed = startMutationElapsed(startedAt);
      try {
        await ocJson(`/session/${sid}/command`, directory, {
          method: "POST",
          body,
          timeoutMs: SESSION_COMMAND_TIMEOUT_MS,
        });
      } catch (err) {
        pendingMutationRef.current = false;
        preferRestStatusRef.current = true;
        void resync();
        throw err;
      } finally {
        stopMutationElapsed();
        // safety net: events normally arrive first, resync fills any gap
        if (safetyNetTimerRef.current) clearTimeout(safetyNetTimerRef.current);
        safetyNetTimerRef.current = setTimeout(() => {
          safetyNetTimerRef.current = null;
          void resync();
        }, 800);
      }
    },
    [directory, resync, startMutationElapsed],
  );

  // Re-fetch the todo list on demand. The engine occasionally skips the final
  // `todo.updated` event when a session goes idle, which left the "進行中" badge
  // stuck after completion. Callers (e.g. TaskView on busy→idle) use this to
  // reconcile the displayed list with the server state.
  const refreshTodos = useCallback(async () => {
    const sid = sessionRef.current;
    if (!directory || !sid) return;
    const requestedScope = `${directory}\u0000${sid}`;
    try {
      const todos = await ocJson<Todo[]>(`/session/${sid}/todo`, directory);
      // Directory 切替と競合した in-flight 応答で古い todos を載せない。
      if (scopeRef.current !== requestedScope || sessionRef.current !== sid) {
        return;
      }
      if (Array.isArray(todos)) dispatch({ kind: "todos", todos });
    } catch {
      /* non-fatal: SSE may still deliver updates */
    }
  }, [directory]);

  const abort = useCallback(
    async (reason?: string) => {
      const sid = sessionRef.current;
      if (!directory || !sid) return;
      if (abortingRef.current) return;
      abortingRef.current = true;
      setAborting(true);
      // Unlock immediately so a hung/failed abort POST cannot freeze the composer.
      pendingMutationRef.current = false;
      statusRef.current = { type: "idle" };
      dispatch({ kind: "status", status: { type: "idle" } });
      clearMutationTimers();
      if (reason) {
        dispatch({ kind: "sessionError", message: reason });
      }
      // If abort fails and the session is still busy, REST must re-lock.
      preferRestStatusRef.current = true;
      try {
        await ocJson(`/session/${sid}/abort`, directory, {
          method: "POST",
          timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
        });
      } finally {
        // Reset preferRestStatus immediately after abort completes so that
        // subsequent sends are not affected by the stale idle guard (R17).
        preferRestStatusRef.current = false;
        try {
          if (sessionRef.current === sid) await resync();
        } catch {
          /* non-fatal */
        } finally {
          abortingRef.current = false;
          setAborting(false);
        }
      }
    },
    [directory, resync, clearMutationTimers],
  );
  abortRef.current = abort;

  const replyPermission = useCallback(
    async (request: PermissionRequest, response: "once" | "always" | "reject") => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/permission/${request.id}/reply`,
            directory,
            {
              method: "POST",
              body: { reply: response },
              timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
            },
          );
        } else {
          await ocJson(
            `/session/${request.sessionID}/permissions/${request.id}`,
            directory,
            {
              method: "POST",
              body: { response },
              timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
            },
          );
        }
      } catch (err) {
        // 404 = already answered elsewhere; drop it from the queue either way
        const is404 =
          (err instanceof ApiError && err.status === 404) ||
          (err instanceof Error && /404/.test(err.message));
        if (!is404) throw err;
      }
      rememberReplied(request.id, request.sessionID);
      dispatch({ kind: "permissionReplied", requestId: request.id });
    },
    [directory],
  );

  const replyQuestion = useCallback(
    async (request: QuestionRequest, answers: string[][]) => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/question/${request.id}/reply`,
            directory,
            {
              method: "POST",
              body: { answers },
              timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
            },
          );
        } else {
          await ocJson(`/question/${request.id}/reply`, directory, {
            method: "POST",
            body: { answers },
            timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
          });
        }
      } catch (err) {
        const is404 =
          (err instanceof ApiError && err.status === 404) ||
          (err instanceof Error && /404/.test(err.message));
        if (!is404) throw err;
      }
      rememberReplied(request.id, request.sessionID);
      dispatch({ kind: "questionReplied", requestId: request.id });
    },
    [directory],
  );

  const rejectQuestion = useCallback(
    async (request: QuestionRequest) => {
      if (!directory) return;
      try {
        if (request.version === "v2") {
          await ocJson(
            `/api/session/${request.sessionID}/question/${request.id}/reject`,
            directory,
            { method: "POST", timeoutMs: SESSION_MUTATION_TIMEOUT_MS },
          );
        } else {
          await ocJson(`/question/${request.id}/reject`, directory, {
            method: "POST",
            timeoutMs: SESSION_MUTATION_TIMEOUT_MS,
          });
        }
      } catch (err) {
        const is404 =
          (err instanceof ApiError && err.status === 404) ||
          (err instanceof Error && /404/.test(err.message));
        if (!is404) throw err;
      }
      rememberReplied(request.id, request.sessionID);
      dispatch({ kind: "questionReplied", requestId: request.id });
    },
    [directory],
  );

  // Effects reset the reducer after a scope change. Gate the render as well so
  // React never paints the previous session's messages during that transition.
  const visibleState =
    state.scopeKey === scopeKey ? state : createInitialStreamState(scopeKey);
  const visibleMessages = useMemo(
    () =>
      filterCompactionContinueMessages(
        filterGoalLoopMessages(
          filterRevertedMessages(visibleState.messages, visibleState.revert),
        ),
      ),
    [visibleState.messages, visibleState.revert],
  );

  return {
    ...visibleState,
    visibleMessages,
    aborting,
    resync,
    sendPrompt,
    sendCommand,
    abort,
    refreshTodos,
    replyPermission,
    replyQuestion,
    rejectQuestion,
  };
}

/** Format elapsed seconds as a compact human-readable string. */
export function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${String(remM).padStart(2, "0")}m`;
}
