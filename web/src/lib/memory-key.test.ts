import { describe, expect, it } from "vitest";

import {
  MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS,
  MEMORY_SIMILARITY_SAME_IDENTIFIERS,
  memoryIdentifiers,
  memoryPolarity,
  memorySimilarityVerdict,
  memoryTrigrams,
  normalizeMemoryKey,
  trigramSimilarity,
} from "./memory-key";

describe("normalizeMemoryKey", () => {
  it("collapses width, case, spacing and punctuation differences", () => {
    expect(normalizeMemoryKey("Use PNPM, not npm.")).toBe(
      normalizeMemoryKey("ｕｓｅ　pnpm not NPM"),
    );
  });

  it("collapses affirmative polite forms of one proposition", () => {
    expect(normalizeMemoryKey("bat は CRLF で保存する")).toBe(
      normalizeMemoryKey("bat は CRLF で保存します"),
    );
  });

  it("keeps negation distinguishable from the affirmative form", () => {
    expect(normalizeMemoryKey("MEMORY.md はコミットしない")).not.toBe(
      normalizeMemoryKey("MEMORY.md はコミットする"),
    );
  });

  it("returns an empty key for content with no comparable characters", () => {
    expect(normalizeMemoryKey("---   ...")).toBe("");
    expect(normalizeMemoryKey(undefined as unknown as string)).toBe("");
  });
});

describe("memoryPolarity", () => {
  it.each([
    ["MEMORY.md はコミットしない", "negative"],
    ["bat に非 ASCII を書いてはいけない", "negative"],
    ["この値は変更されません", "negative"],
    ["テストをスキップしないでください", "negative"],
    ["MEMORY.md はコミットする", "affirmative"],
    ["bat は CRLF で保存します", "affirmative"],
    ["テストはスキップしてください", "affirmative"],
  ])("classifies %s", (content, expected) => {
    expect(memoryPolarity(content)).toBe(expected);
  });
});

describe("memoryIdentifiers", () => {
  it("extracts file names, commands and config keys", () => {
    const ids = memoryIdentifiers("プロジェクト直下の MEMORY.md は .gitignore 対象で Git 追跡しない");
    expect([...ids]).toContain("memory.md");
    expect([...ids]).toContain("gitignore");
    expect([...ids]).toContain("git");
  });

  it("drops bare numbers and single characters", () => {
    const ids = memoryIdentifiers("上限は 200000 で a も無視する");
    expect(ids.has("200000")).toBe(false);
    expect(ids.has("a")).toBe(false);
  });
});

describe("memoryTrigrams / trigramSimilarity", () => {
  it("maps short strings to a single gram", () => {
    expect([...memoryTrigrams("ab")]).toEqual(["ab"]);
  });

  it("scores identical propositions at 1 and unrelated ones near 0", () => {
    expect(trigramSimilarity("同じ内容です", "同じ内容です")).toBe(1);
    expect(trigramSimilarity("npm run test", "git push origin main")).toBeLessThan(0.2);
  });
});

describe("memorySimilarityVerdict", () => {
  it("never merges a rule with its negation", () => {
    const verdict = memorySimilarityVerdict(
      "MEMORY.md はコミットしない。",
      "MEMORY.md はコミットする。",
    );
    expect(verdict.duplicate).toBe(false);
    expect(verdict.reason).toBe("opposite-polarity");
  });

  it("never merges しないでください with してください (negative polite imperative)", () => {
    const verdict = memorySimilarityVerdict(
      "テストをスキップしないでください",
      "テストはスキップしてください",
    );
    expect(verdict.duplicate).toBe(false);
    expect(verdict.reason).toBe("opposite-polarity");
  });

  it("merges paraphrases about the same identifiers", () => {
    const verdict = memorySimilarityVerdict(
      "プロジェクト直下の MEMORY.md はローカル専用として .gitignore に含め、Git で追跡しない。",
      "プロジェクト直下の MEMORY.md はローカル専用として .gitignore 対象にし、コミットしない。",
    );
    expect(verdict.duplicate).toBe(true);
    expect(verdict.reason).toBe("same-identifiers");
    expect(verdict.threshold).toBe(MEMORY_SIMILARITY_SAME_IDENTIFIERS);
  });

  it("keeps propositions about different files apart despite near-identical prose", () => {
    const verdict = memorySimilarityVerdict(
      "プロジェクト直下の MEMORY.md はローカル専用として .gitignore に含め、Git で追跡しない。",
      "プロジェクト直下の LESSONS.md はローカル専用として .gitignore に含め、Git で追跡しない。",
    );
    expect(verdict.duplicate).toBe(false);
    expect(verdict.reason).toBe("different-identifiers");
    expect(verdict.threshold).toBe(MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS);
  });

  it("merges formatting-only rewrites through the canonical key", () => {
    const verdict = memorySimilarityVerdict(
      "bat は CRLF で保存する",
      "ｂａｔ は CRLF で保存します。",
    );
    expect(verdict.duplicate).toBe(true);
    expect(verdict.reason).toBe("norm-key");
  });

  it("keeps distinct rules about the same subject apart", () => {
    const verdict = memorySimilarityVerdict(
      "bat ファイルの改行は CRLF、BOM なしにする。",
      "bat ファイルの検証は npm run test:encoding で行う。",
    );
    expect(verdict.duplicate).toBe(false);
  });

  it("requires high similarity for pure prose without identifiers", () => {
    const verdict = memorySimilarityVerdict(
      "抽出は差分のみを対象にする。",
      "注入は初回のみ行う。",
    );
    expect(verdict.reason).toBe("no-identifiers");
    expect(verdict.duplicate).toBe(false);
  });

  it("rejects candidates whose length is wildly different", () => {
    const verdict = memorySimilarityVerdict(
      "MEMORY.md は .gitignore 対象。",
      `MEMORY.md は .gitignore 対象であり${"、詳細な補足説明".repeat(20)}`,
    );
    expect(verdict.duplicate).toBe(false);
    expect(verdict.similarity).toBe(0);
  });
});
