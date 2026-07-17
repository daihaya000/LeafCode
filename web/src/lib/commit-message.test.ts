import { describe, expect, it } from "vitest";
import { suggestCommitMessage } from "./commit-message";

describe("suggestCommitMessage", () => {
  it("returns empty for no files", () => {
    expect(suggestCommitMessage([])).toBe("");
  });

  it("uses basename for a single tracked file", () => {
    expect(
      suggestCommitMessage([{ path: "web/src/lib/git.ts", untracked: false }]),
    ).toBe("Update git.ts");
  });

  it("uses Add verb when all files are untracked", () => {
    expect(
      suggestCommitMessage([{ path: "docs/new.md", untracked: true }]),
    ).toBe("Add new.md");
  });

  it("summarizes multiple files with a common directory", () => {
    expect(
      suggestCommitMessage([
        { path: "web/src/lib/a.ts", untracked: false },
        { path: "web/src/lib/b.ts", untracked: false },
      ]),
    ).toBe("Update 2 files in web/src/lib");
  });

  it("summarizes multiple files without a common directory", () => {
    expect(
      suggestCommitMessage([
        { path: "web/a.ts", untracked: false },
        { path: "host/b.js", untracked: false },
      ]),
    ).toBe("Update 2 files");
  });
});
