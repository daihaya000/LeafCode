import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceSelect } from "./IntelligenceSelect";

describe("IntelligenceSelect", () => {
  afterEach(() => cleanup());

  it("does not shrink in the composer toolbar (avoids the width-collapse bug)", () => {
    // Regression guard for the original bug: without shrink-0 (and with the
    // component's own min-w-0 base class), this chip could compress to an
    // unreadably small width when the composer toolbar has many siblings.
    // Note: a previous fix also forced a fixed min-w-[7.25rem], but that made
    // the chip visibly wider than its actual content (e.g. "デフォルト"),
    // leaving an oversized empty gap unlike every other toolbar chip (which
    // size to their content via shrink-0 alone). That fixed min-width was
    // removed; shrink-0 alone is sufficient and keeps sizing consistent with
    // siblings such as the agent/access-mode/skill-permission chips.
    render(
      <IntelligenceSelect
        variants={["low", "medium", "high"]}
        value=""
        onChange={vi.fn()}
        disabled={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "インテリジェンス" });
    expect(trigger.parentElement?.className).toContain("shrink-0");
    expect(trigger.parentElement?.className).not.toContain("min-w-[7.25rem]");
  });
});
