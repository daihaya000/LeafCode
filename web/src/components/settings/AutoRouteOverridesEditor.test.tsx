import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoRouteOverridesEditor } from "./AutoRouteOverridesEditor";

afterEach(cleanup);

describe("AutoRouteOverridesEditor", () => {
  it("is collapsed by default", () => {
    const onChange = vi.fn();
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={{}} onChange={onChange} />,
    );
    expect(screen.queryByText("ライト")).toBeNull();
    expect(screen.queryByLabelText("全tierの上書きをリセット")).toBeNull();
  });

  it("expands to show all three tiers", () => {
    const onChange = vi.fn();
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={{}} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("tier別ルーティング設定"));
    expect(screen.getByText("ライト")).toBeTruthy();
    expect(screen.getByText("標準")).toBeTruthy();
    expect(screen.getByText("ヘビー")).toBeTruthy();
  });

  it("shows a reset-all button only when overrides exist and clears them", () => {
    const onChange = vi.fn();
    const overrides = {
      light: { costOrder: ["mid", "cheap", "premium"] as const },
    };
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={overrides} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("全tierの上書きをリセット"));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("resets a single tier via its aria-labelled reset button", () => {
    const onChange = vi.fn();
    const overrides = {
      light: { costOrder: ["mid", "cheap", "premium"] as const },
    };
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={overrides} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("tier別ルーティング設定"));
    fireEvent.click(screen.getByLabelText("ライトの上書きをリセット"));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("switches a tier to strongest-candidate when the checkbox is toggled", () => {
    const onChange = vi.fn();
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={{}} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("tier別ルーティング設定"));
    fireEvent.click(screen.getAllByText("最強候補を優先（コスト帯で絞らない）")[0]);
    expect(onChange).toHaveBeenCalledWith({
      light: { costOrder: null },
    });
  });

  it("removes a cost band from the preset order on uncheck", () => {
    const onChange = vi.fn();
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={{}} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("tier別ルーティング設定"));
    // light tier checkbox order: [strongest, cheap, mid, premium] → uncheck cheap
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith({
      light: { costOrder: ["mid", "premium"] },
    });
  });

  it("moves a cost band down within the order", () => {
    const onChange = vi.fn();
    const overrides = {
      light: { costOrder: ["cheap", "mid", "premium"] as const },
    };
    render(
      <AutoRouteOverridesEditor mode="balanced" overrides={overrides} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("tier別ルーティング設定"));
    fireEvent.click(screen.getByLabelText("低コスト を下へ"));
    expect(onChange).toHaveBeenCalledWith({
      light: { costOrder: ["mid", "cheap", "premium"] },
    });
  });
});
