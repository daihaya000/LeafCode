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
  resolveOpencodeBaseUrl: async () => "http://127.0.0.1:4096",
}));

import { POST } from "./route";

interface BodyInit {
  method: string;
  body: string;
  headers: Record<string, string>;
}

function localRequest(url: string, init?: BodyInit): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: { host: "localhost:3000", ...(init?.headers ?? {}) },
  });
}

function lanRequest(url: string, init?: BodyInit): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: { host: "192.168.0.55:3000", ...(init?.headers ?? {}) },
  });
}

function jsonBody(body: unknown): BodyInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

describe("POST /api/pty-session/resize", () => {
  it("rejects non-loopback callers (host-only guard)", async () => {
    const res = await POST(
      lanRequest(
        "http://localhost/api/pty-session/resize?id=pty_1&directory=C:/proj",
        jsonBody({ rows: 24, cols: 80 }),
      ),
    );
    expect(res.status).toBe(403);
  });

  it("rejects malformed pty id", async () => {
    const res = await POST(
      localRequest(
        "http://localhost/api/pty-session/resize?directory=C:/proj",
        jsonBody({ rows: 24, cols: 80 }),
      ),
    );
    // No `id` query param — the route reads `id` from searchParams, so the
    // request is rejected.
    expect(res.status).toBe(400);
  });

  it("requires rows and cols in range", async () => {
    const res = await POST(
      localRequest(
        "http://localhost/api/pty-session?id=pty_1&directory=C:/proj",
        jsonBody({ rows: 0, cols: 80 }),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("resizes the PTY", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "pty_1",
        title: "shell",
        command: "pwsh",
        args: [],
        cwd: "C:/proj",
        status: "running",
        pid: 1234,
      }), { status: 200 }),
    );
    const res = await POST(
      localRequest(
        "http://localhost/api/pty-session?id=pty_1&directory=C:/proj",
        jsonBody({ rows: 30, cols: 120 }),
      ),
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(sent.size).toEqual({ rows: 30, cols: 120 });
    expect(fetchMock.mock.calls[0][1]!.method).toBe("PUT");
  });
});
