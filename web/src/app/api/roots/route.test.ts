import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  addAllowedRoot: vi.fn(),
  listAllowedRoots: vi.fn(() => []),
  setSetting: vi.fn(),
}));
vi.mock("@/lib/allowlist", () => ({
  realPathOrResolved: (p: string) => p,
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/roots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/roots path validation", () => {
  it("rejects a non-existent path with 400", async () => {
    const res = await POST(req({ path: "C:\\definitely-nonexistent-xyz" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects a file path with 400", async () => {
    const res = await POST(req({ path: __filename }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects Windows drive root with 400", async () => {
    const res = await POST(req({ path: "C:\\" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects C:\\Windows with 400", async () => {
    const res = await POST(req({ path: "C:\\Windows" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects C:\\Program Files with 400", async () => {
    const res = await POST(req({ path: "C:\\Program Files" }) as never);
    expect(res.status).toBe(400);
  });

  it.each(["C:\\Program Files (x86)", "C:\\ProgramData"])(
    "rejects %s with 400",
    async (path) => {
      const res = await POST(req({ path }) as never);
      expect(res.status).toBe(400);
    },
  );

  it("rejects the user profile root with 400", async () => {
    const res = await POST(req({ path: process.env.USERPROFILE }) as never);
    expect(res.status).toBe(400);
  });
});
