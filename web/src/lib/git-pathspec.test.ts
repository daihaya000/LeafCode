import { describe, expect, it } from "vitest";
import { gitPathspecError } from "./git-pathspec";

describe("gitPathspecError", () => {
  it("rejects magic and glob pathspecs", () => {
    expect(gitPathspecError(".")).toMatch(/unsafe/);
    expect(gitPathspecError("*")).toMatch(/unsafe/);
    expect(gitPathspecError("src/**")).toMatch(/unsafe/);
    expect(gitPathspecError(":(glob)*")).toMatch(/unsafe/);
    expect(gitPathspecError("a?b")).toMatch(/unsafe/);
  });

  it("rejects WebUI metadata only when asked", () => {
    expect(gitPathspecError(".opencode-webui/x")).toBeNull();
    expect(gitPathspecError(".opencode-webui/x", { rejectWebuiMeta: true })).toMatch(
      /excluded/,
    );
  });

  it("allows ordinary relative paths", () => {
    expect(gitPathspecError("src/app.ts")).toBeNull();
  });
});
