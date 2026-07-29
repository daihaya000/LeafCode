import { describe, expect, it } from "vitest";
import {
  AUTO_MODEL_VALUE,
  AUTO_OPTIMIZE_MODES,
  autoOptimizeModeLabel,
  chooseAutoModel,
  classifyPrompt,
  DEFAULT_AUTO_OPTIMIZE_MODE,
  isAutoOptimizeMode,
  modelCostTier,
  SIGNAL_ATTACHMENT_THRESHOLD,
  SIGNAL_HISTORY_THRESHOLD,
  type AutoCandidateProvider,
  type AutoOptimizeMode,
  type AutoTier,
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
    mode: "cost",
    providers: threeTierProviders(),
    connected: undefined,
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
  it("returns no candidate when connected is explicitly empty", () => {
    expect(choose({ tier: "light", connected: [] })).toBeNull();
  });

  it("allows every provider when connected is omitted for legacy responses", () => {
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
      mode: "cost",
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: {},
          [MID_MODEL]: { capabilities: { input: { image: true } } },
        }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("accepts attachment capability as image support", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { capabilities: { attachment: true } },
        }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision).toMatchObject({ modelID: CHEAP_MODEL });
  });

  it("returns null when no model supports images", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { capabilities: { input: { image: false } } },
          [MID_MODEL]: {},
        }),
      ],
      connected: undefined,
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
      mode: "cost",
      providers: [],
      connected: undefined,
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

  it("standard picks the highest scoring cheap model in cost mode", () => {
    expect(choose({ tier: "standard" })).toMatchObject({
      providerID: "alpha",
      modelID: CHEAP_MODEL,
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
      mode: "cost",
      providers: [
        provider("alpha", { [MID_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: {} }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("light falls back to premium when neither cheap nor mid exists", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [provider("beta", { [PREMIUM_MODEL]: {} })],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: PREMIUM_MODEL });
  });

  it("standard falls back to mid before premium when no cheap model exists", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", { [MID_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: {} }),
      ],
      connected: undefined,
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("standard falls back to premium when neither cheap nor mid exists", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [provider("beta", { [PREMIUM_MODEL]: {} })],
      connected: undefined,
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: PREMIUM_MODEL });
  });

  it("breaks score ties by providerID::modelID lexical order", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("zeta", { [MID_MODEL]: {} }),
        provider("alpha", { [MID_MODEL]: {} }),
      ],
      connected: undefined,
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ providerID: "alpha", modelID: MID_MODEL });
  });

  it("is deterministic regardless of provider iteration order", () => {
    const a = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", { [MID_MODEL]: {} }),
        provider("zeta", { [MID_MODEL]: {} }),
      ],
      connected: undefined,
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    const b = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("zeta", { [MID_MODEL]: {} }),
        provider("alpha", { [MID_MODEL]: {} }),
      ],
      connected: undefined,
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
      mode: "cost",
      providers: [provider("alpha", { [MID_MODEL]: { variants } })],
      connected: undefined,
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

  it("prefers a different provider for retry to survive provider outages", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("anthropic", {
          [CHEAP_MODEL]: { variants: { ...allVariants } },
          [PREMIUM_MODEL]: { variants: { ...allVariants } },
        }),
        provider("openai", {
          [MID_MODEL]: { variants: { ...allVariants } },
        }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });

    expect(decision).toMatchObject({
      providerID: "anthropic",
      modelID: CHEAP_MODEL,
      escalation: {
        providerID: "openai",
        modelID: MID_MODEL,
        variant: "high",
      },
    });
  });

  it("falls back to max then medium then empty for the escalation variant", () => {
    const withMax = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { max: {}, medium: {} } } }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(withMax?.escalation?.variant).toBe("max");

    const withMedium = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { medium: {}, low: {} } } }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(withMedium?.escalation?.variant).toBe("medium");

    const withNone = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: {} }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { low: {} } } }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(withNone?.escalation?.variant).toBe("");
  });

  it("omits escalation when it equals the selected model and variant", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [provider("alpha", { [MID_MODEL]: { variants: { medium: {} } } })],
      connected: undefined,
      disabled: {},
      tier: "heavy",
      hasImages: false,
    });
    expect(decision).toMatchObject({ modelID: MID_MODEL, variant: "medium" });
    expect(decision).not.toHaveProperty("escalation");
  });

  it("omits escalation for a single model with no variants", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [provider("alpha", { [MID_MODEL]: {} })],
      connected: undefined,
      disabled: {},
      tier: "standard",
      hasImages: false,
    });
    expect(decision).toMatchObject({ variant: "" });
    expect(decision).not.toHaveProperty("escalation");
  });

  it("keeps escalation on the same model when only the variant differs", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", { [MID_MODEL]: { variants: { low: {}, high: {} } } }),
      ],
      connected: undefined,
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
      "短い質問タスクのためコスト優先で選択しました",
    );
  });

  it("uses the standard template", () => {
    expect(choose({ tier: "standard" })?.reason).toBe(
      "標準的なコーディングタスクのためコスト優先で選択しました",
    );
  });

  it("uses the heavy template", () => {
    expect(choose({ tier: "heavy" })?.reason).toBe(
      "大規模・高難度タスクのためコスト優先で選択しました",
    );
  });

  it("appends the image note when hasImages is true", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { capabilities: { input: { image: true } } },
        }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのためコスト優先で選択しました（画像対応モデルに限定）",
    );
  });

  it("appends the fallback note when the primary cost band is empty", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [provider("alpha", { [MID_MODEL]: {} })],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: false,
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのためコスト優先で選択しました（該当コスト帯に候補がなく別コスト帯へフォールバック）",
    );
  });

  it("appends both notes when images narrowed the set and a fallback happened", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: {},
          [MID_MODEL]: { capabilities: { input: { image: true } } },
        }),
      ],
      connected: undefined,
      disabled: {},
      tier: "light",
      hasImages: true,
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのためコスト優先で選択しました（画像対応モデルに限定）（該当コスト帯に候補がなく別コスト帯へフォールバック）",
    );
  });

  it("never marks heavy as a fallback", () => {
    const decision = chooseAutoModel({
      mode: "cost",
      providers: [provider("alpha", { [CHEAP_MODEL]: {} })],
      connected: undefined,
      disabled: {},
      tier: "heavy",
      hasImages: false,
    });
    expect(decision?.reason).toBe(
      "大規模・高難度タスクのためコスト優先で選択しました",
    );
  });
});

describe("AutoOptimizeMode helpers", () => {
  it("exposes the three modes with cost as the default", () => {
    expect(AUTO_OPTIMIZE_MODES).toEqual(["cost", "balanced", "intelligence"]);
    expect(DEFAULT_AUTO_OPTIMIZE_MODE).toBe("cost");
  });

  it("accepts only the known modes", () => {
    for (const mode of AUTO_OPTIMIZE_MODES) {
      expect(isAutoOptimizeMode(mode)).toBe(true);
    }
    for (const value of ["", "COST", "balance", "auto", 1, null, undefined, {}]) {
      expect(isAutoOptimizeMode(value)).toBe(false);
    }
  });

  it("labels every mode in Japanese", () => {
    expect(autoOptimizeModeLabel("cost")).toBe("コスト優先");
    expect(autoOptimizeModeLabel("balanced")).toBe("バランス");
    expect(autoOptimizeModeLabel("intelligence")).toBe("知能優先");
  });
});

describe("chooseAutoModel optimize mode cost bands", () => {
  const expected: Record<AutoOptimizeMode, Record<AutoTier, string>> = {
    cost: {
      light: CHEAP_MODEL,
      standard: CHEAP_MODEL,
      heavy: PREMIUM_MODEL,
    },
    balanced: {
      light: CHEAP_MODEL,
      standard: MID_MODEL,
      heavy: PREMIUM_MODEL,
    },
    intelligence: {
      light: MID_MODEL,
      standard: PREMIUM_MODEL,
      heavy: PREMIUM_MODEL,
    },
  };

  for (const mode of AUTO_OPTIMIZE_MODES) {
    for (const tier of ["light", "standard", "heavy"] as AutoTier[]) {
      it(`${mode} + ${tier} picks ${expected[mode][tier]}`, () => {
        expect(choose({ mode, tier })?.modelID).toBe(expected[mode][tier]);
      });
    }
  }

  it("balanced standard prefers premium over cheap when no mid exists", () => {
    const decision = choose({
      mode: "balanced",
      tier: "standard",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: { variants: { ...allVariants } } }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { ...allVariants } } }),
      ],
    });
    expect(decision?.modelID).toBe(PREMIUM_MODEL);
  });

  it("cost standard prefers cheap over premium when no mid exists", () => {
    const decision = choose({
      mode: "cost",
      tier: "standard",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: { variants: { ...allVariants } } }),
        provider("beta", { [PREMIUM_MODEL]: { variants: { ...allVariants } } }),
      ],
    });
    expect(decision?.modelID).toBe(CHEAP_MODEL);
  });

  it("intelligence standard falls back to mid, then cheap", () => {
    const withMid = choose({
      mode: "intelligence",
      tier: "standard",
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: { variants: { ...allVariants } },
          [MID_MODEL]: { variants: { ...allVariants } },
        }),
      ],
    });
    expect(withMid?.modelID).toBe(MID_MODEL);

    const cheapOnly = choose({
      mode: "intelligence",
      tier: "standard",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: { variants: { ...allVariants } } }),
      ],
    });
    expect(cheapOnly?.modelID).toBe(CHEAP_MODEL);
  });

  it("intelligence light falls back to cheap when no mid exists", () => {
    const decision = choose({
      mode: "intelligence",
      tier: "light",
      providers: [
        provider("alpha", { [CHEAP_MODEL]: { variants: { ...allVariants } } }),
      ],
    });
    expect(decision?.modelID).toBe(CHEAP_MODEL);
  });
});

describe("chooseAutoModel optimize mode variants", () => {
  const expected: Record<AutoOptimizeMode, Record<AutoTier, string>> = {
    cost: { light: "minimal", standard: "low", heavy: "medium" },
    balanced: { light: "low", standard: "medium", heavy: "high" },
    intelligence: { light: "medium", standard: "high", heavy: "max" },
  };

  for (const mode of AUTO_OPTIMIZE_MODES) {
    for (const tier of ["light", "standard", "heavy"] as AutoTier[]) {
      it(`${mode} + ${tier} prefers effort ${expected[mode][tier]}`, () => {
        expect(choose({ mode, tier })?.variant).toBe(expected[mode][tier]);
      });
    }
  }

  it("skips efforts the model does not declare", () => {
    const decision = choose({
      mode: "intelligence",
      tier: "light",
      providers: [
        provider("alpha", {
          // intelligence/light order is medium, low, high, minimal, none.
          [MID_MODEL]: { variants: { none: {}, high: {} } },
        }),
      ],
    });
    expect(decision?.variant).toBe("high");
  });
});

describe("chooseAutoModel optimize mode reason and echo", () => {
  it("names the mode in the reason", () => {
    expect(choose({ mode: "cost", tier: "light" })?.reason).toBe(
      "短い質問タスクのためコスト優先で選択しました",
    );
    expect(choose({ mode: "balanced", tier: "standard" })?.reason).toBe(
      "標準的なコーディングタスクのためバランスで選択しました",
    );
    expect(choose({ mode: "intelligence", tier: "heavy" })?.reason).toBe(
      "大規模・高難度タスクのため知能優先で選択しました",
    );
  });

  it("keeps the image and fallback suffixes", () => {
    const decision = choose({
      mode: "intelligence",
      tier: "light",
      hasImages: true,
      providers: [
        provider("alpha", {
          [CHEAP_MODEL]: {
            variants: { ...allVariants },
            capabilities: { input: { image: true } },
          },
        }),
      ],
    });
    expect(decision?.reason).toBe(
      "短い質問タスクのため知能優先で選択しました（画像対応モデルに限定）（該当コスト帯に候補がなく別コスト帯へフォールバック）",
    );
  });

  it("echoes the requested mode on the decision", () => {
    for (const mode of AUTO_OPTIMIZE_MODES) {
      expect(choose({ mode })?.mode).toBe(mode);
    }
  });
});

describe("chooseAutoModel CodexBar provider usage", () => {
  const providers = [
    provider("alpha", { "gpt-5-mini": { variants: { ...allVariants } } }),
    provider("beta", { "gpt-5-nano": { variants: { ...allVariants } } }),
  ];

  it("excludes a CodexBar-limited provider", () => {
    expect(
      choose({
        providers,
        usage: {
          alpha: { usedPercent: 5, limited: true },
          beta: { usedPercent: 80, limited: false },
        },
      })?.providerID,
    ).toBe("beta");
  });

  it("reroutes to a provider at least 20 points less utilized", () => {
    expect(
      choose({
        providers,
        usage: {
          alpha: { usedPercent: 75, limited: false },
          beta: { usedPercent: 40, limited: false },
        },
      })?.providerID,
    ).toBe("beta");
  });

  it("keeps the normal score tie-break when the usage gap is below 20 points", () => {
    expect(
      choose({
        providers,
        usage: {
          alpha: { usedPercent: 55, limited: false },
          beta: { usedPercent: 40, limited: false },
        },
      })?.providerID,
    ).toBe("alpha");
  });

  it("keeps the normal provider when its usage is unknown", () => {
    expect(
      choose({
        providers: [
          provider("alpha", {
            "gpt-5.6-luna-mini": { variants: { ...allVariants } },
          }),
          provider("beta", {
            "gpt-5-mini": { variants: { ...allVariants } },
          }),
          provider("gamma", {
            "gpt-5-nano": { variants: { ...allVariants } },
          }),
        ],
        usage: {
          beta: { usedPercent: 70, limited: false },
          gamma: { usedPercent: 10, limited: false },
        },
      })?.providerID,
    ).toBe("alpha");
  });
});

describe("classifyPrompt file path signal", () => {
  it("stays standard for two distinct file references", () => {
    const prompt = "src/a.ts と src/b.ts の対応関係を確認";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("escalates to heavy for three distinct file references", () => {
    const prompt = "src/a.ts と src/b.ts と src/c.ts の対応関係を確認";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("counts repeated references only once", () => {
    const prompt = "src/a.ts src/a.ts SRC/A.TS src/b.ts の対応関係を確認";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("recognizes several extensions and path separators", () => {
    const prompt = "web\\a.tsx, host/b.mjs, docs/c.md の対応関係を確認";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("does not treat a bare sentence period as a file reference", () => {
    // Three periods, zero known extensions: the prompt stays a light question.
    const prompt = "なぜこうなるの. ここが分からない. もう一度.";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("light");
  });
});

describe("classifyPrompt numbered list signal", () => {
  // Wording deliberately free of question / work keywords so the base tier is
  // `standard` and the numbered-list rule is what moves it.
  const item = (n: number) => `${n}. 手順のメモ`;

  it("stays standard for three numbered items", () => {
    const prompt = [1, 2, 3].map(item).join("\n");
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });

  it("escalates to heavy for four numbered items", () => {
    const prompt = [1, 2, 3, 4].map(item).join("\n");
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("accepts the paren form", () => {
    const prompt = [1, 2, 3, 4].map((n) => `${n}) 手順のメモ`).join("\n");
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("heavy");
  });

  it("ignores numbers that are not at a line start", () => {
    const prompt = "手順は 1. これ 2. あれ 3. それ 4. どれ";
    expect(classifyPrompt(prompt, { hasImages: false })).toBe("standard");
  });
});

describe("classifyPrompt context signals", () => {
  const LIGHT = "なぜこうなるの";
  const STANDARD = "この関数を実装して";
  const HEAVY = "全面的にリファクタして";

  it("matches the text-only result when no signals are given", () => {
    expect(classifyPrompt(LIGHT, { hasImages: false })).toBe("light");
    expect(classifyPrompt(STANDARD, { hasImages: false })).toBe("standard");
    expect(classifyPrompt(HEAVY, { hasImages: false })).toBe("heavy");
  });

  it("bumps one step on a recent failure", () => {
    expect(
      classifyPrompt(LIGHT, { hasImages: false, recentFailure: true }),
    ).toBe("standard");
    expect(
      classifyPrompt(STANDARD, { hasImages: false, recentFailure: true }),
    ).toBe("heavy");
  });

  it("keeps heavy at heavy", () => {
    expect(
      classifyPrompt(HEAVY, {
        hasImages: false,
        recentFailure: true,
        attachmentCount: 9,
        historyMessageCount: 999,
      }),
    ).toBe("heavy");
  });

  it("bumps at the attachment threshold, not below", () => {
    expect(
      classifyPrompt(LIGHT, {
        hasImages: false,
        attachmentCount: SIGNAL_ATTACHMENT_THRESHOLD - 1,
      }),
    ).toBe("light");
    expect(
      classifyPrompt(LIGHT, {
        hasImages: false,
        attachmentCount: SIGNAL_ATTACHMENT_THRESHOLD,
      }),
    ).toBe("standard");
  });

  it("bumps at the history threshold, not below", () => {
    expect(
      classifyPrompt(LIGHT, {
        hasImages: false,
        historyMessageCount: SIGNAL_HISTORY_THRESHOLD - 1,
      }),
    ).toBe("light");
    expect(
      classifyPrompt(LIGHT, {
        hasImages: false,
        historyMessageCount: SIGNAL_HISTORY_THRESHOLD,
      }),
    ).toBe("standard");
  });

  it("bumps only one step even when every signal fires", () => {
    expect(
      classifyPrompt(LIGHT, {
        hasImages: false,
        recentFailure: true,
        attachmentCount: SIGNAL_ATTACHMENT_THRESHOLD,
        historyMessageCount: SIGNAL_HISTORY_THRESHOLD,
      }),
    ).toBe("standard");
  });

  it("still ignores hasImages for the tier", () => {
    expect(classifyPrompt(LIGHT, { hasImages: true })).toBe("light");
  });
});
