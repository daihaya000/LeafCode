import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { MessageWithParts } from "./types";

const h = vi.hoisted(() => ({
  ocCalls: [] as { path: string; body?: unknown }[],
  statusResponse: {} as Record<string, { type: "idle" | "busy" }>,
  messageResponse: [] as MessageWithParts[],
  promptAsyncDelayMs: 0,
  promptAsyncCount: 0,
  promptAsyncFailuresRemaining: 0,
  promptAsyncFailureStatus: 408,
  statusFailuresRemaining: 0,
  messageFailuresRemaining: 0,
}));

vi.mock("./oc-server", () => ({
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  ocServer: vi.fn(async (_dir: string | null, path: string, init?: { method?: string; body?: unknown }) => {
    h.ocCalls.push({ path, body: init?.body });
    if (path === "/session/status") {
      if (h.statusFailuresRemaining > 0) {
        h.statusFailuresRemaining -= 1;
        const err = new Error("OpenCode engine temporarily unavailable") as Error & { status: number };
        err.status = 503;
        throw err;
      }
      return h.statusResponse;
    }
    if (path.endsWith("/message")) {
      if (h.messageFailuresRemaining > 0) {
        h.messageFailuresRemaining -= 1;
        const err = new Error("OpenCode transcript temporarily unavailable") as Error & { status: number };
        err.status = 503;
        throw err;
      }
      return h.messageResponse;
    }
    if (path.endsWith("/prompt_async")) {
      h.promptAsyncCount += 1;
      if (h.promptAsyncFailuresRemaining > 0) {
        h.promptAsyncFailuresRemaining -= 1;
        const err = new Error(
          h.promptAsyncFailureStatus === 408
            ? "OpenCode engine が120秒でタイムアウトしました (/session/sess-1/prompt_async)"
            : `OpenCode rejected prompt (${h.promptAsyncFailureStatus})`,
        ) as Error & { status: number };
        err.status = h.promptAsyncFailureStatus;
        throw err;
      }
      if (h.promptAsyncDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, h.promptAsyncDelayMs));
      }
      return {};
    }
    if (path.endsWith("/abort")) return {};
    return {};
  }),
}));

vi.mock("./collaboration-context", () => ({
  collaborationContextFor: vi.fn(async () => ""),
  prependCollaborationContext: vi.fn((body: Record<string, unknown>) => body),
}));

// Provide a fresh in-memory DB for each test.
let testDb: Database.Database;
vi.mock("./db", () => ({
  getDb: () => testDb,
  getWorkspace: (id: string) =>
    testDb.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
      | { id: string; project_id: string; display_name: string; absolute_path: string; isolation: string; base_branch: string | null; worktree_path: string | null; status: string; created_at: string }
      | undefined,
  listSessionBindings: (workspaceId: string) =>
    testDb
      .prepare("SELECT * FROM session_bindings WHERE workspace_id = ? ORDER BY updated_at DESC")
      .all(workspaceId) as unknown[],
  touchSessionActivity: () => true,
}));

// Must come after mocks.
import {
  createGoalLoop,
  getGoalLoop,
  goalLoopTestSeams,
  pauseGoalLoopForManualSend,
  updateGoalLoopStatus,
} from "./goal-loop";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      isolation TEXT NOT NULL,
      base_branch TEXT,
      worktree_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_bindings (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, opencode_session_id)
    );
    CREATE TABLE IF NOT EXISTS goal_loops (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      goal TEXT NOT NULL,
      acceptance TEXT NOT NULL DEFAULT '[]',
      max_turns INTEGER NOT NULL DEFAULT 10,
      turn_count INTEGER NOT NULL DEFAULT 0,
      last_message_id TEXT,
      last_prompt_at TEXT,
      agent TEXT,
      provider_id TEXT,
      model_id TEXT,
      variant TEXT,
      progress TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      turn_kind TEXT NOT NULL DEFAULT 'goal',
      pause_reason TEXT NOT NULL DEFAULT '',
      rejected_claims INTEGER NOT NULL DEFAULT 0,
      pause_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goal_loops_workspace ON goal_loops(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_status ON goal_loops(status);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session_id TEXT,
      provenance TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
      UPDATE memories_fts SET content = new.content WHERE id = new.id;
    END;
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = old.id;
    END;
  `);
  return db;
}

function msg(
  id: string,
  role: "user" | "assistant",
  structured?: unknown,
  text?: string,
): MessageWithParts {
  return {
    info: {
      id,
      role,
      structured,
      time: { created: 1, completed: 2 },
    },
    parts: text ? [{ id: `${id}-text`, messageID: id, type: "text", text }] : [],
  };
}

function streamingAssistant(id: string): MessageWithParts {
  return {
    info: { id, role: "assistant", time: { created: 3 } },
    parts: [],
  };
}

function setupWorkspace(workspaceId: string, sessionId: string): void {
  const projectId = `prj-${workspaceId}`;
  testDb
    .prepare(
      `INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(projectId, "Test", "C:\\repo", new Date().toISOString());
  testDb
    .prepare(
      `INSERT INTO workspaces (id, project_id, display_name, absolute_path, isolation, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, projectId, "Task", "C:\\repo", "current_folder", new Date().toISOString());
  testDb
    .prepare(
      `INSERT INTO session_bindings (workspace_id, opencode_session_id, title, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, sessionId, "", new Date().toISOString());
}

beforeEach(() => {
  testDb = makeDb();
  h.ocCalls.length = 0;
  h.statusResponse = { ["sess-1"]: { type: "idle" } };
  h.messageResponse = [msg("m0", "assistant")];
  h.promptAsyncDelayMs = 0;
  h.promptAsyncCount = 0;
  h.promptAsyncFailuresRemaining = 0;
  h.promptAsyncFailureStatus = 408;
  h.statusFailuresRemaining = 0;
  h.messageFailuresRemaining = 0;
});

describe("goal loop integration", () => {
  it("does not consume an earlier result while the latest assistant step is silent", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({ workspaceId: "ws-1", sessionId: "sess-1", goal: "test" });
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");

    // A previous step has a completion-shaped payload, but the latest step is
    // still streaming without text. It must not advance the loop prematurely.
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("intermediate", "assistant", { status: "completed", summary: "stale claim" }),
      streamingAssistant("silent-tail"),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");
    expect(getGoalLoop("ws-1")?.progress).toHaveLength(0);

    h.messageResponse = [
      msg("m0", "assistant"),
      msg("intermediate", "assistant", { status: "completed", summary: "stale claim" }),
      msg("final", "assistant", { status: "progress", summary: "actual progress" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("queued");
    expect(getGoalLoop("ws-1")?.summary).toBe("actual progress");
  });

  it("does not send prompt_async twice when two ticks race on the same queued loop", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
    });

    // Simulate two scheduler ticks racing: both see the loop as queued and
    // the session as idle, but only one should win the UPDATE and send.
    await Promise.all([
      goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!),
      goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!),
    ]);

    const prompts = h.ocCalls.filter((c) => c.path.endsWith("/prompt_async"));
    expect(prompts).toHaveLength(1);
    expect(getGoalLoop("ws-1")?.status).toBe("running");
    expect(getGoalLoop("ws-1")?.turnCount).toBe(1);
  });

  it("re-anchors last_message_id on resume so paused-era messages are ignored", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
    });

    // First tick sends the loop prompt and marks it running.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");

    // Simulate the engine finishing the turn with a structured reply.
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "progress", summary: "loop turn done" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("queued");

    // Pause the loop, then simulate a manual user send arriving while paused.
    await updateGoalLoopStatus("ws-1", "pause");
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "progress", summary: "loop turn done" }),
      msg("manual-prompt", "user"),
      msg("manual-reply", "assistant", { status: "completed", summary: "manual" }),
    ];

    // Resume should re-anchor last_message_id to the manual reply tail.
    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    expect(resumed?.status).toBe("queued");
    expect(resumed?.lastMessageId).toBe("manual-reply");

    // The loop prompts again and the engine replies. The manual reply is
    // behind the re-anchored boundary and must not be treated as the loop result.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "progress", summary: "loop turn done" }),
      msg("manual-prompt", "user"),
      msg("manual-reply", "assistant", { status: "completed", summary: "manual" }),
      msg("second-loop-prompt", "user"),
      msg("second-loop-reply", "assistant", { status: "progress", summary: "second turn" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const loop = getGoalLoop("ws-1");
    expect(loop?.status).toBe("queued");
    expect(loop?.progress.some((p) => p.summary === "second turn")).toBe(true);
    expect(loop?.progress.some((p) => p.summary === "manual")).toBe(false);
  });

  it("re-anchors last_message_id when pausing for a manual send", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
    });

    // Simulate a manual send happening while the loop is queued.
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("manual-prompt", "user"),
      msg("manual-reply", "assistant", { status: "completed", summary: "manual" }),
    ];

    await pauseGoalLoopForManualSend("ws-1", "sess-1");
    const loop = getGoalLoop("ws-1");
    expect(loop?.status).toBe("paused");
    expect(loop?.lastMessageId).toBe("manual-reply");
  });

  it("pauses an in-flight turn immediately and resumes cleanly", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({ workspaceId: "ws-1", sessionId: "sess-1", goal: "test" });
    // Drive one goal turn to running, then pause it immediately.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const running = getGoalLoop("ws-1")!;
    expect(running.status).toBe("running");
    await updateGoalLoopStatus("ws-1", "pause");
    const paused = getGoalLoop("ws-1")!;
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toBe("user");
    expect(paused.pauseRequested).toBe(false);

    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    expect(resumed?.pauseRequested).toBe(false);
    expect(resumed?.status).toBe("queued");
  });
});

describe("goal loop verification turn", () => {
  it("turns a completed claim into verifying_completed and then verified_completed", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: ["tests pass"],
      maxTurns: 5,
    });

    // First tick sends the loop prompt and marks it running.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");

    // Second tick reads the agent's completed claim.
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "tsc ok" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    let loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("verifying_completed");
    expect(loop.turnCount).toBe(1);
    expect(loop.progress.at(-1)?.status).toBe("completed");

    // Third tick sends the verification prompt.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");
    const verificationPromptCall = h.ocCalls.find((c) =>
      c.body &&
      typeof c.body === "object" &&
      Array.isArray((c.body as { parts?: unknown[] }).parts) &&
      JSON.stringify(c.body).includes("independently verify"),
    );
    expect(verificationPromptCall).toBeTruthy();

    // Fourth tick reads the verification result.
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "tsc ok" }),
      msg("verify-prompt", "user"),
      msg("verify-reply", "assistant", { status: "verified_completed", summary: "verified", evidence: "tests green" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("completed");
    expect(loop.turnCount).toBe(1);
    expect(loop.progress.some((p) => p.status === "verified_completed")).toBe(true);
  });

  it("rejects a completed claim and returns to queued when verification says progress", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: ["tests pass"],
      maxTurns: 5,
    });

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "tsc ok" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");

    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "tsc ok" }),
      msg("verify-prompt", "user"),
      msg("verify-reply", "assistant", { status: "progress", summary: "not done", evidence: "tests fail" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("queued");
    expect(loop.turnCount).toBe(1);
    expect(loop.progress.some((p) => p.summary === "not done")).toBe(true);
  });

  it("does not count the verification turn toward maxTurns", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: [],
      maxTurns: 1,
    });

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "ok" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "ok" }),
      msg("verify-prompt", "user"),
      msg("verify-reply", "assistant", { status: "progress", summary: "still work", evidence: "need fix" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("paused");
    expect(loop.error).toContain("最大ターン数");
    expect(loop.turnCount).toBe(1);
  });
});

describe("goal loop failure recovery", () => {
  it("creates a paused loop instead of treating an unreadable initial transcript as empty", async () => {
    setupWorkspace("ws-1", "sess-1");
    h.messageFailuresRemaining = 1;

    const loop = await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
    });

    expect(loop.status).toBe("paused");
    expect(loop.error).toContain("会話履歴を読めない");
    expect(h.ocCalls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(0);
  });

  it("retries a transient /session/status failure before prompting", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    h.ocCalls.length = 0;
    h.statusFailuresRemaining = 1;
    testDb
      .prepare(`UPDATE goal_loops SET status = 'queued', turn_count = 0 WHERE id = ?`)
      .run(getGoalLoop("ws-1")!.id);

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);

    expect(h.ocCalls.filter((call) => call.path === "/session/status")).toHaveLength(2);
    expect(getGoalLoop("ws-1")?.status).toBe("running");
  });

  it("does not retry an ambiguously failed prompt_async and pauses the claimed turn", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 3,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    h.ocCalls.length = 0;
    h.promptAsyncCount = 0;
    h.promptAsyncFailuresRemaining = 1;
    testDb
      .prepare(`UPDATE goal_loops SET status = 'queued', turn_count = 0 WHERE id = ?`)
      .run(getGoalLoop("ws-1")!.id);

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);

    expect(h.ocCalls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    expect(getGoalLoop("ws-1")?.status).toBe("paused");
    expect(getGoalLoop("ws-1")?.turnCount).toBe(1);
    expect(getGoalLoop("ws-1")?.error).toContain("送達を確認できない");
  });

  it("rolls back a turn when prompt_async definitively rejects it", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 3,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    h.ocCalls.length = 0;
    h.promptAsyncFailuresRemaining = 1;
    h.promptAsyncFailureStatus = 400;
    testDb
      .prepare(`UPDATE goal_loops SET status = 'queued', turn_count = 0 WHERE id = ?`)
      .run(getGoalLoop("ws-1")!.id);

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);

    const loop = getGoalLoop("ws-1")!;
    expect(h.ocCalls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    expect(loop.status).toBe("queued");
    expect(loop.turnCount).toBe(0);
    expect(loop.error).toContain("rejected prompt (400)");
  });

  it("does not send a queued prompt when /message cannot be read", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 3,
    });

    // createGoalLoop fires a background scheduler tick (void, not awaited).
    // Drain it, then make the next transcript read fail after finite retries.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.ocCalls.length = 0;
    h.messageFailuresRemaining = 3;
    testDb
      .prepare(`UPDATE goal_loops SET status = 'queued', turn_count = 0 WHERE id = ?`)
      .run(getGoalLoop("ws-1")!.id);

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const after = getGoalLoop("ws-1")!;
    expect(h.ocCalls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(0);
    expect(after.turnCount).toBe(0);
    expect(after.status).toBe("queued");
  });

  it("does not retry an ambiguously failed verification prompt", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: ["tests pass"],
    });

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");

    h.ocCalls.length = 0;
    h.promptAsyncFailuresRemaining = 1;
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);

    expect(h.ocCalls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    expect(getGoalLoop("ws-1")?.status).toBe("paused");
    expect(getGoalLoop("ws-1")?.error).toContain("完了検証プロンプト");
  });

  it("returns to verifying_completed when a verification prompt is definitively rejected", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: ["tests pass"],
    });

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.ocCalls.length = 0;
    h.promptAsyncFailuresRemaining = 1;
    h.promptAsyncFailureStatus = 422;

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);

    const loop = getGoalLoop("ws-1")!;
    expect(h.ocCalls.filter((call) => call.path.endsWith("/prompt_async"))).toHaveLength(1);
    expect(loop.status).toBe("verifying_completed");
    expect(loop.turnCount).toBe(1);
    expect(loop.error).toContain("rejected prompt (422)");
  });

  it("recovers an already delivered structured result when resuming an ambiguous pause", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({ workspaceId: "ws-1", sessionId: "sess-1", goal: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    testDb
      .prepare(`UPDATE goal_loops SET status = 'queued', turn_count = 0 WHERE id = ?`)
      .run(getGoalLoop("ws-1")!.id);
    h.promptAsyncFailuresRemaining = 1;
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const paused = getGoalLoop("ws-1")!;
    expect(paused.status).toBe("paused");

    h.messageResponse = [
     msg("m0", "assistant"),
      msg("m0", "assistant"),
      msg("loop-prompt", "user", undefined, "<!-- webui-goal-loop-prompt -->\nturn"),
      msg("loop-reply", "assistant", { status: "progress", summary: "delivered turn" }),
    ];
    const resumed = await updateGoalLoopStatus("ws-1", "resume");

    expect(resumed?.status).toBe("queued");
    expect(resumed?.turnCount).toBe(1);
    expect(resumed?.progress.at(-1)?.summary).toBe("delivered turn");
    expect(resumed?.lastMessageId).toBe("loop-reply");
  });

  it.each(["pause", "stop"] as const)(
    "does not let an old assistant result overwrite a later %s",
    async (action) => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({ workspaceId: "ws-1", sessionId: "sess-1", goal: "test" });
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const staleRunning = getGoalLoop("ws-1")!;

    await updateGoalLoopStatus("ws-1", action);
    goalLoopTestSeams.applyAssistantResult(
      staleRunning,
      msg("late-reply", "assistant", { status: "progress", summary: "late" }),
      { time: new Date().toISOString(), status: "progress", summary: "late" },
    );

    const after = getGoalLoop("ws-1")!;
    // Both pause and stop bump the revision before aborting. A late result
    // must therefore be rejected by the revision CAS.
    expect(after.status).toBe(action === "pause" ? "paused" : "stopped");
    expect(after.progress.some((progress) => progress.summary === "late")).toBe(false);
    },
  );

  it("expires a running turn even while the engine remains busy", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({ workspaceId: "ws-1", sessionId: "sess-1", goal: "test" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    testDb
      .prepare(`UPDATE goal_loops SET status = 'running', last_prompt_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 31 * 60_000).toISOString(), getGoalLoop("ws-1")!.id);
    h.statusResponse = { ["sess-1"]: { type: "busy" } };

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);

    expect(getGoalLoop("ws-1")?.status).toBe("paused");
    expect(getGoalLoop("ws-1")?.error).toContain("時間切れ");
  });

  it("pauses after the agent repeatedly claims completed and verification rejects", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: ["tests pass"],
      maxTurns: 10,
    });

    // Cycle 1: claim -> verify -> reject.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim1", evidence: "ok" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim1", evidence: "ok" }),
      msg("verify-prompt", "user"),
      msg("verify-reply", "assistant", { status: "progress", summary: "reject1", evidence: "no" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("queued");

    // Cycle 2: claim -> verify -> reject again. After the second rejection the
    // loop must pause instead of allowing a third claim/reject round-trip.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim1", evidence: "ok" }),
      msg("verify-prompt", "user"),
      msg("verify-reply", "assistant", { status: "progress", summary: "reject1", evidence: "no" }),
      msg("loop-prompt-2", "user"),
      msg("loop-reply-2", "assistant", { status: "completed", summary: "claim2", evidence: "ok" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim1", evidence: "ok" }),
      msg("verify-prompt", "user"),
      msg("verify-reply", "assistant", { status: "progress", summary: "reject1", evidence: "no" }),
      msg("loop-prompt-2", "user"),
      msg("loop-reply-2", "assistant", { status: "completed", summary: "claim2", evidence: "ok" }),
      msg("verify-prompt-2", "user"),
      msg("verify-reply-2", "assistant", { status: "progress", summary: "reject2", evidence: "no" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("paused");
    expect(loop.error).toContain("検証で複数回拒否");
  });

  it("allows pausing a verifying_completed loop via updateGoalLoopStatus", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      acceptance: ["tests pass"],
      maxTurns: 5,
    });

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
      msg("m0", "assistant"),
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "completed", summary: "claim", evidence: "ok" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");

    const paused = await updateGoalLoopStatus("ws-1", "pause");
    // The verification phase is also aborted immediately, while turn_kind is
    // retained so resume returns to verification.
    expect(paused?.status).toBe("paused");
    expect(paused?.pauseRequested).toBe(false);
    expect(paused?.turnKind).toBe("verification");
  });

  it("truncates a fractional maxTurns at create time (consistent with update)", async () => {
    setupWorkspace("ws-1", "sess-1");
    const loop = await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 5.9,
    });
    expect(loop.maxTurns).toBe(5);
  });
});

describe("goal loop pause_reason (docs/specs/goal-loop.md I5)", () => {
  it("keeps unknown_delivery across repeated resumes and never resends the prompt", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 5,
    });
    // Turn 1 prompt fails ambiguously (408): delivery cannot be proven.
    h.promptAsyncFailuresRemaining = 1;
    h.promptAsyncFailureStatus = 408;
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("paused");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("unknown_delivery");

    // First resume: no structured reply yet, so it must stay paused.
    const first = await updateGoalLoopStatus("ws-1", "resume");
    expect(first?.status).toBe("paused");
    expect(first?.pauseReason).toBe("unknown_delivery");

    // Second resume used to fall through to `queued` because the error text had
    // been reworded, which resent a possibly in-flight prompt.
    h.promptAsyncCount = 0;
    const second = await updateGoalLoopStatus("ws-1", "resume");
    expect(second?.status).toBe("paused");
    expect(second?.pauseReason).toBe("unknown_delivery");

    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(h.promptAsyncCount).toBe(0);
  });

  it("recovers and clears pause_reason when the delivered reply is found on resume", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 5,
    });
    h.promptAsyncFailuresRemaining = 1;
    h.promptAsyncFailureStatus = 408;
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("unknown_delivery");

    // The prompt had actually reached OpenCode: its marked prompt and reply exist.
    h.messageResponse = [
     msg("m0", "assistant"),
      msg("m0", "assistant"),
      msg("u1", "user", undefined, "<!-- webui-goal-loop-prompt -->\n\nwork"),
      msg("a1", "assistant", undefined, '```json\n{"status":"progress","summary":"did it"}\n```'),
    ];
    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    expect(resumed?.status).toBe("queued");
    expect(resumed?.pauseReason).toBe("");
    expect(resumed?.progress.at(-1)?.summary).toBe("did it");
  });

  it("records a distinct pause_reason for each pause path", async () => {
    setupWorkspace("ws-1", "sess-1");

    // transcript_unreadable at creation
    h.messageFailuresRemaining = 1;
    const created = await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 2,
    });
    expect(created.pauseReason).toBe("transcript_unreadable");

    // user pause
    await updateGoalLoopStatus("ws-1", "resume");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("");
    await updateGoalLoopStatus("ws-1", "pause");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("user");

    // manual_send pause
    await updateGoalLoopStatus("ws-1", "resume");
    await pauseGoalLoopForManualSend("ws-1", "sess-1");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("manual_send");

    // turn_limit pause: exhaust the budget with the loop already at max turns
    testDb
      .prepare(
        `UPDATE goal_loops SET status = 'queued', pause_reason = '', turn_count = 2, max_turns = 2
         WHERE id = ?`,
      )
      .run(getGoalLoop("ws-1")!.id);
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("paused");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("turn_limit");
  });

  it("records unreadable_result when a finished turn has no structured JSON", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "test",
      maxTurns: 5,
    });
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");

    // A completed assistant with no JSON block, quiet long enough to prove the
    // turn really ended (STRUCTURED_GRACE_MS is 60s; `completed` is epoch-ish).
    h.messageResponse = [msg("m0", "assistant"), msg("a1", "assistant", undefined, "no json here")];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("paused");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("unreadable_result");
  });
});

describe("goal loop verification phase survives pause/resume (docs/specs/goal-loop.md 遷移 22)", () => {
  function jsonMsg(id: string, status: string, summary: string): MessageWithParts {
    return msg(
      id,
      "assistant",
      undefined,
      'r\n```json\n{"status":"' + status + '","summary":"' + summary + '"}\n```',
    );
  }

  async function reachVerifyingCompleted(): Promise<void> {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns: 5,
    });
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.turnKind).toBe("goal");
    h.messageResponse = [msg("m0", "assistant"), jsonMsg("a1", "completed", "done")];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");
    expect(getGoalLoop("ws-1")?.turnKind).toBe("verification");
  }

  it("resumes into verifying_completed and sends the verification prompt", async () => {
    await reachVerifyingCompleted();
    const turnsBefore = getGoalLoop("ws-1")!.turnCount;

    await updateGoalLoopStatus("ws-1", "pause");
    expect(getGoalLoop("ws-1")?.turnKind).toBe("verification");
    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    expect(resumed?.status).toBe("verifying_completed");

    h.ocCalls.length = 0;
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const sent = h.ocCalls.find((c) => c.path.endsWith("/prompt_async"));
    const text = (sent?.body as { parts: { text: string }[] } | undefined)?.parts[0].text ?? "";
    expect(text).toContain("independently verify");
    // Verification must not consume a goal turn slot.
    expect(getGoalLoop("ws-1")?.turnCount).toBe(turnsBefore);
  });

  it("reaches completed after a pause/resume around verification", async () => {
    await reachVerifyingCompleted();
    await updateGoalLoopStatus("ws-1", "pause");
    await updateGoalLoopStatus("ws-1", "resume");
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");

    h.messageResponse = [
     msg("m0", "assistant"),
      msg("m0", "assistant"),
      jsonMsg("a1", "completed", "done"),
      jsonMsg("a2", "verified_completed", "checked"),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("completed");
  });

  it("does not misread a goal reply as a verification reply after a rejected claim", async () => {
    await reachVerifyingCompleted();
    // Verification runs and rejects the claim -> back to queued as a goal turn.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    h.messageResponse = [
     msg("m0", "assistant"),
      msg("m0", "assistant"),
      jsonMsg("a1", "completed", "done"),
      jsonMsg("a2", "progress", "not really done"),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("queued");
    expect(getGoalLoop("ws-1")?.turnKind).toBe("goal");

    // A pause here must resume as a goal turn, not as verification.
    await updateGoalLoopStatus("ws-1", "pause");
    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    expect(resumed?.status).toBe("queued");

    // The next goal turn claiming completion must enter verification again.
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.turnKind).toBe("goal");
    h.messageResponse = [
     msg("m0", "assistant"),
      msg("m0", "assistant"),
      jsonMsg("a1", "completed", "done"),
      jsonMsg("a2", "progress", "not really done"),
      jsonMsg("a3", "completed", "done for real"),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");
  });
});

describe("goal loop lost read boundary (docs/specs/goal-loop.md I4)", () => {
  it("pauses instead of consuming a result that predates the loop", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns: 5,
    });
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("running");
    expect(getGoalLoop("ws-1")?.lastMessageId).toBe("m0");

    // The boundary m0 is gone (reverted/pruned) and an older assistant message
    // still carries a fenced JSON block claiming completion.
    h.messageResponse = [
      msg(
        "ancient",
        "assistant",
        undefined,
        '```json\n{"status":"completed","summary":"result from before the loop"}\n```',
      ),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    const loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("paused");
    expect(loop.pauseReason).toBe("boundary_lost");
    // The stale claim must not have been recorded as progress.
    expect(loop.progress).toHaveLength(0);
    expect(loop.summary).toBe("");
  });

  it("does not replay an earlier marked prompt when resuming with a lost boundary", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns: 5,
    });
    h.promptAsyncFailuresRemaining = 1;
    h.promptAsyncFailureStatus = 408;
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("unknown_delivery");

    // Boundary gone, but an older loop prompt + reply are still present.
    h.messageResponse = [
      msg("old-prompt", "user", undefined, "<!-- webui-goal-loop-prompt -->\n\nold turn"),
      msg("old-reply", "assistant", undefined, '```json\n{"status":"progress","summary":"stale"}\n```'),
    ];
    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    // It must not adopt the stale reply as this turn's recovered result.
    expect(resumed?.progress).toHaveLength(0);
    expect(resumed?.status).toBe("paused");
    expect(resumed?.pauseReason).toBe("unknown_delivery");
  });
});

const TERMINAL = ["completed", "blocked", "stopped"] as const as readonly string[];

describe("goal loop rejected claim counter (docs/specs/goal-loop.md 是正 E)", () => {
  function jsonMsg(id: string, status: string, summary: string): MessageWithParts {
    return msg(
      id,
      "assistant",
      undefined,
      'r\n```json\n{"status":"' + status + '","summary":"' + summary + '"}\n```',
    );
  }

  /** Run one goal turn whose reply is `status`, returning the resulting loop. */
  async function goalTurn(tail: MessageWithParts[], id: string, status: string): Promise<void> {
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    tail.push(jsonMsg(id, status, status));
    h.messageResponse = [msg("m0", "assistant"), ...tail];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
  }

  /** Run the verification turn whose reply is `status`. */
  async function verifyTurn(tail: MessageWithParts[], id: string, status: string): Promise<void> {
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    tail.push(jsonMsg(id, status, status));
    h.messageResponse = [msg("m0", "assistant"), ...tail];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
  }

  it("accumulates rejections even when a work turn sits between them", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns: 20,
    });
    const tail: MessageWithParts[] = [];

    // claim 1 -> rejected
    await goalTurn(tail, "c1", "completed");
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");
    await verifyTurn(tail, "r1", "progress");
    expect(getGoalLoop("ws-1")?.status).toBe("queued");
    expect(getGoalLoop("ws-1")?.rejectedClaims).toBe(1);

    // a real work turn in between: this used to reset the pairing and made the
    // cap unreachable.
    await goalTurn(tail, "w1", "progress");
    expect(getGoalLoop("ws-1")?.status).toBe("queued");
    expect(getGoalLoop("ws-1")?.rejectedClaims).toBe(1);

    // claim 2 -> rejected: the cap must now fire.
    await goalTurn(tail, "c2", "completed");
    expect(getGoalLoop("ws-1")?.status).toBe("verifying_completed");
    await verifyTurn(tail, "r2", "progress");
    const loop = getGoalLoop("ws-1")!;
    expect(loop.rejectedClaims).toBe(2);
    expect(loop.status).toBe("paused");
    expect(loop.pauseReason).toBe("verification_rejected");
  });

  it("resets the counter when verification finally passes", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns: 20,
    });
    const tail: MessageWithParts[] = [];
    await goalTurn(tail, "c1", "completed");
    await verifyTurn(tail, "r1", "progress");
    expect(getGoalLoop("ws-1")?.rejectedClaims).toBe(1);

    await goalTurn(tail, "c2", "completed");
    await verifyTurn(tail, "v2", "verified_completed");
    const loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("completed");
    expect(loop.rejectedClaims).toBe(0);
  });

  it("clears the counter when resuming a verification_rejected pause", async () => {
    setupWorkspace("ws-1", "sess-1");
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns: 20,
    });
    const tail: MessageWithParts[] = [];
    await goalTurn(tail, "c1", "completed");
    await verifyTurn(tail, "r1", "progress");
    await goalTurn(tail, "c2", "completed");
    await verifyTurn(tail, "r2", "progress");
    expect(getGoalLoop("ws-1")?.pauseReason).toBe("verification_rejected");

    const resumed = await updateGoalLoopStatus("ws-1", "resume");
    expect(resumed?.status).toBe("queued");
    expect(resumed?.rejectedClaims).toBe(0);
  });

  it("never sends more than maxTurns + MAX_REJECTED_CLAIMS + 1 prompts", async () => {
    setupWorkspace("ws-1", "sess-1");
    const maxTurns = 4;
    await createGoalLoop({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      goal: "audit",
      maxTurns,
    });
    const tail: MessageWithParts[] = [];
    h.promptAsyncCount = 0;

    // The agent always claims completion and verification always rejects: the
    // worst case for prompt volume.
    for (let i = 0; i < 40; i += 1) {
      const before = getGoalLoop("ws-1")!;
      if (before.status === "paused" || TERMINAL.includes(before.status)) break;
      const kind = before.status === "verifying_completed" ? "verify" : "goal";
      await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
      tail.push(
        jsonMsg(`m${i}`, kind === "verify" ? "progress" : "completed", `turn ${i}`),
      );
      h.messageResponse = [msg("m0", "assistant"), ...tail];
      await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    }

    const loop = getGoalLoop("ws-1")!;
    expect(loop.status).toBe("paused");
    expect(loop.turnCount).toBeLessThanOrEqual(maxTurns);
    // 2 is MAX_REJECTED_CLAIMS.
    expect(h.promptAsyncCount).toBeLessThanOrEqual(maxTurns + 2 + 1);
  });
});
