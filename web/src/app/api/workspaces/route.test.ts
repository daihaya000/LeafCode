import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  setWorkspaceStatus: vi.fn(),
  listWorkspaces: vi.fn(() => []),
  provisionWorkspace: vi.fn(),
  destroyWorkspace: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  listWorkspaces: () => h.listWorkspaces(),
  getWorkspace: (id: string) => h.getWorkspace(id),
  setWorkspaceStatus: (...a: unknown[]) => h.setWorkspaceStatus(...a),
}));

vi.mock("@/lib/workspace-service", () => ({
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  destroyWorkspace: (...a: unknown[]) => h.destroyWorkspace(...a),
  isIsolation: () => true,
  provisionWorkspace: (...a: unknown[]) => h.provisionWorkspace(...a),
}));

import { PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  h.getWorkspace.mockReturnValue({ id: "ws1" });
});

describe("PATCH /api/workspaces status", () => {
  it("rejects client-driven orphaned status", async () => {
    const res = await PATCH(
      new NextRequest("http://localhost/api/workspaces", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ws1", status: "orphaned" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid status" });
    expect(h.setWorkspaceStatus).not.toHaveBeenCalled();
  });

  it("allows archived", async () => {
    const res = await PATCH(
      new NextRequest("http://localhost/api/workspaces", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ws1", status: "archived" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(h.setWorkspaceStatus).toHaveBeenCalledWith("ws1", "archived");
  });
});
