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
});
