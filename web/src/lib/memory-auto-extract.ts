/**
 * Server-side automatic memory extraction for ordinary conversation turns.
 *
 * The browser already consumes OpenCode's SSE stream for rendering, but that
 * is not a reliable automation trigger because no browser may be open. This
 * module owns one process-level `/global/event` observer and schedules a
 * background extraction whenever a completed assistant message is observed.
 */

import {
  claimAssistantMemoryExtraction,
  completeAssistantMemoryExtraction,
  findWorkspaceIdsBySessionAndDirectory,
  hasActiveGoalLoopForSession,
  markIdleExtracted,
  releaseAssistantMemoryExtraction,
  touchSessionActivity,
  type MemoryAssistantExtractClaim,
  type MemoryExtractionTrigger,
} from "./db";
import { getSetting } from "./db";
import { runMemoryExtraction } from "./memory-extract";
import { MEMORY_AUTO_EXTRACT_SETTING_KEY } from "./memory-settings";
import { OPENCODE_BASE_URL } from "./opencode";

const MAX_RECONNECT_DELAY_MS = 15_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export type CompletedAssistantEvent = {
  directory: string;
  sessionId: string;
  assistantMessageId: string;
};

/** Parse the JSON payload of an OpenCode global event. */
export function completedAssistantEvent(raw: string): CompletedAssistantEvent | null {
  let envelope: {
    directory?: unknown;
    type?: unknown;
    properties?: Record<string, unknown>;
    payload?: {
      type?: unknown;
      properties?: Record<string, unknown>;
    };
  };
  try {
    envelope = JSON.parse(raw) as typeof envelope;
  } catch {
    return null;
  }
  const event = envelope.payload ?? envelope;
  const type = String(event.type ?? envelope.type ?? "");
  if (type !== "message.updated") return null;
  const props = event.properties ?? envelope.properties ?? {};
  const info = props.info as {
    id?: unknown;
    sessionID?: unknown;
    role?: unknown;
    time?: { completed?: unknown };
  } | undefined;
  const sessionId = String(props.sessionID ?? info?.sessionID ?? "");
  const directory = String(envelope.directory ?? "");
  if (
    !directory ||
    !sessionId ||
    typeof info?.id !== "string" ||
    info.role !== "assistant" ||
    typeof info.time?.completed !== "number"
  ) {
    return null;
  }
  return {
    directory,
    sessionId,
    assistantMessageId: info.id,
  };
}

/** Extract the `data:` payload from one SSE frame. */
export function sseDataFromFrame(frame: string): string | null {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return data.length > 0 ? data.join("\n") : null;
}

/**
 * Consume an SSE body without depending on browser EventSource. Exported for
 * deterministic tests; the monitor passes each complete data payload to the
 * callback and keeps heartbeat/comment frames out of the callback.
 */
export async function consumeMemoryEventStream(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index === undefined) break;
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = sseDataFromFrame(frame);
      if (data) onData(data);
    }
  }
  buffer += decoder.decode();
  const data = sseDataFromFrame(buffer);
  if (data) onData(data);
}

function isAutoExtractEnabled(): boolean {
  try {
    return getSetting(MEMORY_AUTO_EXTRACT_SETTING_KEY) !== "0";
  } catch {
    return true;
  }
}

function scheduleClaimedExtraction(
  claim: MemoryAssistantExtractClaim,
  trigger: MemoryExtractionTrigger,
): void {
  void runMemoryExtraction({
    workspaceId: claim.workspaceId,
    sessionId: claim.sessionId,
    assistantMessageId: claim.assistantMessageId,
    trigger,
  })
    .then((result) => {
      if (result.error) {
        releaseAssistantMemoryExtraction(claim);
        return;
      }
      completeAssistantMemoryExtraction(claim);
      // A successful per-message extraction makes the one-shot idle fallback
      // redundant for this session. Future messages continue through this
      // message ledger instead.
      markIdleExtracted(claim.workspaceId, claim.sessionId);
    })
    .catch(() => {
      releaseAssistantMemoryExtraction(claim);
    });
}

/**
 * Schedule one assistant-message extraction. Returns true only when this
 * process acquired the durable claim and launched background work.
 */
export function scheduleAssistantMemoryExtraction(input: {
  workspaceId: string;
  sessionId: string;
  assistantMessageId: string;
  trigger?: MemoryExtractionTrigger;
  allowActiveGoalLoop?: boolean;
}): boolean {
  if (!isAutoExtractEnabled()) return false;
  if (
    !input.workspaceId ||
    !input.sessionId ||
    !input.assistantMessageId
  ) {
    return false;
  }
  if (
    !input.allowActiveGoalLoop &&
    hasActiveGoalLoopForSession(input.workspaceId, input.sessionId)
  ) {
    return false;
  }
  const claim = claimAssistantMemoryExtraction(
    input.workspaceId,
    input.sessionId,
    input.assistantMessageId,
  );
  if (!claim) return false;
  scheduleClaimedExtraction(claim, input.trigger ?? "assistant-completed");
  return true;
}

/** Handle one decoded global-event payload and schedule eligible workspaces. */
export function handleMemoryGlobalEvent(raw: string): number {
  const event = completedAssistantEvent(raw);
  if (!event) return 0;
  const workspaces = findWorkspaceIdsBySessionAndDirectory(
    event.sessionId,
    event.directory,
  );
  // Do not guess when a session/directory is shared by multiple workspaces;
  // memory is workspace-scoped and ambiguous ownership would leak context.
  if (workspaces.length !== 1) return 0;
  let scheduled = 0;
  for (const workspaceId of workspaces) {
    touchSessionActivity(workspaceId, event.sessionId);
    if (
      scheduleAssistantMemoryExtraction({
        workspaceId,
        sessionId: event.sessionId,
        assistantMessageId: event.assistantMessageId,
      })
    ) {
      scheduled += 1;
    }
  }
  return scheduled;
}

function waitForReconnect(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

let monitorPromise: Promise<void> | null = null;
let monitorController: AbortController | null = null;

async function runMemoryEventMonitor(signal: AbortSignal): Promise<void> {
  let reconnectMs = INITIAL_RECONNECT_DELAY_MS;
  while (!signal.aborted) {
    try {
      const response = await fetch(new URL("/global/event", OPENCODE_BASE_URL), {
        headers: { accept: "text/event-stream" },
        cache: "no-store",
        signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`global event stream failed: ${response.status}`);
      }
      reconnectMs = INITIAL_RECONNECT_DELAY_MS;
      await consumeMemoryEventStream(response.body, (data) => {
        try {
          handleMemoryGlobalEvent(data);
        } catch {
          // One malformed event/database race must not terminate the monitor.
        }
      });
      if (!signal.aborted) await waitForReconnect(reconnectMs, signal);
    } catch {
      if (signal.aborted) break;
      await waitForReconnect(reconnectMs, signal);
      reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_DELAY_MS);
    }
  }
}

/** Start the process-level monitor once during Node runtime startup. */
export function startMemoryAutoExtractionMonitor(): void {
  if (monitorPromise) return;
  const controller = new AbortController();
  monitorController = controller;
  monitorPromise = runMemoryEventMonitor(controller.signal).finally(() => {
    if (monitorController === controller) {
      monitorController = null;
      monitorPromise = null;
    }
  });
}

/** Test/shutdown seam; production startup intentionally keeps the monitor alive. */
export function stopMemoryAutoExtractionMonitorForTest(): void {
  monitorController?.abort();
  monitorController = null;
  monitorPromise = null;
}
