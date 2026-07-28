import { describe, expect, it } from "vitest";
import {
  AUTO_MODEL_VALUE,
  chooseAutoModel,
  classifyPrompt,
  modelCostTier,
  type AutoCandidateProvider,
} from "./auto-model";
import { modelIntelligenceScore } from "./model-options";

describe("AUTO_MODEL_VALUE", () => {
  it("contains no '::' so it cannot collide with provider::model values", () => {
    expect(AUTO_MODEL_VALUE).toBe("auto");
    expect(AUTO_MODEL_VALUE).not.toContain("::");
  });
});

describe("classifyPrompt boundaries", () => {
  const question = (length: number) =>
    `なぜ${"あ".repeat(Math.max(0, length - 2))}`;

  it("treats a 199-char question as light", () => {
    const prompt = question(199);
    expect(prompt).toHaveLength(199);
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("light");
  });

  it("treats a 200-char question as standard (length < 200 fails)", () => {
    const prompt = question(200);
    expect(prompt).toHaveLength(200);
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("treats 1500 chars as standard (length > 1500 fails)", () => {
    const prompt = "あ".repeat(1500);
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("treats 1501 chars as heavy", () => {
    const prompt = "あ".repeat(1501);
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("measures length after trimming", () => {
    const prompt = `   ${"あ".repeat(1500)}   `;
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });
});

describe("classifyPrompt code fences", () => {
  it("does not escalate to heavy for a single fenced block", () => {
    const prompt = "この値を見て\n```\nconst a = 1;\n```";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("escalates to heavy for two fenced blocks", () => {
    const prompt =
      "before\n```\nconst a = 1;\n```\nafter\n```\nconst b = 2;\n```";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("keeps a short question out of light when it contains a code fence", () => {
    const prompt = "これは何が問題ですか\n```\nconst a = 1;\n```";
    expect(prompt.length).toBeLessThan(200);
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });
});

describe("classifyPrompt keyword rules", () => {
  it.each([
    ["リファクタしてほしい"],
    ["この設計を再設計する"],
    ["ゼロから作り直す"],
    ["Next.js へ移行する"],
    ["DB マイグレを流す"],
    ["アーキテクチャを見直す"],
    ["全面的に見直す"],
    ["全体的に整える"],
    ["複数ファイルにまたがる"],
    ["モジュール横断の対応"],
    ["パフォーマンス改善をする"],
    ["クエリの最適化"],
    ["デッドロックの原因"],
    ["競合状態が起きている"],
    ["please refactor this module"],
    ["redesign the schema"],
    ["migrate to the new API"],
    ["architect a new pipeline"],
    ["a multi-file change"],
    ["a multifile change"],
    ["cross-cutting concern"],
    ["crosscutting concern"],
    ["there is a deadlock"],
    ["fix the race condition"],
    ["optimize the loop"],
    ["optimise the loop"],
  ])("classifies heavy keyword prompt as heavy: %s", (prompt) => {
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("does not classify a question mixed with a work instruction as light", () => {
    expect(classifyPrompt("なぜ壊れるか調べて修正して", { hasImages: false })).toBe(
      "standard",
    );
  });

  it.each([
    ["なぜこうなるの"],
    ["何が起きているの"],
    ["どこにあるの"],
    ["どうやって動くの"],
    ["どういう仕組み"],
    ["ここでいう workspace とは"],
    ["この関数の役割を教えて"],
    ["この処理の説明"],
    ["この変数の意味"],
    ["why is this slow"],
    ["what is this file"],
    ["where is the entry point"],
    ["how does this run"],
    ["explain this function"],
    ["what does this mean"],
  ])("classifies a short question as light: %s", (prompt) => {
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("light");
  });

  it.each([
    ["この関数を実装して"],
    ["バグを修正して"],
    ["ログを追加して"],
    ["ファイルを作成して"],
    ["設定を変更して"],
    ["ここに書いて"],
    ["これを直して"],
    ["この行を消して"],
    ["この関数を削除して"],
    ["テスト書いて"],
    ["fix the typo"],
    ["implement the handler"],
    ["add a log line"],
    ["create the file"],
    ["write a helper"],
    ["update the config"],
    ["delete the branch"],
    ["remove the flag"],
  ])("classifies a short work instruction as standard: %s", (prompt) => {
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("classifies an empty prompt as standard", () => {
    expect(classifyPrompt("", { hasImages: false })).toBe("standard");
  });

  it("classifies a whitespace-only prompt as standard", () => {
    expect(classifyPrompt("   \n\t ", { hasImages: false })).toBe("standard");
  });

  it("keeps the tier unchanged when images are attached", () => {
    expect(classifyPrompt("これは何が写っているの", { hasImages: true })).toBe(
      "light",
    );
    expect(classifyPrompt("リファクタして", { hasImages: true })).toBe("heavy");
    expect(classifyPrompt("ここを修正して", { hasImages: true })).toBe(
      "standard",
    );
  });
});

describe("modelCostTier", () => {
  it.each([
    "gemini-2.0-flash",
    "gpt-5.6-luna-mini",
    "gpt-nano",
    "llama-lite",
    "claude-haiku-4-5",
    "grok-fast",
  ])("classifies %s as cheap", (modelID) => {
    expect(modelCostTier(modelID)).toBe("cheap");
  });

  it.each(["claude-fable-1", "claude-opus-5", "grok-ultra", "gpt-5.6-sol"])(
    "classifies %s as premium",
    (modelID) => {
      expect(modelCostTier(modelID)).toBe("premium");
    },
  );

  it.each(["claude-sonnet-5", "deepseek-v4", "gpt-5.6-terra", "glm-5"])(
    "classifies %s as mid",
    (modelID) => {
      expect(modelCostTier(modelID)).toBe("mid");
    },
  );

  it("normalizes underscores to hyphens before matching", () => {
    expect(modelCostTier("claude_haiku_4_5")).toBe("cheap");
    expect(modelCostTier("gpt_5_6_sol")).toBe("premium");
    expect(modelCostTier("grok_fast")).toBe("cheap");
  });

  it("is case insensitive", () => {
    expect(modelCostTier("Claude-OPUS-5")).toBe("premium");
    expect(modelCostTier("GPT-5-MINI")).toBe("cheap");
  });
});

/** Provider fixture helper. */
function provider(
  id: string,
  models: AutoCandidateProvider["models"],
): AutoCandidateProvider {
  return { id, models };
}

const CHEAP_MODEL = "claude-haiku-4-5";
const MID_MODEL = "claude-sonnet-5";
const PREMIUM_MODEL = "claude-opus-5";

const allVariants = {
  none: {},
  minimal: {},
  low: {},
  medium: {},
  high: {},
  max: {},
};

/** alpha: cheap + mid, beta: premium. All declare every known variant. */
function threeTierProviders(): AutoCandidateProvider[] {
  return [
    provider("alpha", {
      [CHEAP_MODEL]: { variants: { ...allVariants } },
      [MID_MODEL]: { variants: { ...allVariants } },
    }),
    provider("beta", {
      [PREMIUM_MODEL]: { variants: { ...allVariants } },
    }),
  ];
}

function choose(
  overrides: Partial<Parameters<typeof chooseAutoModel>[0]> = {},
) {
  return chooseAutoModel({
    providers: threeTierProviders(),
    connected: [],
    disabled: {},
    tier: "standard",
    hasImages: false,
    ...overrides,
  });
}

describe("chooseAutoModel score assumptions", () => {
  it("orders the fixture models premium > mid > cheap", () => {
    expect(modelIntelligenceScore(PREMIUM_MODEL)).toBeGreaterThan(
      modelIntelligenceScore(MID_MODEL),
    );
    expect(modelIntelligenceScore(MID_MODEL)).toBeGreaterThan(
      modelIntelligenceScore(CHEAP_MODEL),
    );
  });
});

describe("chooseAutoModel candidate filtering", () => {
  it("allows every provider when connected is empty", () => {
    expect(choose({ tier: "light" })).toMatchObject({
      providerID: "alpha",
      modelID: CHEAP_MODEL,
    });
  });

  it("restricts to connected providers when the list is non-empty", () => {
    const decision = choose({ tier: "light", connected: ["beta"] });
    expect(decision).toMatchObject({
      providerID: "beta",
      modelID: PREMIUM_MODEL,
    });
  });

  it("excludes a provider disabled at provider level", () => {
    const decision = choose({ tier: "heavy", disabled: { beta: true } });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("excludes a model disabled at model level", () => {
    const decision = choose({
      tier: "light",
      disabled: { [`alpha::${CHEAP_MODEL}`]: true },
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("keeps only image-capable models when hasImages is true", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: {},
          [MID_MODEL]: { capabilities: { input: { image: true } } },
        }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("accepts attachment capability as image support", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { capabilities: { attachment: true } },
        }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision).toMatchObject({ modelID: CHEAP_MODEL });
  });

  it("returns null when no model supports images", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { capabilities: { input: { image: false } } },
          [MID_MODEL]: {},
        }),
      ],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: true,
    });
    expect(decision).toBeNull();
  });

  it("returns null when every candidate is filtered out", () => {
    expect(choose({ connected: ["gamma"] })).toBeNull();
    expect(choose({ disabled: { alpha: true, beta: true } })).toBeNull();
    expect(chooseAutoModel({
      providers: [],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    })).toBeNull();
  });
});

describe("chooseAutoModel tier selection", () => {
  it("light picks the highest scoring cheap model", () => {
    expect(choose({ tier: "light" })).toMatchObject({
      providerID: "alpha",
      modelID: CHEAP_MODEL,
      tier: "light",
    });
  });

  it("standard picks the highest scoring mid model", () => {
    expect(choose({ tier: "standard" })).toMatchObject({
      providerID: "alpha",
      modelID: MID_MODEL,
      tier: "standard",
    });
  });

  it("heavy picks the highest scoring model overall", () => {
    expect(choose({ tier: "heavy" })).toMatchObject({
      providerID: "beta",
      modelID: PREMIUM_MODEL,
      tier: "heavy",
    });
  });

  it("light falls back to mid when no cheap model exists", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", { [MID_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: {} }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("light falls back to premium when neither cheap nor mid exists", () => {
    const decision = chooseAutoModel({
      providers: [provider("beta", { [PREMIUM_MODEL]: {} })],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: PREMIUM_MODEL });
  });

  it("standard falls back to cheap before premium", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: {} }),
      ],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: CHEAP_MODEL });
  });

  it("standard falls back to premium when neither mid nor cheap exists", () => {
    const decision = chooseAutoModel({
      providers: [provider("beta", { [PREMIUM_MODEL]: {} })],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: PREMIUM_MODEL });
  });

  it("breaks score ties by providerID::modelID lexical order", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("zeta", { [MID_MODEL]: {} }),
        provider("alpha", { [MID_MODEL]: {} }),
      ],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("is deterministic regardless of provider iteration order", () => {
    const a = chooseAutoModel({
      providers: [
        provider("alpha", { [MID_MODEL]: {} }),
        provider("zeta", { [MID_MODEL]: {} }),
      ],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    const b = chooseAutoModel({
      providers: [
        provider("zeta", { [MID_MODEL]: {} }),
        provider("alpha", { [MID_MODEL]: {} }),
      ],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(a).toEqual(b);
  });
});

describe("chooseAutoModel variant selection", () => {
  function variantFor(
    tier: "light" | "standard" | "heavy",
    variants: Record<string, { disabled?: boolean } | undefined> | undefined,
  ) {
    return chooseAutoModel({
      providers: [provider("alpha", { [MID_MODEL]: { variants } })],
      connected: [],
      disabled: {},
      tier,
      hasImages: false,
    })?.variant;
  }

  it("light prefers minimal, then none, then low", () => {
    expect(variantFor("light", { ...allVariants })).toBe("minimal");
    expect(variantFor("light", { none: {}, low: {}, medium: {} })).toBe("none");
    expect(variantFor("light", { low: {}, medium: {}, high: {} })).toBe("low");
  });

  it("standard prefers low, then minimal, then none, then medium", () => {
    expect(variantFor("standard", { ...allVariants })).toBe("low");
    expect(variantFor("standard", { minimal: {}, none: {}, medium: {} })).toBe(
      "minimal",
    );
    expect(variantFor("standard", { none: {}, medium: {} })).toBe("none");
    expect(variantFor("standard", { medium: {}, high: {} })).toBe("medium");
  });

  it("heavy prefers medium, then high, then low", () => {
    expect(variantFor("heavy", { ...allVariants })).toBe("medium");
    expect(variantFor("heavy", { high: {}, max: {}, low: {} })).toBe("high");
    expect(variantFor("heavy", { low: {} })).toBe("low");
  });

  it("returns an empty variant when the model declares none", () => {
    expect(variantFor("standard", undefined)).toBe("");
    expect(variantFor("standard", {})).toBe("");
  });

  it("returns an empty variant when only out-of-order efforts exist (light + high only)", () => {
    // `high` is absent from the light preference list, so no variant is sent
    // and OpenCode applies the model default.
    expect(variantFor("light", { high: {} })).toBe("");
  });

  it("ignores disabled variants", () => {
    expect(variantFor("light", { minimal: { disabled: true }, none: {} })).toBe(
      "none",
    );
    expect(variantFor("heavy", { medium: { disabled: true }, high: {} })).toBe(
      "high",
    );
  });

  it("ignores unknown variant keys", () => {
    expect(variantFor("standard", { turbo: {}, low: {} })).toBe("low");
  });
});

describe("chooseAutoModel escalation", () => {
  it("targets the strongest candidate at the highest available effort", () => {
    const decision = choose({ tier: "light" });
    expect(decision?.escalation).toEqual({
      providerID: "beta",
      modelID: PREMIUM_MODEL,
      variant: "high",
    });
  });

  it("falls back to max then medium then empty for the escalation variant", () => {
    const withMax = chooseAutoModel({
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { max: {}, medium: {} } } }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(withMax?.escalation?.variant).toBe("max");

    const withMedium = chooseAutoModel({
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { medium: {}, low: {} } } }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(withMedium?.escalation?.variant).toBe("medium");

    const withNone = chooseAutoModel({
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { low: {} } } }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(withNone?.escalation?.variant).toBe("");
  });

  it("omits escalation when it equals the selected model and variant", () => {
    const decision = chooseAutoModel({
      providers: [provider("alpha", { [MID_MODEL]: { variants: { medium: {} } } })],
      connected: [],
      disabled: {},
      tier: "heavy",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: MID_MODEL, variant: "medium" });
    expect(decision).not.toHaveProperty("escalation");
  });

  it("omits escalation for a single model with no variants", () => {
    const decision = chooseAutoModel({
      providers: [provider("alpha", { [MID_MODEL]: {} })],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ variant: "" });
    expect(decision).not.toHaveProperty("escalation");
  });

  it("keeps escalation on the same model when only the variant differs", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", { [MID_MODEL]: { variants: { low: {}, high: {} } } }),
      ],
      connected: [],
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: MID_MODEL, variant: "low" });
    expect(decision?.escalation).toEqual({
      providerID: "alpha",
      modelID: MID_MODEL,
      variant: "high",
    });
  });
});

describe("chooseAutoModel reason text", () => {
  it("uses the light template", () => {
    expect(choose({ tier: "light" })?.reason).toBe(
      "短い質問タスクのため低コストモデルを選択しました",
    );
  });

  it("uses the standard template", () => {
    expect(choose({ tier: "standard" })?.reason).toBe(
      "標準的なコーディングタスクのため中コストモデルを選択しました",
    );
  });

  it("uses the heavy template", () => {
    expect(choose({ tier: "heavy" })?.reason).toBe(
      "大規模・高難度タスクのため高性能モデルを選択しました",
    );
  });

  it("appends the image note when hasImages is true", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { capabilities: { input: { image: true } } },
        }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのため低コストモデルを選択しました（画像対応モデルに限定）",
    );
  });

  it("appends the fallback note when the primary cost band is empty", () => {
    const decision = chooseAutoModel({
      providers: [provider("alpha", { [MID_MODEL]: {} })],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのため低コストモデルを選択しました（該当コスト帯に候補がなく上位帯へフォールバック）",
    );
  });

  it("appends both notes when images narrowed the set and a fallback happened", () => {
    const decision = chooseAutoModel({
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: {},
          [MID_MODEL]: { capabilities: { input: { image: true } } },
        }),
      ],
      connected: [],
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのため低コストモデルを選択しました（画像対応モデルに限定）（該当コスト帯に候補がなく上位帯へフォールバック）",
    );
  });

  it("never marks heavy as a fallback", () => {
    const decision = chooseAutoModel({
      providers: [provider("alpha", { [CHEAP_MODEL]: {} })],
      connected: [],
      disabled: {},
      tier: "heavy",
      hasImages: false,
    });
    expect(decision?.reason).toBe(
      "大規模・高難度タスクのため高性能モデルを選択しました",
    );
  });
});
