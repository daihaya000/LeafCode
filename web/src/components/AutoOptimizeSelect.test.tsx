import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoOptimizeSelect } from "./AutoOptimizeSelect";

describe("AutoOptimizeSelect", () => {
  afterEach(() => cleanup());

  it("lists the three modes with Japanese labels", () => {
    render(
      <AutoOptimizeSelect value="cost" onChange={vi.fn()} disabled={false} />,
    );

    const trigger = screen.getByRole("button", { name: "Auto の最適化" });
    expect(trigger).toHaveProperty("value", "cost");
    expect(trigger.textContent).toContain("コスト優先");

    fireEvent.click(trigger);
    expect(
      screen.getAllByRole("option").map((node) => node.textContent),
    ).toEqual(["コスト優先", "バランス", "知能優先"]);
  });

  it("reports the picked mode", () => {
    const onChange = vi.fn();
    render(
      <AutoOptimizeSelect value="cost" onChange={onChange} disabled={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Auto の最適化" }));
    fireEvent.click(screen.getByRole("option", { name: "知能優先" }));
    expect(onChange).toHaveBeenCalledWith("intelligence");
  });

  it("shows the current mode label for a non-default value", () => {
    render(
      <AutoOptimizeSelect
        value="balanced"
        onChange={vi.fn()}
        disabled={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Auto の最適化" });
    expect(trigger).toHaveProperty("value", "balanced");
    expect(trigger.textContent).toContain("バランス");
  });

  it("does not shrink in the composer toolbar", () => {
    render(
      <AutoOptimizeSelect value="cost" onChange={vi.fn()} disabled={false} />,
    );

    const trigger = screen.getByRole("button", { name: "Auto の最適化" });
    expect(trigger.parentElement?.className).toContain("shrink-0");
  });

  it("does not open while disabled", () => {
    const onChange = vi.fn();
    render(
      <AutoOptimizeSelect value="cost" onChange={onChange} disabled={true} />,
    );

    const trigger = screen.getByRole("button", { name: "Auto の最適化" });
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
