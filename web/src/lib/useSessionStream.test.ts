import { describe, expect, it } from "vitest";
import { IMAGE_ANALYSIS_SEND_TIMEOUT_MS } from "./image-send-timeout";
import {
  ACTIVE_SESSION_RECONCILE_MS,
  classifyToolFailureStatus,
  createInitialStreamState,
  filterCompactionContinueMessages,
  filterGoalLoopMessages,
  HANG_RETRY_METADATA_KEY,
  MAX_ACTIVE_RECONCILE_MS,
  MESSAGE_REFETCH_TRUST_SSE_MS,
  nextReconcileDelayMs,
  resolveResyncStatus,
  shouldApplySessionEventStatus,
  sessionStreamReducer,
  SESSION_COMMAND_TIMEOUT_MS,
  SESSION_HANG_TIMEOUT_MS,
  SESSION_MUTATION_TIMEOUT_MS,
  markHangRetryBody,
  mutationTimeoutForSend,
  permRowToRequest,
  questionRowToRequest,
  shouldTrustSseForMessages,
  stripGoalLoopJsonBlock,
  STUCK_BUSY_IDLE_STREAK,
  STUCK_BUSY_QUIET_MS,
} from "./useSessionStream";
import { SSE_SILENCE_MS } from "./sse-health";
import type { MessageWithParts } from "./types";

describe("SESSION_COMMAND_TIMEOUT_MS", () => {
  it("uses the requested five-minute hang threshold", () => {
    expect(SESSION_HANG_TIMEOUT_MS).toBe(300_000);
  });

  it("keeps active reconcile frequent enough to recover missed SSE events", () => {
    expect(ACTIVE_SESSION_RECONCILE_MS).toBeGreaterThanOrEqual(1_000);
    expect(ACTIVE_SESSION_RECONCILE_MS).toBeLessThanOrEqual(5_000);
  });

  it("stays above the BFF's 120s long-running upstream timeout", () => {
    // Kept just above LONG_RUNNING_UPSTREAM_TIMEOUT_MS in
    // app/api/opencode/[...path]/route.ts so the BFF—not the client—produces
    // the terminal response for a hung `session.command`.
    expect(SESSION_COMMAND_TIMEOUT_MS).toBeGreaterThan(120_000);
  });

  it("stays within the route's 300s maxDuration", () => {
    expect(SESSION_COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });

  it("is longer than the default prompt/abort mutation timeout", () => {
    expect(SESSION_COMMAND_TIMEOUT_MS).toBeGreaterThan(SESSION_MUTATION_TIMEOUT_MS);
  });

  it("extends the mutation budget when attachments may trigger pre-analysis", () => {
    expect(mutationTimeoutForSend(false)).toBe(SESSION_MUTATION_TIMEOUT_MS);
    expect(mutationTimeoutForSend(true)).toBeGreaterThan(SESSION_MUTATION_TIMEOUT_MS);
    expect(mutationTimeoutForSend(true)).toBe(IMAGE_ANALYSIS_SEND_TIMEOUT_MS);
    expect(mutationTimeoutForSend(true)).toBeGreaterThanOrEqual(600_000);
  });
});

describe("nextReconcileDelayMs", () => {
  it("keeps the base interval when the last pass was fast or unmeasured", () => {
    expect(nextReconcileDelayMs(0)).toBe(ACTIVE_SESSION_RECONCILE_MS);
    expect(nextReconcileDelayMs(-1)).toBe(ACTIVE_SESSION_RECONCILE_MS);
    expect(nextReconcileDelayMs(Number.NaN)).toBe(ACTIVE_SESSION_RECONCILE_MS);
    expect(nextReconcileDelayMs(120)).toBe(ACTIVE_SESSION_RECONCILE_MS);
  });

  it("backs off to roughly the last pass duration on a slow engine", () => {
    // A saturated engine took ~25s to answer; re-asking every 3s only deepens
    // the backlog that made it slow in the first place.
    expect(nextReconcileDelayMs(8_000)).toBe(8_000);
    expect(nextReconcileDelayMs(25_000)).toBe(25_000);
  });

  it("never exceeds the cap, however slow the engine is", () => {
    expect(nextReconcileDelayMs(120_000)).toBe(MAX_ACTIVE_RECONCILE_MS);
    expect(MAX_ACTIVE_RECONCILE_MS).toBeGreaterThan(ACTIVE_SESSION_RECONCILE_MS);
  });
});

describe("shouldTrustSseForMessages", () => {
  const base = {
    connection: "live" as const,
    sessionQuietMs: 0,
    messageCount: 3,
  };

  it("skips the full-history refetch while SSE is live and recently active", () => {
    expect(shouldTrustSseForMessages(base)).toBe(true);
    expect(
      shouldTrustSseForMessages({
        ...base,
        sessionQuietMs: MESSAGE_REFETCH_TRUST_SSE_MS - 1,
      }),
    ).toBe(true);
  });

  it("refetches once SSE has gone quiet for this session", () => {
    // This is the case the periodic reconcile exists for: heartbeats keep the
    // stream open while message events are being dropped.
    expect(
      shouldTrustSseForMessages({
        ...base,
        sessionQuietMs: MESSAGE_REFETCH_TRUST_SSE_MS,
      }),
    ).toBe(false);
  });

  it.each(["connecting", "reconnecting", "down"] as const)(
    "refetches while the connection is %s",
    (connection) => {
      expect(shouldTrustSseForMessages({ ...base, connection })).toBe(false);
    },
  );

  it("refetches when no messages have been loaded yet", () => {
    expect(shouldTrustSseForMessages({ ...base, messageCount: 0 })).toBe(false);
  });

  it("honours an explicit trust window", () => {
    expect(
      shouldTrustSseForMessages({ ...base, sessionQuietMs: 500, trustWindowMs: 400 }),
    ).toBe(false);
    expect(
      shouldTrustSseForMessages({ ...base, sessionQuietMs: 300, trustWindowMs: 400 }),
    ).toBe(true);
  });
});

describe("classifyToolFailureStatus", () => {
  it.each([
    "aborted",
    "tool execution aborted",
    "cancelled",
    "canceled",
    "tool execution cancelled",
    "tool execution canceled",
    "  CANCELLED  ",
  ])("classifies %j as cancelled", (message) => {
    expect(classifyToolFailureStatus(message)).toBe("cancelled");
  });

  it.each([undefined, "", "aborted by user", "Tool execution cancelled: timeout"])(
    "keeps non-exact message %j as an error",
    (message) => {
      expect(classifyToolFailureStatus(message)).toBe("error");
    },
  );
});

describe("resolveResyncStatus", () => {
  it("applies REST and clears pendingMutation after a send without SSE", () => {
    const idle = resolveResyncStatus({
      pendingMutation: true,
      preferRestStatus: false,
      connection: "live",
      currentType: "busy",
      next: { type: "idle" },
    });
    expect(idle).toEqual({ apply: true, clearPending: true });

    const busy = resolveResyncStatus({
      pendingMutation: true,
      preferRestStatus: false,
      connection: "live",
      currentType: "busy",
      next: { type: "busy" },
    });
    expect(busy).toEqual({ apply: true, clearPending: true });
  });

  it("still suppresses stale idle while SSE is live without pendingMutation", () => {
    const decision = resolveResyncStatus({
      pendingMutation: false,
      preferRestStatus: false,
      connection: "live",
      currentType: "busy",
      next: { type: "idle" },
    });
    expect(decision).toEqual({ apply: false, clearPending: false });
  });

  it("suppresses stale busy after idle unless preferRestStatus", () => {
    const suppressed = resolveResyncStatus({
      pendingMutation: false,
      preferRestStatus: false,
      connection: "live",
      currentType: "idle",
      next: { type: "busy" },
    });
    expect(suppressed).toEqual({ apply: false, clearPending: false });

    const trusted = resolveResyncStatus({
      pendingMutation: false,
      preferRestStatus: true,
      connection: "live",
      currentType: "idle",
      next: { type: "busy" },
    });
    expect(trusted).toEqual({ apply: true, clearPending: false });
  });

  it("recovers a stuck busy when REST keeps reporting idle and SSE went quiet", () => {
    // Regression: a heartbeating SSE connection that dropped the terminal
    // session.idle event left the view "working" until a browser reload.
    const decision = resolveResyncStatus({
      pendingMutation: false,
      preferRestStatus: false,
      connection: "live",
      currentType: "busy",
      next: { type: "idle" },
      idleStreak: STUCK_BUSY_IDLE_STREAK,
      sessionQuietMs: STUCK_BUSY_QUIET_MS,
    });
    expect(decision).toEqual({ apply: true, clearPending: false });
  });

  it("keeps suppressing stale idle until both the streak and the quiet period pass", () => {
    const tooFewSnapshots = resolveResyncStatus({
      pendingMutation: false,
      preferRestStatus: false,
      connection: "live",
      currentType: "busy",
      next: { type: "idle" },
      idleStreak: STUCK_BUSY_IDLE_STREAK - 1,
      sessionQuietMs: STUCK_BUSY_QUIET_MS * 10,
    });
    expect(tooFewSnapshots).toEqual({ apply: false, clearPending: false });

    const stillStreaming = resolveResyncStatus({
      pendingMutation: false,
      preferRestStatus: false,
      connection: "live",
      currentType: "retry",
      next: { type: "idle" },
      idleStreak: STUCK_BUSY_IDLE_STREAK * 10,
      sessionQuietMs: STUCK_BUSY_QUIET_MS - 1,
    });
    expect(stillStreaming).toEqual({ apply: false, clearPending: false });
  });

  it("keeps the stuck-busy window long enough to outlast a normal multi-step gap", () => {
    expect(STUCK_BUSY_QUIET_MS).toBeGreaterThanOrEqual(
      ACTIVE_SESSION_RECONCILE_MS * STUCK_BUSY_IDLE_STREAK,
    );
    // Must trip well before the SSE silence watchdog forces a reconnect, so a
    // finished turn is not stuck for a whole silence window.
    expect(STUCK_BUSY_QUIET_MS).toBeLessThan(SSE_SILENCE_MS);
  });
});

describe("session stream scope changes", () => {
  it("clears all session-owned state when switching sessions", () => {
    let state = createInitialStreamState("C:/repo\u0000session-a");
    state = sessionStreamReducer(state, {
      kind: "init",
      messages: [
        {
          info: { id: "message-a", role: "user" },
          parts: [],
        },
      ],
    });
    state = sessionStreamReducer(state, {
      kind: "status",
      status: { type: "busy" },
    });
    state = sessionStreamReducer(state, {
      kind: "questionAsked",
      request: {
        id: "question-a",
        version: "v1",
        sessionID: "session-a",
        questions: [],
        receivedAt: 1,
      },
    });

    const reset = sessionStreamReducer(state, {
      kind: "reset",
      scopeKey: "C:/repo\u0000session-b",
    });

    expect(reset.scopeKey).toBe("C:/repo\u0000session-b");
    expect(reset.messages).toEqual([]);
    expect(reset.questions).toEqual([]);
    expect(reset.status).toBeNull();
    expect(reset.loaded).toBe(false);
  });

  it("can restore cached state for a previously opened session", () => {
    let cached = createInitialStreamState("C:/repo\u0000session-a");
    cached = sessionStreamReducer(cached, {
      kind: "init",
      messages: [{ info: { id: "message-a", role: "user" }, parts: [] }],
    });
    cached = sessionStreamReducer(cached, {
      kind: "status",
      status: { type: "idle" },
    });

    const restored = sessionStreamReducer(createInitialStreamState("other"), {
      kind: "reset",
      scopeKey: "C:/repo\u0000session-a",
      cached: { ...cached, connection: "live", sessionError: "old error" },
    });

    expect(restored.scopeKey).toBe("C:/repo\u0000session-a");
    expect(restored.messages.map((m) => m.info.id)).toEqual(["message-a"]);
    expect(restored.loaded).toBe(true);
    expect(restored.connection).toBe("connecting");
    expect(restored.sessionError).toBeNull();
  });
});

describe("session stream message/part removal", () => {
  it("removes a message by id", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "init",
      messages: [
        { info: { id: "m1", role: "user" }, parts: [] },
        { info: { id: "m2", role: "assistant" }, parts: [] },
      ],
    });
    state = sessionStreamReducer(state, {
      kind: "messageRemoved",
      messageID: "m1",
    });
    expect(state.messages.map((m) => m.info.id)).toEqual(["m2"]);
  });

  it("removes a part from a message", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "init",
      messages: [
        {
          info: { id: "m1", role: "assistant" },
          parts: [
            { id: "p1", messageID: "m1", type: "text", text: "a" },
            { id: "p2", messageID: "m1", type: "text", text: "b" },
          ],
        },
      ],
    });
    state = sessionStreamReducer(state, {
      kind: "partRemoved",
      messageID: "m1",
      partID: "p1",
    });
    expect(state.messages[0]!.parts.map((p) => p.id)).toEqual(["p2"]);
  });
});

describe("session stream session.next text deltas", () => {
  it("appends text deltas and preserves prior content", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: {
        id: "t1",
        messageID: "a1",
        type: "text",
        text: "Hello",
      },
    });
    state = sessionStreamReducer(state, {
      kind: "partTextDelta",
      messageID: "a1",
      partID: "t1",
      delta: " world",
      partType: "text",
      sessionID: "s1",
    });
    expect(state.messages[0]!.parts[0]!.text).toBe("Hello world");
  });

  it("creates a placeholder message when delta arrives first", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partTextDelta",
      messageID: "a1",
      partID: "t1",
      delta: "Hi",
      partType: "text",
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.info).toEqual({ id: "a1", role: "assistant" });
    expect(state.messages[0]!.parts[0]!.text).toBe("Hi");
  });

  it("merges tool patches without wiping the tool name", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: {
        id: "c1",
        messageID: "a1",
        type: "tool",
        tool: "bash",
        callID: "c1",
        state: { status: "running", input: { cmd: "ls" } },
      },
    });
    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: {
        id: "c1",
        messageID: "a1",
        type: "tool",
        tool: "tool",
        callID: "c1",
        state: { status: "completed", output: "ok" },
      },
    });
    const part = state.messages[0]!.parts[0]!;
    expect(part.tool).toBe("bash");
    expect(part.state?.status).toBe("completed");
    expect(part.state?.output).toBe("ok");
    expect(part.state?.input).toEqual({ cmd: "ls" });
  });

  it("normalizes cancelled tool errors from REST init and part updates", () => {
    const cancelled = {
      id: "c1",
      messageID: "a1",
      type: "tool",
      tool: "bash",
      state: { status: "error" as const, error: "Tool execution cancelled" },
    };
    const ordinaryError = {
      id: "c2",
      messageID: "a1",
      type: "tool",
      tool: "bash",
      state: { status: "error" as const, error: "command failed" },
    };

    let state = sessionStreamReducer(createInitialStreamState("scope"), {
      kind: "init",
      messages: [{ info: { id: "a1", role: "assistant" }, parts: [cancelled, ordinaryError] }],
    });
    expect(state.messages[0]!.parts[0]!.state?.status).toBe("cancelled");
    expect(state.messages[0]!.parts[1]!.state?.status).toBe("error");

    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: { ...cancelled, state: { ...cancelled.state, status: "error" } },
    });
    expect(state.messages[0]!.parts[0]!.state?.status).toBe("cancelled");
  });

  it("does not wipe streamed text when ended arrives without text", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: { id: "t1", messageID: "a1", type: "text", text: "Hello" },
    });
    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: {
        id: "t1",
        messageID: "a1",
        type: "text",
        text: "",
        time: { end: 2 },
      },
    });
    expect(state.messages[0]!.parts[0]!.text).toBe("Hello");
    expect(state.messages[0]!.parts[0]!.time?.end).toBe(2);
  });

  it("merges REST messages during streaming without losing newer local deltas", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partTextDelta",
      messageID: "a1",
      partID: "t1",
      delta: "Hello streamed",
      partType: "text",
      sessionID: "s1",
    });

    state = sessionStreamReducer(state, {
      kind: "mergeRestMessages",
      messages: [
        {
          info: { id: "u1", role: "user" },
          parts: [{ id: "u1p", messageID: "u1", type: "text", text: "prompt" }],
        },
        {
          info: { id: "a1", role: "assistant" },
          parts: [{ id: "t1", messageID: "a1", type: "text", text: "Hello" }],
        },
      ],
    });

    expect(state.messages.map((m) => m.info.id)).toEqual(["u1", "a1"]);
    expect(state.messages[1]!.parts[0]!.text).toBe("Hello streamed");
  });

  it("keeps local-only streaming placeholders when REST is behind", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partTextDelta",
      messageID: "a1",
      partID: "t1",
      delta: "live",
      partType: "text",
    });

    state = sessionStreamReducer(state, {
      kind: "mergeRestMessages",
      messages: [
        {
          info: { id: "u1", role: "user" },
          parts: [{ id: "u1p", messageID: "u1", type: "text", text: "prompt" }],
        },
      ],
    });

    expect(state.messages.map((m) => m.info.id)).toEqual(["u1", "a1"]);
    expect(state.messages[1]!.parts[0]!.text).toBe("live");
  });

  it("lets newer REST text replace local text when it is not just a stale prefix", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "partUpdated",
      part: { id: "t1", messageID: "a1", type: "text", text: "old" },
    });

    state = sessionStreamReducer(state, {
      kind: "mergeRestMessages",
      messages: [
        {
          info: { id: "a1", role: "assistant" },
          parts: [{ id: "t1", messageID: "a1", type: "text", text: "newer" }],
        },
      ],
    });

    expect(state.messages[0]!.parts[0]!.text).toBe("newer");
  });

  it("keeps local v2 permissions when REST sync lacks v2", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "permissionAsked",
      request: {
        id: "p-v2",
        version: "v2",
        sessionID: "s1",
        permission: "edit",
        patterns: ["*"],
        receivedAt: 1,
      },
    });
    state = sessionStreamReducer(state, {
      kind: "permissionsSynced",
      requests: [
        {
          id: "p-v1",
          version: "v1",
          sessionID: "s1",
          permission: "bash",
          patterns: [],
          receivedAt: 2,
        },
      ],
      keepLocalV2: true,
    });
    expect(state.permissions.map((p) => p.id).sort()).toEqual(["p-v1", "p-v2"]);
  });

  it("keeps SSE permissions newer than syncStartedAt", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "permissionAsked",
      request: {
        id: "p-sse",
        version: "v1",
        sessionID: "s1",
        permission: "edit",
        patterns: ["*"],
        receivedAt: 100,
      },
    });
    state = sessionStreamReducer(state, {
      kind: "permissionsSynced",
      requests: [],
      syncStartedAt: 50,
    });
    expect(state.permissions.map((p) => p.id)).toEqual(["p-sse"]);
  });

  it("transitions busy→idle without sticking (regression)", () => {
    let state = createInitialStreamState("scope");
    state = sessionStreamReducer(state, {
      kind: "status",
      status: { type: "busy" },
    });
    expect(state.status?.type).toBe("busy");

    state = sessionStreamReducer(state, {
      kind: "status",
      status: { type: "idle" },
    });
    expect(state.status?.type).toBe("idle");
  });
});

describe("filterGoalLoopMessages", () => {
  function userMsg(id: string, text: string): MessageWithParts {
    return {
      info: { id, role: "user" },
      parts: [{ id: `${id}-p1`, messageID: id, type: "text", text }],
    };
  }
  function assistantMsg(id: string, text: string): MessageWithParts {
    return {
      info: { id, role: "assistant" },
      parts: [{ id: `${id}-p1`, messageID: id, type: "text", text }],
    };
  }

  it("drops user messages whose first text part starts with the marker", () => {
    const msgs: MessageWithParts[] = [
      userMsg("u1", "<!-- webui-goal-loop-prompt -->\n\nYou are running..."),
      userMsg("u2", "普通のユーザー発言"),
      assistantMsg("a1", "返答"),
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out.map((m) => m.info.id)).toEqual(["u2", "a1"]);
  });

  it("drops marked prompts with a workspace-memory block prepended", () => {
    const msgs: MessageWithParts[] = [
      userMsg(
        "u1",
        "<workspace-memory>\n- [fact] mock\n</workspace-memory>\n<!-- webui-goal-loop-prompt -->\n\nYou are running...",
      ),
      userMsg("u2", "普通のユーザー発言"),
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out.map((m) => m.info.id)).toEqual(["u2"]);
  });

  it("drops marked prompts with a collaboration-context block prepended", () => {
    const msgs: MessageWithParts[] = [
      userMsg(
        "u1",
        "<collaboration-context>\nLive status\n</collaboration-context>\n<!-- webui-goal-loop-prompt -->\n\nContinue...",
      ),
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out).toEqual([]);
  });

  it("keeps marked text that appears mid-message rather than as a prefix chain", () => {
    const msgs: MessageWithParts[] = [
      userMsg("u1", "本文<!-- webui-goal-loop-prompt -->\n\nnot a prompt"),
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out.map((m) => m.info.id)).toEqual(["u1"]);
  });

  it("keeps user messages without the marker", () => {
    const msgs: MessageWithParts[] = [
      userMsg("u1", "こんにちは"),
      userMsg("u2", "<!-- webui-goal-loop-prompt -->\n\n..."),
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out.map((m) => m.info.id)).toEqual(["u1"]);
  });

  it("keeps assistant messages even if they start with the marker", () => {
    const msgs: MessageWithParts[] = [
      assistantMsg("a1", "<!-- webui-goal-loop-prompt --> assistant copy"),
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out.map((m) => m.info.id)).toEqual(["a1"]);
  });

  it("keeps user messages with no text part", () => {
    const msgs: MessageWithParts[] = [
      { info: { id: "u1", role: "user" }, parts: [] },
    ];
    const out = filterGoalLoopMessages(msgs);
    expect(out.map((m) => m.info.id)).toEqual(["u1"]);
  });
});

describe("shouldApplySessionEventStatus", () => {
  it("ignores a delayed busy event after idle", () => {
    expect(
      shouldApplySessionEventStatus({
        currentType: "idle",
        nextType: "busy",
        pendingMutation: false,
      }),
    ).toBe(false);
  });

  it("accepts a new turn after idle once a mutation is pending", () => {
    expect(
      shouldApplySessionEventStatus({
        currentType: "idle",
        nextType: "busy",
        pendingMutation: true,
      }),
    ).toBe(true);
  });
});

describe("filterCompactionContinueMessages", () => {
  it("drops OpenCode's synthetic post-compaction continuation user turn", () => {
    const messages: MessageWithParts[] = [
      {
        info: { id: "u1", role: "user" },
        parts: [
          {
            id: "u1-p1",
            messageID: "u1",
            type: "text",
            text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
            synthetic: true,
            metadata: { compaction_continue: true },
          },
        ],
      },
      {
        info: { id: "a1", role: "assistant" },
        parts: [{ id: "a1-p1", messageID: "a1", type: "text", text: "続行します" }],
      },
    ];

    expect(filterCompactionContinueMessages(messages).map((message) => message.info.id)).toEqual([
      "a1",
    ]);
  });

  it("keeps manual text and unrelated synthetic messages", () => {
    const messages: MessageWithParts[] = [
      {
        info: { id: "u1", role: "user" },
        parts: [{ id: "u1-p1", messageID: "u1", type: "text", text: "続けて" }],
      },
      {
        info: { id: "u2", role: "user" },
        parts: [
          {
            id: "u2-p1",
            messageID: "u2",
            type: "text",
            text: "other internal text",
            synthetic: true,
            metadata: { other: true },
          },
        ],
      },
    ];

    expect(filterCompactionContinueMessages(messages)).toEqual(messages);
  });

  it("drops a timeout retry marked by the WebUI metadata", () => {
    const messages: MessageWithParts[] = [
      {
        info: { id: "retry", role: "user" },
        parts: [
          {
            id: "retry-p1",
            messageID: "retry",
            type: "text",
            text: "同じ処理",
            metadata: { [HANG_RETRY_METADATA_KEY]: true },
          },
        ],
      },
    ];

    expect(filterCompactionContinueMessages(messages)).toEqual([]);
  });
});

describe("markHangRetryBody", () => {
  it("marks only text parts and preserves the original body", () => {
    const body = {
      parts: [
        { type: "text", text: "同じ処理", metadata: { existing: "keep" } },
        { type: "file", mime: "text/plain", url: "data:text/plain,ok" },
      ],
    };

    const marked = markHangRetryBody(body);
    expect(marked.parts).toEqual([
      {
        type: "text",
        text: "同じ処理",
        metadata: { existing: "keep", [HANG_RETRY_METADATA_KEY]: true },
      },
      body.parts[1],
    ]);
    expect(body.parts[0]).toEqual({
      type: "text",
      text: "同じ処理",
      metadata: { existing: "keep" },
    });
  });
});

describe("stripGoalLoopJsonBlock", () => {
  it("strips a trailing goal-result json block", () => {
    const text =
      "作業を完了しました。\n\n```json\n{\"status\":\"completed\",\"summary\":\"done\",\"next\":\"\",\"evidence\":\"tests pass\"}\n```";
    const out = stripGoalLoopJsonBlock(text);
    expect(out).toBe("作業を完了しました。");
  });

  it("strips a progress-status block", () => {
    const text =
      "進捗あり。\n```json\n{\"status\":\"progress\",\"summary\":\"wip\",\"next\":\"next step\",\"evidence\":\"\"}\n```";
    expect(stripGoalLoopJsonBlock(text)).toBe("進捗あり。");
  });

  it("strips a verified_completed block from the verification turn", () => {
    const text =
      "検証完了。\n```json\n{\"status\":\"verified_completed\",\"summary\":\"all green\",\"evidence\":\"tsc+vitest pass\"}\n```";
    expect(stripGoalLoopJsonBlock(text)).toBe("検証完了。");
  });

  it("keeps the summary visible when the result block is the whole reply", () => {
    const text =
      "```json\n{\"status\":\"verified_completed\",\"summary\":\"all green\",\"evidence\":\"tsc+vitest pass\"}\n```";
    expect(stripGoalLoopJsonBlock(text)).toBe("all green");
  });

  it("does not strip a generic trailing json block", () => {
    const text = "メモ。\n```json\n{\"foo\":1,\"bar\":2}\n```";
    expect(stripGoalLoopJsonBlock(text)).toBe(text);
  });

  it("does not strip when json is broken", () => {
    const text = "メモ。\n```json\n{not valid json}\n```";
    expect(stripGoalLoopJsonBlock(text)).toBe(text);
  });

  it("leaves text without a trailing json block untouched", () => {
    const text = "プレーンテキスト";
    expect(stripGoalLoopJsonBlock(text)).toBe(text);
  });
});

describe("permRowToRequest", () => {
  it("maps a v1 row to the pinned session", () => {
    const req = permRowToRequest(
      { id: "p1", sessionID: "s1", permission: "shell", patterns: ["git"] },
      "s1",
      "v1",
    );
    expect(req).toMatchObject({
      id: "p1",
      sessionID: "s1",
      version: "v1",
      permission: "shell",
      patterns: ["git"],
    });
    expect(typeof req?.receivedAt).toBe("number");
  });

  it("falls back to the action/resources v2 fields", () => {
    const req = permRowToRequest(
      { id: "p2", sessionID: "s1", action: "file.read", resources: ["a.txt"] },
      "s1",
      "v2",
    );
    expect(req).toMatchObject({
      permission: "file.read",
      patterns: ["a.txt"],
    });
  });

  it("returns null for a row of another session", () => {
    expect(permRowToRequest({ id: "p3", sessionID: "other" }, "s1", "v1")).toBeNull();
    expect(permRowToRequest({ id: "" }, "s1", "v1")).toBeNull();
  });
});

describe("questionRowToRequest", () => {
  it("maps a v2 question row to the pinned session", () => {
    const req = questionRowToRequest(
      { id: "q1", sessionID: "s1", questions: [] },
      "s1",
      "v2",
    );
    expect(req).toMatchObject({ id: "q1", sessionID: "s1", version: "v2" });
  });

  it("returns null for a row of another session", () => {
    expect(questionRowToRequest({ id: "q2", sessionID: "other" }, "s1", "v2")).toBeNull();
  });
});
