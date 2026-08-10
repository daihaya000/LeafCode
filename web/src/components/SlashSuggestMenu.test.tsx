import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlashSuggestMenu } from "./SlashSuggestMenu";

afterEach(cleanup);

describe("SlashSuggestMenu", () => {
  it("keeps the active command visible as the selection moves", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <SlashSuggestMenu
        items={[
          { name: "review" },
          { name: "plan" },
        ]}
        activeIndex={1}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("option", { name: "plan" }).getAttribute("aria-selected")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("shows skill descriptions as readable secondary text", () => {
    render(
      <SlashSuggestMenu
        items={[{ name: "bug-hunt", description: "原因を調査して修正する" }]}
        activeIndex={0}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const description = screen.getByText("原因を調査して修正する");
    expect(description.className).toContain("text-muted");
    expect(description.className).toContain("line-clamp-2");
    expect(screen.getByRole("option").className).toContain("bg-working-bg");
  });
});
