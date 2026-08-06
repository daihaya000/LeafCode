import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ocServer: vi.fn(),
}));

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

vi.mock("@/lib/opencode", () => ({
  OPENCODE_BASE_URL: "http://127.0.0.1:4096",
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/provider/openai/oauth/authorize", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.ocServer.mockReset();
  h.ocServer.mockResolvedValue({
    openai: [
      { type: "oauth", label: "ChatGPT Pro/Plus (browser)" },
      { type: "oauth", label: "ChatGPT Pro/Plus (headless)" },
      { type: "api", label: "Manually enter API Key" },
    ],
  });
});

describe("POST /api/provider/openai/oauth/authorize", () => {
  it("starts only the OpenAI browser OAuth flow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://auth.openai.com/oauth/authorize?state=test",
          method: "auto",
          instructions: "Complete authorization in your browser.",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await POST(request({ method: 0 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: "https://auth.openai.com/oauth/authorize?state=test",
      method: "auto",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:4096/provider/openai/oauth/authorize",
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ method: 0 }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("rejects non-browser authentication methods", async () => {
    const response = await POST(request({ method: 1 }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "OpenAI のブラウザ認証方式が見つかりません",
    });
  });

  it("rejects an invalid request body", async () => {
    const response = await POST(request({ method: "0" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "認証方式を指定してください",
    });
  });
});
