// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  listMemoryExtractionRuns: vi.fn<(...args: unknown[]) => unknown[]>(
    () => [],
  ),
  countUnreadMemoryExtractionRuns: vi.fn<(...args: unknown[]) => number>(
    () => 0,
  ),
}));

vi.mock("@/lib/db", () => ({
  listMemoryExtractionRuns: (...a: unknown[]) => h.listMemoryExtractionRuns(...a),
  countUnreadMemoryExtractionRuns: (...a: unknown[]) =>
    h.countUnreadMemoryExtractionRuns(...a),
}));

import { GET } from "./route";

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/memory/extractions${query}`, {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.listMemoryExtractionRuns.mockReturnValue([]);
  h.countUnreadMemoryExtractionRuns.mockReturnValue(0);
});

describe("GET /api/memory/extractions", () => {
  it("requires workspace_id", async () => {
    const res = await get();
    expect(res.status).toBe(400);
    expect(h.listMemoryExtractionRuns).not.toHaveBeenCalled();
  });

  it("lists extraction runs with the unread count", async () => {
    h.listMemoryExtractionRuns.mockReturnValue([
      { id: "run-1", status: "done" },
    ]);
    h.countUnreadMemoryExtractionRuns.mockReturnValue(2);
    const res = await get("?workspace_id=ws-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.unreadCount).toBe(2);
    expect(h.listMemoryExtractionRuns).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      limit: undefined,
      unreadOnly: false,
    });
  });

  it("passes limit and unread_only", async () => {
    await get("?workspace_id=ws-1&limit=10&unread_only=1");
    expect(h.listMemoryExtractionRuns).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      limit: 10,
      unreadOnly: true,
    });
  });

  it("rejects a non-positive limit", async () => {
    const res = await get("?workspace_id=ws-1&limit=0");
    expect(res.status).toBe(400);
    expect(h.listMemoryExtractionRuns).not.toHaveBeenCalled();
  });

  it("accepts an empty limit and falls back to the default", async () => {
    await get("?workspace_id=ws-1&limit=");
    expect(h.listMemoryExtractionRuns).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      limit: undefined,
      unreadOnly: false,
    });
  });
});
