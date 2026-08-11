import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  GOAL_LOOP_FORCE_FULL_RUN_LABEL,
  GOAL_LOOP_TOGGLE_LABEL,
  GoalLoopOptions,
  GoalLoopToggle,
} from "./GoalLoopComposer";

afterEach(cleanup);

describe("GoalLoopToggle", () => {
  it("exposes the pressed state so the composer pill is readable by AT", () => {
    const { rerender } = render(
      <GoalLoopToggle enabled={false} onToggle={vi.fn()} />,
    );
    const off = screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.className).toContain("text-muted");

    rerender(<GoalLoopToggle enabled onToggle={vi.fn()} />);
    const on = screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(on.className).toContain("text-primary");
  });

  it("fires onToggle on click and stays inert while disabled", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <GoalLoopToggle enabled={false} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<GoalLoopToggle enabled={false} disabled onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the toolbar row height so it lines up with the other pills", () => {
    render(<GoalLoopToggle enabled={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL });
    expect(btn.className).toContain("h-8");
    expect(btn.className).toContain("shrink-0");
  });
});

describe("GoalLoopOptions", () => {
  function setup(overrides: Partial<Parameters<typeof GoalLoopOptions>[0]> = {}) {
    const onAcceptanceChange = vi.fn();
    const onMaxTurnsChange = vi.fn();
    const onForceFullRunChange = vi.fn();
    render(
      <GoalLoopOptions
        acceptance=""
        maxTurns={10}
        forceFullRun={false}
        onAcceptanceChange={onAcceptanceChange}
        onMaxTurnsChange={onMaxTurnsChange}
        onForceFullRunChange={onForceFullRunChange}
        {...overrides}
      />,
    );
    return { onAcceptanceChange, onMaxTurnsChange, onForceFullRunChange };
  }

  it("labels both fields", () => {
    setup();
    expect(screen.getByLabelText("承認条件")).toBeTruthy();
    expect(screen.getByLabelText("最大ターン数")).toBeTruthy();
    expect(screen.getByLabelText(GOAL_LOOP_FORCE_FULL_RUN_LABEL)).toBeTruthy();
  });

  it("reports acceptance edits verbatim", () => {
    const { onAcceptanceChange } = setup();
    fireEvent.change(screen.getByLabelText("承認条件"), {
      target: { value: "tests pass\nlint clean" },
    });
    expect(onAcceptanceChange).toHaveBeenCalledWith("tests pass\nlint clean");
  });

  it("clamps maxTurns into 1..100 and falls back to 1 for junk", () => {
    const { onMaxTurnsChange } = setup();
    const input = screen.getByLabelText("最大ターン数");
    fireEvent.change(input, { target: { value: "500" } });
    expect(onMaxTurnsChange).toHaveBeenLastCalledWith(100);
    fireEvent.change(input, { target: { value: "0" } });
    expect(onMaxTurnsChange).toHaveBeenLastCalledWith(1);
    fireEvent.change(input, { target: { value: "" } });
    expect(onMaxTurnsChange).toHaveBeenLastCalledWith(1);
  });

  it("defaults force full-run OFF and reports toggles", () => {
    const { onForceFullRunChange } = setup();
    const checkbox = screen.getByLabelText(GOAL_LOOP_FORCE_FULL_RUN_LABEL) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onForceFullRunChange).toHaveBeenCalledWith(true);
  });

  it("hides the force full-run control when the callback is omitted", () => {
    setup({ onForceFullRunChange: undefined });
    expect(screen.queryByLabelText(GOAL_LOOP_FORCE_FULL_RUN_LABEL)).toBeNull();
  });

  it("disables both fields while the start request is in flight", () => {
    setup({ disabled: true });
    expect((screen.getByLabelText("承認条件") as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("最大ターン数") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByLabelText(GOAL_LOOP_FORCE_FULL_RUN_LABEL) as HTMLInputElement).disabled,
    ).toBe(true);
  });
});
