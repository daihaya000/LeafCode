import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceSelect } from "./IntelligenceSelect";

function renderSelect(
  variants: Parameters<typeof IntelligenceSelect>[0]["variants"],
  value = "",
  disabled = false,
  onChange = vi.fn(),
) {
  render(
    createElement(IntelligenceSelect, { variants, value, onChange, disabled }),
  );
  return onChange;
}

describe("IntelligenceSelect", () => {
  afterEach(() => cleanup());

  it("renders デフォルト + high when only high is available", () => {
    const onChange = renderSelect(["high"]);
    fireEvent.click(screen.getByRole("button", { name: "インテリジェンス" }));

    expect(screen.getByRole("option", { name: "デフォルト" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "high" }));
    expect(onChange).toHaveBeenCalledWith("high");
    expect(screen.queryByRole("option", { name: "low" })).toBeNull();
  });

  it("renders デフォルト + low when only low is available", () => {
    renderSelect(["low"]);
    fireEvent.click(screen.getByRole("button", { name: "インテリジェンス" }));

    expect(screen.getByRole("option", { name: "デフォルト" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "low" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "high" })).toBeNull();
  });

  it("renders all supplied variants in order", () => {
    renderSelect(["none", "low", "medium", "high", "xhigh"]);
    fireEvent.click(screen.getByRole("button", { name: "インテリジェンス" }));

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["デフォルト", "none", "low", "medium", "high", "xhigh"]);
  });

  it("marks the selected value", () => {
    renderSelect(["high", "low"], "high");
    fireEvent.click(screen.getByRole("button", { name: "インテリジェンス" }));

    expect(screen.getByRole("option", { name: "high" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("passes disabled to the trigger", () => {
    renderSelect(["high"], "", true);

    expect((screen.getByRole("button", { name: "インテリジェンス" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("uses デフォルト as the visible label when value is empty", () => {
    renderSelect(["high"]);

    expect(screen.getByRole("button", { name: "インテリジェンス" }).textContent).toContain(
      "デフォルト",
    );
  });

  it("uses the selected variant as the visible label when set", () => {
    renderSelect(["medium", "high"], "medium");

    expect(screen.getByRole("button", { name: "インテリジェンス" }).textContent).toContain(
      "medium",
    );
  });
});
