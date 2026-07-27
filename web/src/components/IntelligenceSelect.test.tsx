import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceSelect } from "./IntelligenceSelect";

describe("IntelligenceSelect", () => {
  afterEach(() => cleanup());

  it("keeps a usable width in the composer toolbar", () => {
    render(
      <IntelligenceSelect
        variants={["low", "medium", "high"]}
        value=""
        onChange={vi.fn()}
        disabled={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "インテリジェンス" });
    expect(trigger.parentElement?.className).toContain("min-w-[7.25rem]");
    expect(trigger.parentElement?.className).toContain("shrink-0");
  });
});
