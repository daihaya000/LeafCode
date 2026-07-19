import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COST_PREFS } from "@/lib/currency";
import { MessageMetaHeader } from "./MessageMetaHeader";

vi.mock("@/lib/addons/codexbar", () => ({
  providerIconSrcForOpencodeId: (id?: string) =>
    id === "openai" ? "/openai.svg" : null,
}));

afterEach(() => cleanup());

describe("MessageMetaHeader", () => {
  it("shows provider icon, resolved model label, time, then cost (cost last, no USD suffix by default)", () => {
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
    expect(screen.getByText("cost ¥18.8")).toBeTruthy();
    const meta = screen.getByLabelText("応答メタデータ");
    expect(meta.textContent).toContain("14:32");
    expect(meta.textContent).not.toContain("$0.1250");
    // Cost renders after model and time (cost is last).
    const text = meta.textContent ?? "";
    expect(text.indexOf("GPT-5.6 Sol")).toBeLessThan(text.indexOf("14:32"));
    expect(text.indexOf("14:32")).toBeLessThan(text.indexOf("cost ¥18.8"));
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
    expect(meta.textContent).not.toContain("cost");
    expect(meta.textContent).not.toMatch(/·\s*·|^\s*·|·\s*$/);
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
