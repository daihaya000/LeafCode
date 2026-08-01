import { describe, expect, it } from "vitest";
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
});
