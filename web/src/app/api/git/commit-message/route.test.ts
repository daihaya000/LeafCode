import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSetting, ocServer } = vi.hoisted(() => ({
  getSetting: vi.fn(),
  ocServer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSetting,
  listAllowedRoots: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn().mockReturnValue({ ok: true, path: "/repo" }),
}));
vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error { status = 502; },
  ocServer,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/git/commit-message", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/git/commit-message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSetting.mockReset();
    ocServer.mockReset();
  });

  it("generates with the configured model and disables all tools", async () => {
    getSetting.mockReturnValue("openai::gpt-5");
    ocServer
      .mockResolvedValueOnce({ id: "temp-1" })
      .mockResolvedValueOnce(["bash", "read"])
      .mockResolvedValueOnce({ parts: [{ type: "text", text: "変更を反映" }] })
      .mockResolvedValueOnce(true);

    const response = await POST(request({
      directory: "/repo",
      files: [{ path: "src/a.ts", additions: 2, deletions: 1, hunks: [] }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "変更を反映" });
    expect(ocServer.mock.calls[2]?.[2]?.body).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5" },
      tools: { bash: false, read: false },
    });
  });

  it("requires a configured generation model", async () => {
    getSetting.mockReturnValue(null);
    const response = await POST(request({ directory: "/repo", files: [{ path: "a.ts" }] }));
    expect(response.status).toBe(409);
    expect(ocServer).not.toHaveBeenCalled();
  });
});
