import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelect } from "./ModelSelect";

const options = [
  { value: "auto", label: "Auto", group: "Auto" },
  { value: "openai::gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
  { value: "anthropic::claude", label: "Claude", group: "Anthropic" },
];

describe("ModelSelect", () => {
  afterEach(() => cleanup());

  it("renders the dropdown in a portal so composer overflow does not clip it", () => {
    const onChange = vi.fn();
    render(
      <div style={{ overflow: "hidden", width: 120, height: 40 }}>
        <ModelSelect
          value="openai::gpt-5.5"
          options={options}
          onChange={onChange}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));

    const listbox = screen.getByRole("listbox", { name: "モデル" });
    expect(listbox.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("option", { name: /Claude/ }));
    expect(onChange).toHaveBeenCalledWith("anthropic::claude");
  });

  it("right-aligns the dropdown to the trigger instead of the viewport edge", () => {
    render(
      <ModelSelect
        value="openai::gpt-5.5"
        options={options}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "モデル" });
    trigger.parentElement!.getBoundingClientRect = vi.fn(() => ({
      x: 400,
      y: 500,
      top: 500,
      right: 520,
      bottom: 532,
      left: 400,
      width: 120,
      height: 32,
      toJSON: () => ({}),
    }));

    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "モデル" });
    expect(listbox.style.left).toBe("296px");
    expect(listbox.style.top).toBe("176px");
  });

  it("keeps the menu inside the viewport when the trigger is wider than its measured content", () => {
    render(
      <ModelSelect
        value="openai::gpt-5.5"
        options={options}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "モデル" });
    trigger.parentElement!.getBoundingClientRect = vi.fn(() => ({
      x: 300,
      y: 500,
      top: 500,
      right: 700,
      bottom: 532,
      left: 300,
      width: 400,
      height: 32,
      toJSON: () => ({}),
    }));

    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "モデル" });
    // The portal menu first measures narrower than the trigger (its content
    // width), but the enforced min-width widens it afterwards. The position
    // must be recomputed from that effective width or it drifts off-screen.
    listbox.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      right: 215,
      bottom: 200,
      left: 0,
      width: 215,
      height: 200,
      toJSON: () => ({}),
    }));

    fireEvent(window, new Event("resize"));

    expect(listbox.style.left).toBe("300px");
    expect(listbox.style.minWidth).toBe("400px");
  });

  it("uses the LeafCode icon for Auto", () => {
    render(<ModelSelect value="auto" options={options} onChange={vi.fn()} />);

    expect(
      screen.getByRole("combobox", { name: "モデル" }).querySelector("img")?.getAttribute("src"),
    ).toBe("/icon-192.png");
  });

  it("supports keyboard navigation and returns focus after selection", () => {
    const onChange = vi.fn();
    render(
      <ModelSelect
        value="openai::gpt-5.5"
        options={options}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox");
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("anthropic::claude");
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders limited-provider models in danger color", () => {
    render(
      <ModelSelect
        value="openai::gpt-5.5"
        options={options}
        onChange={vi.fn()}
        limitedProviders={new Set(["openai"])}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));

    const openaiOption = screen.getByRole("option", { name: /GPT-5\.5/ });
    expect(openaiOption.className).toContain("text-danger");
    expect(openaiOption.getAttribute("title")).toContain("制限中");

    const anthropicOption = screen.getByRole("option", { name: /Claude/ });
    expect(anthropicOption.className).not.toContain("text-danger");
  });

  it("paints the trigger label danger when the selected model's provider is limited", () => {
    render(
      <ModelSelect
        value="openai::gpt-5.5"
        options={options}
        onChange={vi.fn()}
        limitedProviders={new Set(["openai"])}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "モデル" });
    expect(trigger.className).toContain("text-danger");
    expect(trigger.getAttribute("title")).toContain("プロバイダ制限中");
  });

  it("never marks the Auto option as limited", () => {
    render(
      <ModelSelect
        value="auto"
        options={options}
        onChange={vi.fn()}
        limitedProviders={new Set(["auto"])}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "モデル" });
    expect(trigger.className).not.toContain("text-danger");

    fireEvent.click(trigger);
    const autoOption = screen.getByRole("option", { name: /^Auto$/ });
    expect(autoOption.className).not.toContain("text-danger");
  });

  it("marks text-only models with an eye when image pre-analysis is available", () => {
    render(
      <ModelSelect
        value="anthropic::claude"
        options={options}
        onChange={vi.fn()}
        imageAnalysisAvailable
      />,
    );

    expect(screen.getByLabelText("画像事前解析を使用")).not.toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
    expect(screen.getAllByLabelText("画像事前解析を使用")).toHaveLength(3);
  });
});
