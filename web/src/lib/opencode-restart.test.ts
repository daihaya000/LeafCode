import { beforeEach, describe, expect, it, vi } from "vitest";

const { getJson, timedFetch } = vi.hoisted(() => ({
  getJson: vi.fn(),
  timedFetch: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ getJson, timedFetch }));

import { restartOpencodeAndWait } from "./opencode-restart";

describe("restartOpencodeAndWait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests an OpenCode restart and waits for health", async () => {
    timedFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    getJson.mockResolvedValue({ opencode: { ok: true } });

    await restartOpencodeAndWait();

    expect(timedFetch).toHaveBeenCalledWith(
      "/api/host/restart",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ target: "opencode" }) }),
    );
    expect(getJson).toHaveBeenCalledWith("/api/health", undefined, { timeoutMs: 1500 });
  });

  it("reports a host-control error", async () => {
    timedFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "host down", hint: "start host" }), {
        status: 502,
      }),
    );

    await expect(restartOpencodeAndWait()).rejects.toThrow("host down — start host");
    expect(getJson).not.toHaveBeenCalled();
  });
});
