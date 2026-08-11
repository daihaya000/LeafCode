import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const runMemoryExtraction = vi.hoisted(() =>
  vi.fn(async () => ({ created: 1, skipped: 0, errors: [] })),
);
vi.mock("./memory-extract", () => ({ runMemoryExtraction }));

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-memory-auto-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { createWorkspace, bindSession, getDb, upsertProject } = await import("./db");
const {
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
    expect(runMemoryExtraction).toHaveBeenCalledTimes(1);
    expect(runMemoryExtraction).toHaveBeenCalledWith({
      workspaceId: "ws-auto",
      sessionId: "ses-auto",
      assistantMessageId: "msg-dedupe",
      trigger: "assistant-completed",
    });
    await vi.waitFor(() => {
      expect(
        getDb()
          .prepare(
            "SELECT status FROM memory_assistant_extracts WHERE assistant_message_id = ?",
          )
          .get("msg-dedupe"),
      ).toEqual({ status: "completed" });
    });
  });
});
