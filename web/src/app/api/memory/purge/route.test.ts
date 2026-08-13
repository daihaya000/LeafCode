// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  deleteAllMemories: vi.fn<
    (...args: unknown[]) => { deleted: number }
  >(() => ({ deleted: 3 })),
}));

vi.mock("@/lib/memory", () => ({
  deleteAllMemories: (...a: unknown[]) => h.deleteAllMemories(...a),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/memory/purge", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deleteAllMemories.mockReturnValue({ deleted: 3 });
});

describe("POST /api/memory/purge", () => {
  it("requires a workspaceId", async () => {
    const res = await post({ confirm: true });
    expect(res.status).toBe(400);
    expect(h.deleteAllMemories).not.toHaveBeenCalled();
  });

  it("rejects empty workspaceId", async () => {
    const res = await post({ workspaceId: "", confirm: true });
    expect(res.status).toBe(400);
  });

  it("requires confirm to be true", async () => {
    const res = await post({ workspaceId: "ws-1", confirm: false });
    expect(res.status).toBe(400);
    expect(h.deleteAllMemories).not.toHaveBeenCalled();
  });

  it("rejects a string confirm", async () => {
    const res = await post({ workspaceId: "ws-1", confirm: "yes" });
    expect(res.status).toBe(400);
  });

  it("deletes all memories in the workspace", async () => {
    const res = await post({ workspaceId: "ws-1", confirm: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(3);
    expect(h.deleteAllMemories).toHaveBeenCalledWith({ workspaceId: "ws-1" });
  });
});
