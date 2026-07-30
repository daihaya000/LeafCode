import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(
    (dir: string) => ({ ok: true as const, path: dir }),
  ),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/opencode", () => ({
  OPENCODE_BASE_URL: "http://127.0.0.1:4096",
}));

import { DELETE } from "./route";

function localRequest(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: "localhost:3000" } });
}

function lanRequest(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: "192.168.0.55:3000" } });
}

describe("DELETE /api/pty-session/[id]", () => {
  it("rejects non-loopback callers (host-only guard)", async () => {
    const res = await DELETE(
      lanRequest("http://localhost/api/pty-session?id=pty_1&directory=C:/proj"),
    );
    expect(res.status).toBe(403);
  });

  it("rejects malformed pty id", async () => {
    const res = await DELETE(
      localRequest("http://localhost/api/pty-session?id=../escape&directory=C:/proj"),
    );
    expect(res.status).toBe(400);
  });

  it("requires a directory", async () => {
    const res = await DELETE(
      localRequest("http://localhost/api/pty-session?id=pty_1"),
    );
    expect(res.status).toBe(400);
  });

  it("removes the PTY session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("true", { status: 200 }),
    );
    const res = await DELETE(
      localRequest("http://localhost/api/pty-session?id=pty_1&directory=C:/proj"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/pty/pty_1");
    expect(fetchMock.mock.calls[0][1]!.method).toBe("DELETE");
  });
});
