import { describe, expect, it } from "vitest";
import { tintCodeLine } from "./difftint";

describe("tintCodeLine", () => {
  it("escapes html", () => {
    const out = tintCodeLine("<script>", "a.txt");
    expect(out).toContain("&lt;script&gt;");
  });

  it("highlights keywords in ts", () => {
    const out = tintCodeLine("const x = 1", "a.ts");
    expect(out).toContain("text-accent");
    expect(out).toContain("const");
  });

  it("does not corrupt its own markup on lines with strings/comments", () => {
    const out = tintCodeLine('const x = "hi" // note', "a.ts");
    // Regression: KEYWORDS includes `class`, which used to re-match the class
    // attribute of an already-inserted span and emit broken `<span <span …>`.
    expect(out).not.toContain("<span <span");
    expect(out).not.toMatch(/class="[^"]*<span/);
    expect(out).toContain("text-accent"); // const
    expect(out).toContain("text-success"); // "hi"
    expect(out).toContain("text-faint"); // // note
  });

  // R15#3: Single quotes should be highlighted as strings
  it("highlights single-quoted strings", () => {
    const out = tintCodeLine("const x = 'hello'", "a.ts");
    expect(out).toContain("text-success");
    expect(out).toContain("&#39;hello&#39;");
  });
});
