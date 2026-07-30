import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhostSelect } from "./ui";

describe("GhostSelect", () => {
  afterEach(() => cleanup());

  it("renders its listbox in a portal and reports the selected option", () => {
    const onChange = vi.fn();
    render(
      createElement(
        GhostSelect,
        {
          "aria-label": "モデル",
          icon: createElement("span", null, "CPU"),
          valueLabel: "GPT-5",
          value: "gpt-5",
          onChange,
        },
        createElement("option", { value: "gpt-5" }, "GPT-5"),
        createElement("option", { value: "gpt-4.1" }, "GPT-4.1"),
      ),
    );

    const trigger = screen.getByRole("button", { name: "モデル" });
    expect(trigger).toHaveProperty("value", "gpt-5");
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "モデル" });
    // The menu is portaled into document.body inside a fixed positioning
    // wrapper (which carries the dynamic top/left and optional action footer),
    // so the listbox's grandparent — not its parent — is <body>.
    expect(listbox.parentElement?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("option", { name: "GPT-4.1" }));
    expect(onChange).toHaveBeenCalledWith("gpt-4.1");
  });

  it("renders optgroup labels and preserves option metadata", () => {
    render(
      createElement(
        GhostSelect,
        {
          "aria-label": "デフォルトモデル",
          icon: createElement("span", null, "CPU"),
          valueLabel: "GPT-5",
          value: "gpt-5",
          onChange: vi.fn(),
        },
        createElement("option", { value: "" }, "選択してください"),
        createElement(
          "optgroup",
          { label: "OpenAI" },
          createElement("option", { value: "gpt-5", title: "GPT-5 の説明" }, "GPT-5"),
          createElement("option", { value: "gpt-4.1", disabled: true }, "GPT-4.1"),
        ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "デフォルトモデル" }));

    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByRole("option", { name: "GPT-5" }).getAttribute("title")).toBe(
      "GPT-5 の説明",
    );
    expect((screen.getByRole("option", { name: "GPT-4.1" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
