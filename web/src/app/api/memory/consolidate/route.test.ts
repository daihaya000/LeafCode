// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  consolidateDuplicateMemories: vi.fn<
    (...args: unknown[]) => { removed: number; remaining: number }
  >(() => ({ removed: 2, remaining: 5 })),
  logMemoryAudit: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));

vi.mock("@/lib/memory", () => ({
  consolidateDuplicateMemories: (...a: unknown[]) =>
    h.consolidateDuplicateMemories(...a),
  logMemoryAudit: (...a: unknown[]) => h.logMemoryAudit(...a),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/memory/consolidate", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.consolidateDuplicateMemories.mockReturnValue({ removed: 2, remaining: 5 });
});

describe("POST /api/memory/consolidate", () => {
  it("requires a workspaceId", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(h.consolidateDuplicateMemories).not.toHaveBeenCalled();
  });

  it("rejects empty workspaceId", async () => {
    const res = await post({ workspaceId: "" });
    expect(res.status).toBe(400);
  });

  it("runs as a dry run by default", async () => {
    const res = await post({ workspaceId: "ws-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(2);
    expect(h.consolidateDuplicateMemories).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      dryRun: true,
    });
    expect(h.logMemoryAudit).not.toHaveBeenCalled();
  });

  it("performs the consolidation when dryRun is false and audits it", async () => {
    const res = await post({ workspaceId: "ws-1", dryRun: false });
    expect(res.status).toBe(200);
    expect(h.consolidateDuplicateMemories).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      dryRun: false,
    });
    expect(h.logMemoryAudit).toHaveBeenCalledWith("delete", {
      workspaceId: "ws-1",
      detail: "consolidate removed=2 remaining=5",
    });
  });
});
