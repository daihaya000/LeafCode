import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COST_PREFS } from "@/lib/currency";
import { MessageMetaHeader } from "./MessageMetaHeader";

vi.mock("@addons/codexbar", () => ({
  formatTokens: (tokens: number) => `${(tokens / 1000).toFixed(1)}k`,
  providerIconSrcForOpencodeId: (id?: string) =>
    id === "openai" ? "/openai.svg" : null,
}));

afterEach(() => cleanup());

describe("MessageMetaHeader", () => {
  it("shows provider icon, resolved model label, time, then cost", () => {
    render(
      <MessageMetaHeader
        info={{
          providerID: "openai",
          modelID: "gpt-5.6-sol",
          cost: 0.125,
          time: { completed: new Date(2026, 6, 19, 14, 32).getTime() },
        }}
        modelLabel="GPT-5.6 Sol"
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );

    expect(screen.getByAltText("").getAttribute("src")).toBe("/openai.svg");
    expect(screen.getByText("GPT-5.6 Sol").getAttribute("title")).toBe(
      "GPT-5.6 Sol",
    );
    // Default prefs → JPY without USD suffix.
    expect(screen.getByText("¥18.8")).toBeTruthy();
    const meta = screen.getByLabelText("応答メタデータ");
    expect(meta.textContent).toContain("14:32");
    expect(meta.textContent).not.toContain("$0.1250");
    // Cost renders after the model and time.
    const text = meta.textContent ?? "";
    expect(text.indexOf("GPT-5.6 Sol")).toBeLessThan(text.indexOf("14:32"));
    expect(text.indexOf("14:32")).toBeLessThan(text.indexOf("¥18.8"));
  });

  it("falls back to modelID and hides a zero cost without stray separators", () => {
    render(
      <MessageMetaHeader
        info={{ modelID: "fallback-model", cost: 0, time: { created: 1 } }}
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );

    const meta = screen.getByLabelText("応答メタデータ");
    expect(screen.getByText("fallback-model")).toBeTruthy();
    expect(meta.textContent).not.toContain("コスト");
    expect(meta.textContent).not.toMatch(/·\s*·|^\s*·|·\s*$/);
  });

  it("estimates OpenAI API cost from tokens when reported cost is zero", () => {
    render(
      <MessageMetaHeader
        info={{
          providerID: "openai",
          modelID: "gpt-5.6-luna",
          cost: 0,
          tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
        }}
        costPrefs={{ ...DEFAULT_COST_PREFS, currency: "USD" }}
      />,
    );

    expect(screen.getByText("$0.3200")).toBeTruthy();
  });

  it("shows the reasoning effort immediately after the model", () => {
    render(
      <MessageMetaHeader
        info={{ modelID: "gpt-5.6-luna", time: { created: 1 } }}
        modelLabel="GPT-5.6 Luna"
        effort="high"
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );

    const text = screen.getByLabelText("応答メタデータ").textContent ?? "";
    expect(text).toContain("GPT-5.6 Luna·high·");
    expect(text).not.toContain("推論強度");
    expect(text.indexOf("GPT-5.6 Luna")).toBeLessThan(text.indexOf("high"));
  });

  it("shows cost, tokens, and thinking time in the header order", () => {
    render(
      <MessageMetaHeader
        info={{
          modelID: "gpt-5.6-luna",
          cost: 0.05,
          tokens: { total: 12_345, input: 10_000, output: 2_000, reasoning: 345 },
          time: {
            created: 0,
            completed: 65_000,
          },
        }}
        modelLabel="GPT-5.6 Luna"
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );

    const text = screen.getByLabelText("応答メタデータ").textContent ?? "";
    expect(text).toContain("2.3K tk");
    expect(text).not.toContain("12.3k");
    expect(text).toContain("¥7.5");
    expect(text).toContain("1m 05s");
    expect(text).not.toContain("コスト");
    expect(text).not.toContain("トークン");
    expect(text).not.toContain("思考");
    expect(text.indexOf("¥7.5")).toBeLessThan(text.indexOf("2.3K tk"));
    expect(text.indexOf("2.3K tk")).toBeLessThan(text.indexOf("1m 05s"));
  });

  it("hides thinking time when only created is present", () => {
    render(
      <MessageMetaHeader
        info={{ modelID: "fallback-model", time: { created: 1 } }}
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );

    const text = screen.getByLabelText("応答メタデータ").textContent ?? "";
    expect(text).not.toContain("思考");
  });

  it("uses a CPU fallback when the provider icon is unknown or broken", () => {
    const { rerender } = render(
      <MessageMetaHeader
        info={{ providerID: "unknown", modelID: "model" }}
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );
    expect(screen.getByTestId("provider-icon-fallback")).toBeTruthy();

    rerender(
      <MessageMetaHeader
        info={{ providerID: "openai", modelID: "model" }}
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );
    fireEvent.error(screen.getByAltText(""));
    expect(screen.getByTestId("provider-icon-fallback")).toBeTruthy();
  });

  it("renders no empty row when model, cost, and time are absent", () => {
    const { container } = render(
      <MessageMetaHeader
        info={{ providerID: "openai" }}
        costPrefs={DEFAULT_COST_PREFS}
      />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
