import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  activate: vi.fn(),
}));

const syncEngine = vi.hoisted(() => ({
  applySync: vi.fn(),
}));

vi.mock("@/lib/profiles/service", () => service);
vi.mock("@/lib/profiles/sync-engine", () => syncEngine);

import { POST } from "./route";

function localRequest(url: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "127.0.0.1:3000" },
  });
}

function remoteRequest(url: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "10.0.0.5:3000" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/profiles/[id]/activate", () => {
  it("rejects non-local requests", async () => {
    const res = await POST(
      remoteRequest("http://lan.example.com/api/profiles/abc/activate"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns ok and runs MCP sync on success", async () => {
    service.activate.mockReturnValue({ ok: true });
    syncEngine.applySync.mockReturnValue({
      ok: true,
      masterServers: ["browser-bridge"],
      changedFiles: 0,
      targets: {
        codex: { exists: true, updated: false, message: "already in sync" },
        claude: { exists: true, updated: false, message: "already in sync" },
      },
    });

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/profiles/abc/activate"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sync.ok).toBe(true);
    expect(body.sync.masterServers).toEqual(["browser-bridge"]);
    expect(service.activate).toHaveBeenCalledWith("abc");
    expect(syncEngine.applySync).toHaveBeenCalled();
  });

  it("returns ok and captures sync error separately", async () => {
    service.activate.mockReturnValue({ ok: true });
    syncEngine.applySync.mockImplementation(() => {
      throw new Error("sync failed");
    });

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/profiles/abc/activate"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sync).toBeUndefined();
    expect(body.syncError).toMatch(/sync failed/);
    expect(service.activate).toHaveBeenCalledWith("abc");
  });

  it("returns 409 with the service error", async () => {
    service.activate.mockReturnValue({
      status: 409,
      error: "実体ディレクトリのため切り替えられません。",
    });

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/profiles/abc/activate"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/実体ディレクトリ/);
    expect(syncEngine.applySync).not.toHaveBeenCalled();
  });
});
