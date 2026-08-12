import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getWorkspaceMock,
  listSessionBindingsMock,
  getSettingMock,
  ocServerMock,
} = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  listSessionBindingsMock: vi.fn(),
  getSettingMock: vi.fn().mockReturnValue(null),
  ocServerMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
  listSessionBindings: listSessionBindingsMock,
  getSetting: getSettingMock,
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
  return new NextRequest("http://localhost/api/tasks/task-1/next-action", { headers: { host: "127.0.0.1:3000" },
    method: "POST",
    body: JSON.stringify(body),
  });
}

const ONE_MSG = [
  {
    info: { id: "m1", role: "user" },
    parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
  },
];

/**
 * Queue the standard ocServer mock sequence for a batch generation:
 * messages → create temp → tool ids → one prompt per text → delete temp.
 * `failPromptAt` makes the prompt at that batch index reject instead.
 */
function mockFlow(suggestionTexts: string[], failPromptAt?: number) {
  ocServerMock.mockResolvedValueOnce(ONE_MSG);
  ocServerMock.mockResolvedValueOnce({ id: "temp-multi" });
  ocServerMock.mockResolvedValueOnce(["bash"]);
  suggestionTexts.forEach((t, i) => {
    if (failPromptAt === i) {
      ocServerMock.mockRejectedValueOnce(new Error("engine error"));
    } else {
      ocServerMock.mockResolvedValueOnce({
        parts: [{ type: "text", text: t }],
      });
    }
  });
  ocServerMock.mockResolvedValueOnce(true); // delete temp
}

function promptCalls() {
  return ocServerMock.mock.calls.filter(
    (c) => c[1] === "/session/temp-multi/message",
  );
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
    // Backward-compatible `suggestion` plus the new `suggestions` list.
    expect(await res.json()).toEqual({
      suggestion: "テストを実行してください",
      suggestions: ["テストを実行してください"],
    });

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

  it("does not embed an exclusion block on initial generation (no previousSuggestions)", async () => {
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
      },
    ]);
    ocServerMock.mockResolvedValueOnce({ id: "temp-init" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    ocServerMock.mockResolvedValueOnce({
      parts: [{ type: "text", text: "テストを実行してください" }],
    });
    ocServerMock.mockResolvedValueOnce(true);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    const promptBody = ocServerMock.mock.calls[3]?.[2]?.body as Record<string, unknown>;
    const parts = promptBody.parts as { type: string; text: string }[];
    expect(parts[0]?.text).not.toContain("既出の提案");
  });

  it("embeds previous suggestions and the exclusion instruction in the prompt on regeneration", async () => {
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
      },
    ]);
    ocServerMock.mockResolvedValueOnce({ id: "temp-regen" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    ocServerMock.mockResolvedValueOnce({
      parts: [{ type: "text", text: "別の提案をしてください" }],
    });
    ocServerMock.mockResolvedValueOnce(true);

    const res = await POST(
      requestWithBody({
        sessionId: "ses-1",
        previousSuggestions: ["テストを実行してください"],
      }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: "別の提案をしてください",
      suggestions: ["別の提案をしてください"],
    });
    const promptBody = ocServerMock.mock.calls[3]?.[2]?.body as Record<string, unknown>;
    const parts = promptBody.parts as { type: string; text: string }[];
    const text = parts[0]?.text ?? "";
    expect(text).toContain("【避けるべき既出の提案】");
    expect(text).toContain("- テストを実行してください");
    expect(text).toContain("実質的に同じ作業を指示する内容は避け");
  });

  it("ignores malformed previousSuggestions and generates normally", async () => {
    ocServerMock.mockResolvedValueOnce([
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
      },
    ]);
    ocServerMock.mockResolvedValueOnce({ id: "temp-bad" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    ocServerMock.mockResolvedValueOnce({
      parts: [{ type: "text", text: "テストを実行してください" }],
    });
    ocServerMock.mockResolvedValueOnce(true);

    const res = await POST(
      requestWithBody({
        sessionId: "ses-1",
        previousSuggestions: "not-an-array",
      }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    const promptBody = ocServerMock.mock.calls[3]?.[2]?.body as Record<string, unknown>;
    const parts = promptBody.parts as { type: string; text: string }[];
    expect(parts[0]?.text).not.toContain("既出の提案");
  });

  it("generates the requested number of suggestions and returns suggestion + suggestions", async () => {
    mockFlow(["提案A", "提案B", "提案C"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 3 }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: "提案A",
      suggestions: ["提案A", "提案B", "提案C"],
    });

    const calls = ocServerMock.mock.calls;
    // 0: messages, 1: create temp, 2: tool ids, 3–5: prompts, 6: delete
    expect(calls).toHaveLength(7);
    expect(calls[3]?.[1]).toBe("/session/temp-multi/message");
    expect(calls[4]?.[1]).toBe("/session/temp-multi/message");
    expect(calls[5]?.[1]).toBe("/session/temp-multi/message");
    expect(calls[6]?.[1]).toBe("/session/temp-multi");
    expect(calls[6]?.[2]?.method).toBe("DELETE");
  });

  it("excludes earlier batch suggestions in each subsequent prompt", async () => {
    mockFlow(["提案A", "提案B", "提案C"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 3 }),
      contextFor("task-1"),
    );
    expect(res.status).toBe(200);

    const calls = ocServerMock.mock.calls;
    const textAt = (i: number) =>
      ((calls[i]?.[2]?.body as Record<string, unknown>).parts as { text: string }[])[0]
        ?.text ?? "";
    // First prompt: no exclusion block.
    expect(textAt(3)).not.toContain("既出の提案");
    // Second prompt excludes the first suggestion.
    expect(textAt(4)).toContain("【避けるべき既出の提案】");
    expect(textAt(4)).toContain("- 提案A");
    // Third prompt excludes both earlier suggestions.
    expect(textAt(5)).toContain("- 提案A");
    expect(textAt(5)).toContain("- 提案B");
  });

  it("combines client previousSuggestions with in-batch exclusions", async () => {
    mockFlow(["提案B"]);

    const res = await POST(
      requestWithBody({
        sessionId: "ses-1",
        count: 2,
        previousSuggestions: ["提案A"],
      }),
      contextFor("task-1"),
    );
    expect(res.status).toBe(200);

    // First prompt already excludes the client-provided suggestion.
    const first = promptCalls()[0]?.[2]?.body as Record<string, unknown>;
    const firstText = (first.parts as { text: string }[])[0]?.text ?? "";
    expect(firstText).toContain("- 提案A");
  });

  it("clamps count above the maximum to 3 prompts", async () => {
    mockFlow(["提案A", "提案B", "提案C", "提案D", "提案E"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 99 }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: string[] };
    expect(body.suggestions).toHaveLength(3);
    expect(promptCalls()).toHaveLength(3);
  });

  it("clamps count below the minimum to a single prompt", async () => {
    mockFlow(["提案A"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 0 }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: "提案A",
      suggestions: ["提案A"],
    });
    expect(promptCalls()).toHaveLength(1);
  });

  it("treats invalid count as the default (1)", async () => {
    mockFlow(["提案A"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: "abc" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: "提案A",
      suggestions: ["提案A"],
    });
    expect(promptCalls()).toHaveLength(1);
  });

  it("accepts a numeric string count", async () => {
    mockFlow(["提案A", "提案B"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: "2" }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: string[] };
    expect(body.suggestions).toEqual(["提案A", "提案B"]);
    expect(promptCalls()).toHaveLength(2);
  });

  it("returns partial results when a later prompt in the batch fails", async () => {
    mockFlow(["提案A", "提案B"], 1); // second prompt fails

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 3 }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: "提案A",
      suggestions: ["提案A"],
    });
    // Temp session still deleted (last call).
    const last = ocServerMock.mock.calls.at(-1);
    expect(last?.[1]).toBe("/session/temp-multi");
    expect(last?.[2]?.method).toBe("DELETE");
  });

  it("propagates OcError status when every prompt in the batch fails", async () => {
    const { OcError } = await import("@/lib/oc-server");
    ocServerMock.mockResolvedValueOnce(ONE_MSG);
    ocServerMock.mockResolvedValueOnce({ id: "temp-multi" });
    ocServerMock.mockResolvedValueOnce(["bash"]);
    ocServerMock.mockRejectedValueOnce(new OcError("engine down", 503));
    ocServerMock.mockResolvedValueOnce(true); // delete temp

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 3 }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("failed to generate suggestion");
  });

  it("skips exact duplicates within a batch", async () => {
    mockFlow(["同じ提案", "同じ提案", "別の提案"]);

    const res = await POST(
      requestWithBody({ sessionId: "ses-1", count: 3 }),
      contextFor("task-1"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: string[] };
    expect(body.suggestions).toEqual(["同じ提案", "別の提案"]);
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
    expect(await res.json()).toEqual({
      suggestion: "テストしてください",
      suggestions: ["テストしてください"],
    });
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
