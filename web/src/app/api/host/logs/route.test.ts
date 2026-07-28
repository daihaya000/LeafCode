import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

import { GET } from "./route";

function localRequest(url: string) {
  return new NextRequest(url, {
    headers: { host: "127.0.0.1:3000" },
  });
}

function remoteRequest(url: string) {
  return new NextRequest(url, {
    headers: { host: "192.168.1.50:3000" },
  });
}

describe("GET /api/host/logs", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects requests from a non-local host header", async () => {
    const res = await GET(remoteRequest("http://webui.example.com/api/host/logs"));
    expect(res.status).toBe(403);
  });

  it("forwards since as a query param and returns entries/nextSeq", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            { seq: 3, ts: 1, source: "caddy", level: "error", text: "boom" },
          ],
          nextSeq: 3,
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await GET(
      localRequest("http://127.0.0.1:3000/api/host/logs?since=2"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18765/logs?since=2",
      expect.anything(),
    );
    const body = (await res.json()) as { entries: unknown[]; nextSeq: number };
    expect(res.status).toBe(200);
    expect(body.nextSeq).toBe(3);
    expect(body.entries).toHaveLength(1);
  });

  it("omits since when absent from the query string", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ entries: [], nextSeq: 0 }), { status: 200 }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(localRequest("http://127.0.0.1:3000/api/host/logs"));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18765/logs",
      expect.anything(),
    );
  });

  it("returns 502 with a Japanese hint when the host control is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await GET(localRequest("http://127.0.0.1:3000/api/host/logs"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toContain("ホストログを取得できません");
    expect(body.hint).toContain("start-webui.bat");
  });

  it("returns 502 when the host control responds with a non-ok status", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch;

    const res = await GET(localRequest("http://127.0.0.1:3000/api/host/logs"));
    expect(res.status).toBe(502);
  });
});
