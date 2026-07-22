import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getWorkspaceMock,
  touchSessionActivityMock,
} = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  touchSessionActivityMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
  touchSessionActivity: touchSessionActivityMock,
}));

import { POST } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function requestWithBody(body: unknown) {
  return new NextRequest("http://localhost/api/tasks/task-1/activity", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceMock.mockReturnValue({ id: "task-1" });
  touchSessionActivityMock.mockReturnValue(true);
});

describe("POST /api/tasks/[id]/activity", () => {
  it("updates activity for the matching task session", async () => {
    const response = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(touchSessionActivityMock).toHaveBeenCalledWith("task-1", "ses-1");
  });

  it("returns 400 when sessionId is missing or malformed", async () => {
    for (const body of [{}, { sessionId: 42 }, { sessionId: "" }]) {
      const response = await POST(requestWithBody(body), contextFor("task-1"));
      expect(response.status).toBe(400);
    }
    expect(touchSessionActivityMock).not.toHaveBeenCalled();
  });

  it("returns 400 when sessionId is unsafe", async () => {
    const response = await POST(
      requestWithBody({ sessionId: "../etc/passwd" }),
      contextFor("task-1"),
    );

    expect(response.status).toBe(400);
    expect(touchSessionActivityMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    getWorkspaceMock.mockReturnValue(undefined);

    const response = await POST(
      requestWithBody({ sessionId: "ses-1" }),
      contextFor("task-1"),
    );

    expect(response.status).toBe(404);
    expect(touchSessionActivityMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the binding is not found", async () => {
    touchSessionActivityMock.mockReturnValue(false);

    const response = await POST(
      requestWithBody({ sessionId: "ses-other" }),
      contextFor("task-1"),
    );

    expect(response.status).toBe(404);
  });
});
