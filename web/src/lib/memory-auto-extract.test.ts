import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const runMemoryExtraction = vi.hoisted(() =>
  vi.fn(async () => ({ created: 1, skipped: 0, errors: [] })),
);
vi.mock("./memory-extract", () => ({ runMemoryExtraction }));

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "leafcode-memory-auto-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const {
  createWorkspace,
  bindSession,
  getDb,
  upsertProject,
  setSessionExtractState,
  MEMORY_EXTRACT_COOLDOWN_MS,
} = await import("./db");
const {
  ASSISTANT_EVENT_DEBOUNCE_MS,
  completedAssistantEvent,
  consumeMemoryEventStream,
  handleMemoryGlobalEvent,
  sseDataFromFrame,
} = await import("./memory-auto-extract");

const workspaceRoot = path.join(testDataDir, "repo");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

beforeEach(() => {
  runMemoryExtraction.mockClear();
  getDb().prepare("DELETE FROM memory_session_extract_state WHERE session_id = ?").run("ses-auto");
  const project = upsertProject({ name: "Auto memory", rootPath: workspaceRoot });
  if (!getDb().prepare("SELECT 1 FROM workspaces WHERE id = ?").get("ws-auto")) {
    createWorkspace({
      id: "ws-auto",
      projectId: project.id,
      displayName: "Auto memory",
      absolutePath: workspaceRoot,
      isolation: "current_folder",
    });
  }
  bindSession("ws-auto", "ses-auto", "Auto session");
});

const completedEvent = (messageId: string) =>
  JSON.stringify({
    directory: workspaceRoot,
    payload: {
      type: "message.updated",
      properties: {
        sessionID: "ses-auto",
        info: {
          id: messageId,
          sessionID: "ses-auto",
          role: "assistant",
          time: { created: 1, completed: 2 },
        },
      },
    },
  });

describe("completedAssistantEvent", () => {
  it("accepts a completed assistant global event", () => {
    expect(completedAssistantEvent(completedEvent("msg-1"))).toEqual({
      directory: workspaceRoot,
      sessionId: "ses-auto",
      assistantMessageId: "msg-1",
    });
  });

  it("ignores user, incomplete, and unrelated events", () => {
    expect(
      completedAssistantEvent(
        completedEvent("msg-user").replace('"assistant"', '"user"'),
      ),
    ).toBeNull();
    expect(
      completedAssistantEvent(
        completedEvent("msg-pending").replace(',"completed":2', ""),
      ),
    ).toBeNull();
    expect(
      completedAssistantEvent(
        completedEvent("msg-other").replace("message.updated", "session.idle"),
      ),
    ).toBeNull();
  });
});

describe("SSE parsing", () => {
  it("extracts data lines and ignores heartbeat frames", () => {
    expect(sseDataFromFrame("event: heartbeat\ndata: ping")).toBe("ping");
    expect(sseDataFromFrame(": keep-alive")).toBeNull();
  });

  it("handles frames split across stream chunks", async () => {
    const chunks = [
      `data: ${completedEvent("msg-stream").slice(0, 40)}`,
      `${completedEvent("msg-stream").slice(40)}\n\n`,
      "event: heartbeat\ndata: ping\n\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const received: string[] = [];
    await consumeMemoryEventStream(body, (data) => received.push(data));
    expect(received).toHaveLength(2);
    expect(JSON.parse(received[0]!).payload.type).toBe("message.updated");
    expect(received[1]).toBe("ping");
  });
});

describe("handleMemoryGlobalEvent", () => {
  it("claims and schedules each assistant message only once", async () => {
    expect(handleMemoryGlobalEvent(completedEvent("msg-dedupe"))).toBe(1);
    expect(handleMemoryGlobalEvent(completedEvent("msg-dedupe"))).toBe(0);
    await vi.waitFor(() => {
      expect(runMemoryExtraction).toHaveBeenCalledTimes(1);
      expect(runMemoryExtraction).toHaveBeenCalledWith({
        workspaceId: "ws-auto",
        sessionId: "ses-auto",
        assistantMessageId: "msg-dedupe",
        trigger: "assistant-completed",
      });
      expect(
        getDb()
          .prepare(
            "SELECT status FROM memory_assistant_extracts WHERE assistant_message_id = ?",
          )
          .get("msg-dedupe"),
      ).toEqual({ status: "completed" });
    });
  });

  it("coalesces multiple completed assistant steps into one extraction", async () => {
    expect(handleMemoryGlobalEvent(completedEvent("msg-step-1"))).toBe(1);
    expect(handleMemoryGlobalEvent(completedEvent("msg-step-2"))).toBe(1);
    expect(handleMemoryGlobalEvent(completedEvent("msg-step-3"))).toBe(1);
    expect(runMemoryExtraction).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(runMemoryExtraction).toHaveBeenCalledTimes(1);
    });
    expect(runMemoryExtraction).toHaveBeenCalledWith({
      workspaceId: "ws-auto",
      sessionId: "ses-auto",
      assistantMessageId: "msg-step-3",
      trigger: "assistant-completed",
    });
  });

  it("skips a turn whose session was extracted within the cooldown window", async () => {
    // v1 extracted on every completed assistant message; the cooldown is what
    // stops one long session from producing hundreds of runs.
    setSessionExtractState({
      workspaceId: "ws-auto",
      sessionId: "ses-auto",
      lastMessageId: "msg-earlier",
      extractedAt: Date.now(),
    });
    // The event is still registered with the debouncer; the cooldown is applied
    // when the timer fires, so a cooldown that lapses mid-burst still runs.
    expect(handleMemoryGlobalEvent(completedEvent("msg-cooldown"))).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, ASSISTANT_EVENT_DEBOUNCE_MS + 200));
    expect(runMemoryExtraction).not.toHaveBeenCalled();
    // No claim is recorded, so the same message is reconsidered once the
    // cooldown lapses rather than being permanently swallowed.
    expect(
      getDb()
        .prepare("SELECT status FROM memory_assistant_extracts WHERE assistant_message_id = ?")
        .get("msg-cooldown"),
    ).toBeUndefined();
  });

  it("runs again once the cooldown has elapsed", async () => {
    setSessionExtractState({
      workspaceId: "ws-auto",
      sessionId: "ses-auto",
      lastMessageId: "msg-earlier",
      extractedAt: Date.now() - (MEMORY_EXTRACT_COOLDOWN_MS + 1),
    });
    expect(handleMemoryGlobalEvent(completedEvent("msg-after-cooldown"))).toBe(1);
    await vi.waitFor(() => {
      expect(runMemoryExtraction).toHaveBeenCalledTimes(1);
    });
  });
});
