import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspaceMock, archiveWorkspaceMock } = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  archiveWorkspaceMock: vi.fn(),
}));
const { assertNoActiveWorkflowMock } = vi.hoisted(() => ({
  assertNoActiveWorkflowMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
}));

vi.mock("@/lib/workspace-service", () => ({
  archiveWorkspace: archiveWorkspaceMock,
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/workflow-service", () => ({
  assertNoActiveWorkflow: assertNoActiveWorkflowMock,
  WorkflowServiceError: class WorkflowServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { PATCH } from "./route";

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/tasks/[id]/archive", () => {
  it("archives an active workspace and returns 200", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "active",
    });
    archiveWorkspaceMock.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/archive", {
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(archiveWorkspaceMock).toHaveBeenCalledWith("ws1");
  });

  it("returns 404 when workspace does not exist", async () => {
    getWorkspaceMock.mockReturnValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/missing/archive", {
        method: "PATCH",
      }),
      contextFor("missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task not found" });
    expect(archiveWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns 409 when workspace status is merging", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "merging",
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/archive", {
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "cannot archive a merging task",
    });
    expect(archiveWorkspaceMock).not.toHaveBeenCalled();
  });
});
