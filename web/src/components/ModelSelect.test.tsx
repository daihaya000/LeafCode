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

  it("uses the OpenCodeWebUI icon for Auto", () => {
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
});
