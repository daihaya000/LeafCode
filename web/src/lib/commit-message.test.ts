import { describe, expect, it } from "vitest";
import { suggestCommitMessage } from "./commit-message";

describe("suggestCommitMessage", () => {
  it("returns empty for no files", () => {
    expect(suggestCommitMessage([])).toBe("");
  });

  it("uses basename for a single tracked file", () => {
    expect(
      suggestCommitMessage([{ path: "web/src/lib/git.ts", untracked: false }]),
    ).toBe("更新 git.ts");
  });

  it("uses Add verb when all files are untracked", () => {
    expect(
      suggestCommitMessage([{ path: "docs/new.md", untracked: true }]),
    ).toBe("追加 new.md");
  });

  it("summarizes multiple files with a common directory", () => {
    expect(
      suggestCommitMessage([
        { path: "web/src/lib/a.ts", untracked: false },
        { path: "web/src/lib/b.ts", untracked: false },
      ]),
    ).toBe("web/src/lib の2ファイルを更新");
  });

  it("summarizes multiple files without a common directory", () => {
    expect(
      suggestCommitMessage([
        { path: "web/a.ts", untracked: false },
        { path: "host/b.js", untracked: false },
      ]),
    ).toBe("2ファイルを更新");
  });

  it("handles Windows backslash-separated paths the same as forward-slash paths", () => {
    expect(
      suggestCommitMessage([{ path: "web\\src\\lib\\git.ts", untracked: false }]),
    ).toBe("更新 git.ts");
    expect(
      suggestCommitMessage([
        { path: "web\\src\\lib\\a.ts", untracked: false },
        { path: "web\\src\\lib\\b.ts", untracked: false },
      ]),
    ).toBe("web/src/lib の2ファイルを更新");
  });
});
