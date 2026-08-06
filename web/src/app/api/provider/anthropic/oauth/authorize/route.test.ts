import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ocServer: vi.fn() }));

vi.mock("@/lib/oc-server", () => ({
  ocServer: h.ocServer,
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/opencode", () => ({ OPENCODE_BASE_URL: "http://127.0.0.1:4096" }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/provider/anthropic/oauth/authorize", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue({ anthropic: [{ type: "oauth" }, { type: "api" }] });
});

describe("POST /api/provider/anthropic/oauth/authorize", () => {
  it("starts the native Claude OAuth flow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://claude.ai/oauth/authorize?state=test", method: "auto" }), { status: 200 }),
    );

    const response = await POST(request({ method: 0 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ method: "auto" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:4096/provider/anthropic/oauth/authorize",
    );
    fetchMock.mockRestore();
  });

  it("rejects a non-OAuth method", async () => {
    const response = await POST(request({ method: 1 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Claude のOAuth認証方式が見つかりません" });
  });

  it("rejects an authorization URL outside Anthropic domains", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://evil.example.test/auth", method: "auto" }), { status: 200 }),
    );
    const response = await POST(request({ method: 0 }));
    expect(response.status).toBe(502);
    vi.restoreAllMocks();
  });
});
