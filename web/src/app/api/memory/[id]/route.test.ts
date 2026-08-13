// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  updateMemory: vi.fn<(...args: unknown[]) => unknown>(() => null),
  deleteMemory: vi.fn<(...args: unknown[]) => boolean>(() => true),
  getMemoryById: vi.fn<(...args: unknown[]) => unknown>(() => null),
  isMemoryKind: vi.fn<(...args: unknown[]) => boolean>(
    (kind: unknown) => kind === "permanent" || kind === "temporary",
  ),
  logMemoryAudit: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));

vi.mock("@/lib/memory", () => ({
  updateMemory: (...a: unknown[]) => h.updateMemory(...a),
  deleteMemory: (...a: unknown[]) => h.deleteMemory(...a),
  getMemoryById: (...a: unknown[]) => h.getMemoryById(...a),
  isMemoryKind: (...a: unknown[]) => h.isMemoryKind(...a),
  logMemoryAudit: (...a: unknown[]) => h.logMemoryAudit(...a),
}));

import { DELETE, PATCH } from "./route";

const params = Promise.resolve({ id: "mem-1" });

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/memory/mem-1", {
      method: "PATCH",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params },
  );
}

function del(query = "") {
  return DELETE(
    new NextRequest(`http://localhost/api/memory/mem-1${query}`, {
      method: "DELETE",
      headers: { host: "127.0.0.1:3000" },
    }),
    { params },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isMemoryKind.mockImplementation(
    (kind: unknown) => kind === "permanent" || kind === "temporary",
  );
});

describe("PATCH /api/memory/:id", () => {
  it("requires workspaceId", async () => {
    const res = await patch({ expectedRevision: 1 });
    expect(res.status).toBe(400);
    expect(h.updateMemory).not.toHaveBeenCalled();
  });

  it("requires a safe expectedRevision", async () => {
    const res = await patch({ workspaceId: "ws-1", expectedRevision: -1 });
    expect(res.status).toBe(400);
  });

  it("rejects non-string content", async () => {
    const res = await patch({
      workspaceId: "ws-1",
      expectedRevision: 1,
      content: 123,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid kind", async () => {
    h.isMemoryKind.mockReturnValue(false);
    const res = await patch({
      workspaceId: "ws-1",
      expectedRevision: 1,
      kind: "invalid",
    });
    expect(res.status).toBe(400);
  });

  it("updates the memory and audits it", async () => {
    h.updateMemory.mockReturnValue({ id: "mem-1", workspaceId: "ws-1", content: "new" });
    const res = await patch({
      workspaceId: "ws-1",
      expectedRevision: 2,
      content: "new",
      kind: "permanent",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.content).toBe("new");
    expect(h.updateMemory).toHaveBeenCalledWith("mem-1", "ws-1", 2, {
      content: "new",
      kind: "permanent",
    });
    expect(h.logMemoryAudit).toHaveBeenCalledWith("update", {
      memoryId: "mem-1",
      workspaceId: "ws-1",
    });
  });

  it("returns 409 when the memory changed in another session", async () => {
    h.updateMemory.mockReturnValue(null);
    h.getMemoryById.mockReturnValue({ id: "mem-1", content: "other" });
    const res = await patch({ workspaceId: "ws-1", expectedRevision: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("changed in another session");
  });

  it("returns 404 when the memory does not exist", async () => {
    h.updateMemory.mockReturnValue(null);
    h.getMemoryById.mockReturnValue(null);
    const res = await patch({ workspaceId: "ws-1", expectedRevision: 1 });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the update throws", async () => {
    h.updateMemory.mockImplementation(() => {
      throw new Error("revision conflict");
    });
    const res = await patch({ workspaceId: "ws-1", expectedRevision: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("revision conflict");
  });
});

describe("DELETE /api/memory/:id", () => {
  it("requires workspace_id", async () => {
    const res = await del("?expected_revision=1");
    expect(res.status).toBe(400);
  });

  it("requires expected_revision", async () => {
    const res = await del("?workspace_id=ws-1");
    expect(res.status).toBe(400);
  });

  it("deletes the memory and audits it", async () => {
    h.deleteMemory.mockReturnValue(true);
    const res = await del("?workspace_id=ws-1&expected_revision=3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.deleteMemory).toHaveBeenCalledWith("mem-1", "ws-1", 3);
    expect(h.logMemoryAudit).toHaveBeenCalledWith("delete", {
      memoryId: "mem-1",
      workspaceId: "ws-1",
    });
  });

  it("returns 409 when the memory changed in another session", async () => {
    h.deleteMemory.mockReturnValue(false);
    h.getMemoryById.mockReturnValue({ id: "mem-1" });
    const res = await del("?workspace_id=ws-1&expected_revision=1");
    expect(res.status).toBe(409);
  });

  it("returns 404 when the memory does not exist", async () => {
    h.deleteMemory.mockReturnValue(false);
    h.getMemoryById.mockReturnValue(null);
    const res = await del("?workspace_id=ws-1&expected_revision=1");
    expect(res.status).toBe(404);
  });
});
