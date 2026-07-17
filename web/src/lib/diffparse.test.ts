import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, untrackedHunk } from "./diffparse";

describe("parseUnifiedDiff", () => {
  it("returns empty for blank input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n")).toEqual([]);
  });

  it("parses a modified file with additions and deletions", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 111..222 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,3 @@",
      " context",
      "-old line",
      "+new line",
    ].join("\n");
    const [file] = parseUnifiedDiff(diff);
    expect(file.path).toBe("src/foo.ts");
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
    expect(file.binary).toBe(false);
    expect(file.hunks).toHaveLength(1);
  });

  it("parses a new file (--- /dev/null)", () => {
    const diff = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "index 000..111",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1,2 @@",
      "+line1",
      "+line2",
    ].join("\n");
    const [file] = parseUnifiedDiff(diff);
    expect(file.path).toBe("new.txt");
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
  });

  it("flags binary files", () => {
    const diff = [
      "diff --git a/img.png b/img.png",
      "new file mode 100644",
      "index 000..111",
      "Binary files /dev/null and b/img.png differ",
    ].join("\n");
    const [file] = parseUnifiedDiff(diff);
    expect(file.path).toBe("img.png");
    expect(file.binary).toBe(true);
    expect(file.hunks).toHaveLength(0);
  });

  it("detects renames via old/new header paths", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
    ].join("\n");
    const [file] = parseUnifiedDiff(diff);
    expect(file.path).toBe("new.ts");
    expect(file.oldPath).toBe("old.ts");
  });

  it("treats ---/+++ inside a hunk as content, not headers", () => {
    // A deleted line whose content is `-- old` shows up as `--- old`, and an
    // added line `++ new` as `+++ new`. These must count as deletion/addition
    // and must not overwrite the file path.
    const diff = [
      "diff --git a/f.sql b/f.sql",
      "index 111..222 100644",
      "--- a/f.sql",
      "+++ b/f.sql",
      "@@ -1,2 +1,2 @@",
      " keep",
      "--- old comment",
      "+++ new comment",
    ].join("\n");
    const [file] = parseUnifiedDiff(diff);
    expect(file.path).toBe("f.sql");
    expect(file.deletions).toBe(1);
    expect(file.additions).toBe(1);
    const texts = file.hunks[0].lines.map((l) => `${l.t}${l.text}`);
    expect(texts).toContain("--- old comment");
    expect(texts).toContain("+++ new comment");
  });

  it("parses multiple files", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "+a",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1 +1 @@",
      "+b",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("untrackedHunk", () => {
  it("marks every line as added", () => {
    const hunk = untrackedHunk("l1\nl2\nl3");
    expect(hunk.lines).toHaveLength(3);
    expect(hunk.lines.every((l) => l.t === "+")).toBe(true);
    expect(hunk.header).toBe("@@ -0,0 +1,3 @@");
  });

  it("does not emit a phantom line for content ending in a newline", () => {
    const hunk = untrackedHunk("a\nb\n");
    expect(hunk.lines).toHaveLength(2);
    expect(hunk.lines.map((l) => l.text)).toEqual(["a", "b"]);
    expect(hunk.header).toBe("@@ -0,0 +1,2 @@");
  });

  it("truncates beyond maxLines and appends a summary line", () => {
    const content = ["a", "b", "c", "d", "e"].join("\n");
    const hunk = untrackedHunk(content, 2);
    expect(hunk.lines).toHaveLength(3); // 2 shown + summary
    expect(hunk.lines[2].t).toBe(" ");
    expect(hunk.lines[2].text).toContain("3 more lines");
  });
});
