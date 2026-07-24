import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getWorkspaceMock,
  listSessionBindingsMock,
  ocServerMock,
} = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  listSessionBindingsMock: vi.fn(),
  ocServerMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
  listSessionBindings: listSessionBindingsMock,
}));

vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  ocServer: ocServerMock,
}));

import { POST } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function requestWithBody(body: unknown) {
  return new NextRequest("http://localhost/api/tasks/task-1/next-action", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const WS = {
  id: "task-1",
  absolute_path: "/tmp/ws",
  project_id: "proj-1",
  display_name: "ws",
  isolation: "current_folder" as const,
  base_branch: null,
  worktree_path: null,
  status: "active" as const,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceMock.mockReturnValue(WS);
  listSessionBindingsMock.mockReturnValue([
    { workspace_id: "task-1", opencode_session_id: "ses-1", title: "", updated_at: "" },
  ]);
  ocServerMock.mockReset();
});

describe("POST /api/tasks/[id]/next-action", () => {
  it("returns 404 when task does not exist", async () => {
    getWorkspaceMock.mockReturnValue(undefined);
    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );
    expect(res.status).toBe(404);
    expect(ocServerMock).not.toHaveBeenCalled();
  });

  it("returns 400 when sessionId is missing", async () => {
    const res = await POST(requestWithBody({}), contextFor("task-1"));
    expect(res.status).toBe(400);
    expect(ocServerMock).not.toHaveBeenCalled();
  });

  it("returns 400 when sessionId is unsafe", async () => {
    const res = await POST(
      requestWithBody({ sessionId: "../etc/passwd" }),
      contextFor("task-1"),
    );
    expect(res.status).toBe(400);
    expect(ocServerMock).not.toHaveBeenCalled();
  });

  it("returns 404 when session binding is missing", async () => {
    listSessionBindingsMock.mockReturnValue([]);
    const res = await POST(
      requestWithBody({ sessionId: "ses-other" }),
      contextFor("task-1"),
    );
    expect(res.status).toBe(404);
    expect(ocServerMock).not.toHaveBeenCalled();
  });

  it("returns 400 when conversation is empty", async () => {
    ocServerMock.mockResolvedValueOnce([]); // /session/{id}/message
    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );
    expect(res.status).toBe(400);
  });

  it("creates temp session, prompts with tools disabled, deletes temp, returns suggestion", async () => {
    // 1. fetch messages
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
      },
      {
        info: { id: "m2", role: "assistant" },
        parts: [{ id: "p2", messageID: "m2", type: "text", text: "hi there" }],
      },
    ]);
    // 2. create temp session
    ocServerMock.mockResolvedValueOnce({ id: "temp-1" });
    // 3. tool ids
    ocServerMock.mockResolvedValueOnce(["bash", "read", "write"]);
    // 4. synchronous prompt
    ocServerMock.mockResolvedValueOnce({
      parts: [{ type: "text", text: "テストを実行してください" }],
    });
    // 5. delete temp session
    ocServerMock.mockResolvedValueOnce(true);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "テストを実行してください" });

    // Verify call sequence
    const calls = ocServerMock.mock.calls;
    // call 0: GET messages
    expect(calls[0]?.[1]).toBe("/session/ses-1/message");
    // call 1: POST /session (create temp)
    expect(calls[1]?.[1]).toBe("/session");
    expect(calls[1]?.[2]?.method).toBe("POST");
    // call 2: GET tool ids
    expect(calls[2]?.[1]).toBe("/experimental/tool/ids");
    // call 3: POST /session/temp-1/message (prompt)
    expect(calls[3]?.[1]).toBe("/session/temp-1/message");
    expect(calls[3]?.[2]?.method).toBe("POST");
    const promptBody = calls[3]?.[2]?.body as Record<string, unknown>;
    expect(promptBody.tools).toEqual({ bash: false, read: false, write: false });
    expect(typeof promptBody.system).toBe("string");
    // call 4: DELETE /session/temp-1
    expect(calls[4]?.[1]).toBe("/session/temp-1");
    expect(calls[4]?.[2]?.method).toBe("DELETE");
  });

  it("passes model/agent to the prompt when provided", async () => {
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
      },
    ]);
    ocServerMock.mockResolvedValueOnce({ id: "temp-2" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    ocServerMock.mockResolvedValueOnce({
      parts: [{ type: "text", text: "コミットしてください" }],
    });
    ocServerMock.mockResolvedValueOnce(true);

    const res = await POST(
      requestWithBody({
        sessionId: "ses-1",
        model: { providerID: "anthropic", modelID: "claude" },
        agent: "build",
      }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    const promptBody = ocServerMock.mock.calls[3]?.[2]?.body as Record<string, unknown>;
    expect(promptBody.model).toEqual({ providerID: "anthropic", modelID: "claude" });
    expect(promptBody.agent).toBe("build");
  });

  it("returns 502 when prompt fails and still deletes temp session", async () => {
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
      },
    ]);
    ocServerMock.mockResolvedValueOnce({ id: "temp-3" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    // prompt fails
    const { OcError } = await import("@/lib/oc-server");
    ocServerMock.mockRejectedValueOnce(new OcError("engine error", 502));
    // delete still called
    ocServerMock.mockResolvedValueOnce(true);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("failed to generate suggestion");
    // Body must not leak conversation text
    expect(JSON.stringify(body)).not.toContain("hi");
    // DELETE still happened
    const lastCall = ocServerMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe("/session/temp-3");
    expect(lastCall?.[2]?.method).toBe("DELETE");
  });

  it("succeeds even when temp session delete fails", async () => {
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
      },
    ]);
    ocServerMock.mockResolvedValueOnce({ id: "temp-4" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    ocServerMock.mockResolvedValueOnce({
      parts: [{ type: "text", text: "テストしてください" }],
    });
    // delete fails
    ocServerMock.mockRejectedValueOnce(new Error("delete failed"));

    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "テストしてください" });
    // Verify delete was attempted (5th call)
    const calls = ocServerMock.mock.calls;
    expect(calls.length).toBe(5);
    expect(calls[4]?.[1]).toBe("/session/temp-4");
    expect(calls[4]?.[2]?.method).toBe("DELETE");
  });

  it("does not leak conversation body in error responses", async () => {
    const { OcError } = await import("@/lib/oc-server");
    ocServerMock.mockRejectedValueOnce(new OcError("engine down", 503));

    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("failed to read conversation");
    expect(JSON.stringify(body)).not.toContain("engine down");
  });
});
