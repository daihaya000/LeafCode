import { describe, expect, it, vi } from "vitest";
import {
  dropRecentlyReplied,
  rememberReplied,
  wasRecentlyReplied,
} from "./recently-replied";

describe("recently-replied", () => {
  it("remembers and filters replied ids", () => {
    rememberReplied("r-unique-round9");
    expect(wasRecentlyReplied("r-unique-round9")).toBe(true);
    expect(
      dropRecentlyReplied([
        { id: "r-unique-round9" },
        { id: "other" },
      ]).map((r) => r.id),
    ).toEqual(["other"]);
  });

  it("scopes remembered ids by session", () => {
    rememberReplied("same-id", "session-a");
    expect(wasRecentlyReplied("same-id", "session-a")).toBe(true);
    expect(wasRecentlyReplied("same-id", "session-b")).toBe(false);
  });

  it("posts remembered ids to the webui-sync channel", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        name = "webui-sync";
        postMessage = postMessage;
        addEventListener = vi.fn();
      },
    );
    try {
      vi.resetModules();
      const mod = await import("./recently-replied");
      mod.rememberReplied("r-sync-channel");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "recently-replied",
          key: expect.stringContaining("r-sync-channel"),
          at: expect.any(Number),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
