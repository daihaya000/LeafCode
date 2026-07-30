import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock the allowlist + Engine fetch so tests stay unit-level and don't need
// a running OpenCode engine or real filesystem roots.
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(
    (dir: string) => ({ ok: true as const, path: dir }),
  ),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockClear();
});

vi.mock("@/lib/opencode", () => ({
  OPENCODE_BASE_URL: "http://127.0.0.1:4096",
}));

import { DELETE, GET, POST } from "./route";

interface BodyInit {
  method: string;
  body: string;
  headers: Record<string, string>;
}

/** Build a NextRequest that looks like a direct loopback call (host-only). */
function localRequest(url: string, init?: BodyInit): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: { host: "localhost:3000", ...(init?.headers ?? {}) },
  });
}

/** Build a NextRequest that looks like a LAN client (non-loopback Host). */
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

describe("POST /api/pty-session", () => {
  it("rejects non-loopback callers (host-only guard)", async () => {
    const res = await POST(
      lanRequest("http://localhost/api/pty-session", jsonBody({ directory: "C:/proj" })),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("host machine");
  });

  it("rejects command/args/env (arbitrary executable)", async () => {
    const res = await POST(
      localRequest(
        "http://localhost/api/pty-session",
        jsonBody({ directory: "C:/proj", command: "rm" }),
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("command/args/env");
  });

  it("requires a directory", async () => {
    const res = await POST(
      localRequest("http://localhost/api/pty-session", jsonBody({})),
    );
    expect(res.status).toBe(400);
  });

  it("creates a PTY and returns id/title/cwd/status", async () => {
    // POST /pty response
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
    // GET /pty/shells response (acceptable list includes pwsh)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([
        { path: "pwsh", name: "PowerShell", acceptable: true },
      ]), { status: 200 }),
    );
    const res = await POST(
      localRequest(
        "http://localhost/api/pty-session",
        jsonBody({ directory: "C:/proj" }),
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string };
    expect(body.id).toBe("pty_1");
    // Verify the POST body did not include command/args/env
    const postCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST",
    );
    const sent = JSON.parse(postCall![1].body as string);
    expect(sent.command).toBeUndefined();
    expect(sent.cwd).toBeTruthy();
  });
});

describe("GET /api/pty-session", () => {
  it("rejects non-loopback callers (host-only guard)", async () => {
    const res = await GET(
      lanRequest("http://localhost/api/pty-session?directory=C:/proj"),
    );
    expect(res.status).toBe(403);
  });

  it("requires a directory query param", async () => {
    const res = await GET(localRequest("http://localhost/api/pty-session"));
    expect(res.status).toBe(400);
  });

  it("lists PTY sessions", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([
        {
          id: "pty_1",
          title: "shell",
          command: "pwsh",
          args: [],
          cwd: "C:/proj",
          status: "running",
          pid: 1234,
        },
      ]), { status: 200 }),
    );
    const res = await GET(
      localRequest("http://localhost/api/pty-session?directory=C:/proj"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: { id: string }[] };
    expect(body.sessions[0].id).toBe("pty_1");
  });
});

describe("DELETE /api/pty-session", () => {
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
