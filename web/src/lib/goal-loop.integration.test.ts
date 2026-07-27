import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { MessageWithParts } from "./types";

const h = vi.hoisted(() => ({
  ocCalls: [] as { path: string; body?: unknown }[],
  statusResponse: {} as Record<string, { type: "idle" | "busy" }>,
  messageResponse: [] as MessageWithParts[],
  promptAsyncDelayMs: 0,
  promptAsyncCount: 0,
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
    if (path === "/session/status") return h.statusResponse;
    if (path.endsWith("/message")) return h.messageResponse;
    if (path.endsWith("/prompt_async")) {
      h.promptAsyncCount += 1;
      if (h.promptAsyncDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, h.promptAsyncDelayMs));
      }
      return {};
    }
    if (path.endsWith("/abort")) return {};
    return {};
  }),
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goal_loops_workspace ON goal_loops(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_status ON goal_loops(status);
  `);
  return db;
}

function msg(id: string, role: "user" | "assistant", structured?: unknown): MessageWithParts {
  return {
    info: {
      id,
      role,
      structured,
      time: { created: 1, completed: 2 },
    },
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
});

describe("goal loop integration", () => {
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
      msg("loop-prompt", "user"),
      msg("loop-reply", "assistant", { status: "progress", summary: "loop turn done" }),
    ];
    await goalLoopTestSeams.processLoop(getGoalLoop("ws-1")!);
    expect(getGoalLoop("ws-1")?.status).toBe("queued");

    // Pause the loop, then simulate a manual user send arriving while paused.
    await updateGoalLoopStatus("ws-1", "pause");
    h.messageResponse = [
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
      msg("manual-prompt", "user"),
      msg("manual-reply", "assistant", { status: "completed", summary: "manual" }),
    ];

    await pauseGoalLoopForManualSend("ws-1", "sess-1");
    const loop = getGoalLoop("ws-1");
    expect(loop?.status).toBe("paused");
    expect(loop?.lastMessageId).toBe("manual-reply");
  });
});
