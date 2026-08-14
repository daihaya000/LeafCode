import { describe, expect, it } from "vitest";
import { gitPathspecError } from "./git-pathspec";

describe("gitPathspecError", () => {
  it("rejects magic and glob pathspecs", () => {
    expect(gitPathspecError(".")).toMatch(/unsafe/);
    expect(gitPathspecError("*")).toMatch(/unsafe/);
    expect(gitPathspecError("src/**")).toMatch(/unsafe/);
    expect(gitPathspecError(":(glob)*")).toMatch(/unsafe/);
    expect(gitPathspecError(":!")).toMatch(/unsafe/);
    expect(gitPathspecError(":^secret.txt")).toMatch(/unsafe/);
    expect(gitPathspecError("a?b")).toMatch(/unsafe/);
  });

  it("rejects WebUI metadata only when asked", () => {
    expect(gitPathspecError(".leafcode/x")).toBeNull();
    expect(gitPathspecError(".leafcode/x", { rejectWebuiMeta: true })).toMatch(
      /excluded/,
    );
  });

  it("still excludes pre-rebrand metadata names", () => {
    expect(
      gitPathspecError(".opencode-webui/sessions.json", { rejectWebuiMeta: true }),
    ).toMatch(/excluded/);
    expect(gitPathspecError(".webui-worktrees/wt1", { rejectWebuiMeta: true })).toMatch(
      /excluded/,
    );
  });

  it("allows ordinary relative paths", () => {
    expect(gitPathspecError("src/app.ts")).toBeNull();
  });

  it("rejects absolute paths so callers can't escape the repo", () => {
    expect(gitPathspecError("/etc/passwd")).toMatch(/unsafe/);
    expect(gitPathspecError("\\Windows\\System32")).toMatch(/unsafe/);
    expect(gitPathspecError("C:\\Users\\x\\secrets.txt")).toMatch(/unsafe/);
    expect(gitPathspecError("C:/Users/x/secrets.txt")).toMatch(/unsafe/);
  });
});
