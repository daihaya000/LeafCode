// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runMemoryExtraction: vi.fn<
    (...args: unknown[]) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  isMemoryEnabled: vi.fn<(...args: unknown[]) => boolean>(() => true),
  getWorkspace: vi.fn<(...args: unknown[]) => unknown>(() => ({ id: "ws-1" })),
}));

vi.mock("@/lib/memory-extract", () => ({
  runMemoryExtraction: (...a: unknown[]) => h.runMemoryExtraction(...a),
}));
vi.mock("@/lib/memory-write-gate", () => ({
  isMemoryEnabled: (...a: unknown[]) => h.isMemoryEnabled(...a),
}));
vi.mock("@/lib/db", () => ({
  getWorkspace: (...a: unknown[]) => h.getWorkspace(...a),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/memory/extract", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isMemoryEnabled.mockReturnValue(true);
  h.getWorkspace.mockReturnValue({ id: "ws-1" });
  h.runMemoryExtraction.mockResolvedValue({ ok: true });
});

describe("POST /api/memory/extract", () => {
  it("requires workspaceId and sessionId", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(h.runMemoryExtraction).not.toHaveBeenCalled();
  });

  it("rejects invalid body types", async () => {
    const res = await post({ workspaceId: 1, sessionId: "s-1" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the memory layer is disabled", async () => {
    h.isMemoryEnabled.mockReturnValue(false);
    const res = await post({ workspaceId: "ws-1", sessionId: "s-1" });
    expect(res.status).toBe(409);
    expect(h.runMemoryExtraction).not.toHaveBeenCalled();
  });

  it("returns 404 when the workspace does not exist", async () => {
    h.getWorkspace.mockReturnValue(null);
    const res = await post({ workspaceId: "missing", sessionId: "s-1" });
    expect(res.status).toBe(404);
    expect(h.runMemoryExtraction).not.toHaveBeenCalled();
  });

  it("runs a manual extraction for the session", async () => {
    const res = await post({ workspaceId: "ws-1", sessionId: "s-1" });
    expect(res.status).toBe(200);
    expect(h.runMemoryExtraction).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      sessionId: "s-1",
      trigger: "manual",
    });
  });

  it("returns 502 when the extraction fails", async () => {
    h.runMemoryExtraction.mockResolvedValue({ ok: false, error: "model timeout" });
    const res = await post({ workspaceId: "ws-1", sessionId: "s-1" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("model timeout");
  });
});
