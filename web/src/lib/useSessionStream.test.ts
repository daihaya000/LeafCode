import { describe, expect, it } from "vitest";
import {
  classifyToolFailureStatus,
  createInitialStreamState,
  filterGoalLoopMessages,
  resolveResyncStatus,
  sessionStreamReducer,
  SESSION_COMMAND_TIMEOUT_MS,
  SESSION_MUTATION_TIMEOUT_MS,
  stripGoalLoopJsonBlock,
} from "./useSessionStream";
import type { MessageWithParts } from "./types";

describe("SESSION_COMMAND_TIMEOUT_MS", () => {
  it("stays above the BFF's 290s long-running upstream timeout", () => {
    // Kept just above LONG_RUNNING_UPSTREAM_TIMEOUT_MS in
    // app/api/opencode/[...path]/route.ts so the BFF—not the client—produces
    // the terminal response for a legitimately long `session.command`.
    expect(SESSION_COMMAND_TIMEOUT_MS).toBeGreaterThan(290_000);
  });

  it("stays within the route's 300s maxDuration", () => {
    expect(SESSION_COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });

  it("is longer than the default prompt/abort mutation timeout", () => {
    expect(SESSION_COMMAND_TIMEOUT_MS).toBeGreaterThan(SESSION_MUTATION_TIMEOUT_MS);
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
