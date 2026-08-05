import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveHostControlUrl } = vi.hoisted(() => ({
  resolveHostControlUrl: vi.fn(() => "http://127.0.0.1:18765"),
}));

vi.mock("@/lib/host-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host-control")>();
  return { ...actual, resolveHostControlUrl };
});

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
    headers: { host: "192.168.1.50:3000" },
  });
}

describe("POST /api/host/allow-firewall", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostControlUrl.mockReturnValue("http://127.0.0.1:18765");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects requests from a non-local host header", async () => {
    const res = await POST(
      remoteRequest("http://webui.example.com/api/host/allow-firewall"),
    );
    expect(res.status).toBe(403);
  });

  it("forwards to the host control plane and returns the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, target: "allow-firewall", alreadyExists: false, port: 3000 }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/host/allow-firewall"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18765/allow-firewall",
      expect.anything(),
    );
    const body = (await res.json()) as { ok: boolean; alreadyExists: boolean; port: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.alreadyExists).toBe(false);
    expect(body.port).toBe(3000);
  });

  it("returns 502 when the host control is unreachable", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/host/allow-firewall"),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toContain("ホスト制御に接続できません");
    expect(body.hint).toContain("start-webui.bat");
  });

  it("returns 502 with the host's error message (e.g. UAC cancelled) on failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "UAC cancelled" }), {
        status: 500,
      }),
    ) as unknown as typeof fetch;

    const res = await POST(
      localRequest("http://127.0.0.1:3000/api/host/allow-firewall"),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("UAC cancelled");
  });
});
