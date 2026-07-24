import { describe, expect, it, vi } from "vitest";

const { ocServer } = vi.hoisted(() => ({ ocServer: vi.fn() }));

vi.mock("@/lib/oc-server", () => ({
  OcError: class OcError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  ocServer,
}));

import { setAgentTaskPermission } from "./opencode-task-permission";

describe("setAgentTaskPermission", () => {
  it("uses the minimal OpenCode config PATCH payload for one registered executor", async () => {
    ocServer.mockResolvedValue([{ name: "build", mode: "primary" }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await setAgentTaskPermission("C:\\repo", "build", "deny");

    expect(ocServer).toHaveBeenCalledWith("C:\\repo", "/agent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:4096/config");
    expect(init).toMatchObject({
      method: "PATCH",
      headers: expect.objectContaining({
        "content-type": "application/json",
        "x-opencode-directory": "C:\\repo",
      }),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      agent: { build: { permission: { task: "deny" } } },
    });
    fetchMock.mockRestore();
  });
});
