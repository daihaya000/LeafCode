import { describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";

vi.mock("@/lib/opencode", () => ({ OPENCODE_BASE_URL: "http://127.0.0.1:4096" }));

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/provider/cursor-acp/auth", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Cursor ACP auth API", () => {
  it("stores an API key through OpenCode's native auth endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("true", { status: 200 }));
    const response = await POST(request("POST", { key: "cursor-secret" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, requiresRestart: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:4096/auth/cursor-acp");
    expect(init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ type: "api", key: "cursor-secret" }),
    });
    vi.restoreAllMocks();
  });

  it("rejects a missing API key", async () => {
    const response = await POST(request("POST", { key: "" }));
    expect(response.status).toBe(400);
  });

  it("removes native Cursor credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("true", { status: 200 }));
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, requiresRestart: true });
    vi.restoreAllMocks();
  });
});
