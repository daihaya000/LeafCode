import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getWorkspaceMock, restoreWorkspaceMock } = vi.hoisted(() => ({
  getWorkspaceMock: vi.fn(),
  restoreWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getWorkspace: getWorkspaceMock,
}));

vi.mock("@/lib/workspace-service", () => ({
  restoreWorkspace: restoreWorkspaceMock,
  ServiceError: class ServiceError extends Error {
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

describe("PATCH /api/tasks/[id]/restore", () => {
  it("restores an archived workspace and returns 200", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "archived",
    });
    restoreWorkspaceMock.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/restore", { headers: { host: "127.0.0.1:3000" },
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(restoreWorkspaceMock).toHaveBeenCalledWith("ws1");
  });

  it("returns 404 when workspace does not exist", async () => {
    getWorkspaceMock.mockReturnValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/missing/restore", { headers: { host: "127.0.0.1:3000" },
        method: "PATCH",
      }),
      contextFor("missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task not found" });
    expect(restoreWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns 404 when workspace status is not archived", async () => {
    getWorkspaceMock.mockReturnValue({
      id: "ws1",
      status: "active",
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/ws1/restore", { headers: { host: "127.0.0.1:3000" },
        method: "PATCH",
      }),
      contextFor("ws1"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task not found" });
    expect(restoreWorkspaceMock).not.toHaveBeenCalled();
  });
});
