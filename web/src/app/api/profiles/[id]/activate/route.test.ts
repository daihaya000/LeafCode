import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  activate: vi.fn(),
}));

vi.mock("@/lib/profiles/service", () => service);

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

  it("returns ok on success", async () => {
    service.activate.mockReturnValue({ ok: true });

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/profiles/abc/activate"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
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
  });
});
