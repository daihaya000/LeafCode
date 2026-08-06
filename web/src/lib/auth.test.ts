import { afterEach, describe, expect, it, vi } from "vitest";
import { login } from "./auth";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("login", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the username on success", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ok: true, username: "alice" })),
    );

    await expect(login("alice", "secret")).resolves.toEqual({ ok: true });
  });

  it("maps 401 to the invalid-credentials message", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { ok: false, error: "invalid credentials" })),
    );

    await expect(login("alice", "wrong")).resolves.toEqual({
      ok: false,
      error: "ユーザー名またはパスワードが違います",
    });
  });

  it("forwards the server throttle message on 429", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(429, {
          ok: false,
          error: "試行回数が多すぎます。42 秒後に再試行してください",
          retryAfterSeconds: 42,
        }),
      ),
    );

    await expect(login("alice", "wrong")).resolves.toEqual({
      ok: false,
      error: "試行回数が多すぎます。42 秒後に再試行してください",
    });
  });

  it("falls back to a generic message for other failures", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:3000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(502, { ok: false, error: "host unreachable" })),
    );

    await expect(login("alice", "secret")).resolves.toEqual({
      ok: false,
      error: "通信エラーが発生しました",
    });
  });
});
