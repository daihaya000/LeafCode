import { describe, expect, it } from "vitest";
import { ensureModelOption, MODEL_UNSET_VALUE } from "./useProviderModels";

const OPTIONS = [
  { value: MODEL_UNSET_VALUE, label: "デフォルト", group: "デフォルト" },
  { value: "openai::gpt-5", label: "GPT-5", group: "OpenAI" },
];

describe("ensureModelOption", () => {
  it("keeps options unchanged when the current value is empty or listed", () => {
    expect(ensureModelOption(OPTIONS, "")).toBe(OPTIONS);
    expect(ensureModelOption(OPTIONS, "openai::gpt-5")).toBe(OPTIONS);
  });

  it("appends the current model when it is absent from the catalogue", () => {
    const result = ensureModelOption(OPTIONS, "anthropic::claude-5");
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({
      value: "anthropic::claude-5",
      label: "anthropic / claude-5",
      group: "現在のモデル",
    });
  });
});
