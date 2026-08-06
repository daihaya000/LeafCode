import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(
    (dir: string) => ({ ok: true as const, path: dir }),
  ),
}));

const getRelayMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pty-relay", () => ({
  getRelay: getRelayMock,
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

const URL = "http://localhost/api/pty-session/input?id=pty_1&directory=C:/proj";

describe("POST /api/pty-session/input", () => {
  beforeEach(() => {
    getRelayMock.mockReset();
  });

  it("rejects non-loopback callers (host-only guard)", async () => {
    const res = await POST(lanRequest(URL, jsonBody({ data: "ls\n" })));
    expect(res.status).toBe(403);
  });

  it("requires a string data field", async () => {
    const res = await POST(localRequest(URL, jsonBody({ data: 123 })));
    expect(res.status).toBe(400);
  });

  it("rejects input when no stream relay exists", async () => {
    getRelayMock.mockReturnValue(undefined);
    const res = await POST(localRequest(URL, jsonBody({ data: "ls\n" })));
    expect(res.status).toBe(409);
  });

  it("rejects payloads whose UTF-8 bytes exceed the limit even under the char limit", async () => {
    getRelayMock.mockReturnValue({ ws: { send: vi.fn() } });
    // 22k chars is below the 64k char count, but each character encodes to
    // 3 UTF-8 bytes (66 KB total).
    const payload = "あ".repeat(22_000);
    const res = await POST(localRequest(URL, jsonBody({ data: payload })));
    expect(res.status).toBe(413);
  });

  it("forwards input to the relay socket", async () => {
    const send = vi.fn();
    getRelayMock.mockReturnValue({ ws: { send } });
    const res = await POST(localRequest(URL, jsonBody({ data: "ls\n" })));
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith("ls\n");
  });
});
