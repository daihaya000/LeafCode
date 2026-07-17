import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GhostSelect } from "./ui";

describe("GhostSelect", () => {
  it("keeps a native select with its accessible name and option groups", () => {
    const markup = renderToStaticMarkup(
      createElement(
        GhostSelect,
        {
          "aria-label": "モデル",
          icon: createElement("span", null, "CPU"),
          valueLabel: "GPT-5",
          value: "gpt-5",
          onChange: () => {},
        },
        createElement(
          "optgroup",
          { label: "OpenAI" },
          createElement("option", { value: "gpt-5" }, "GPT-5"),
        ),
      ),
    );

    expect(markup).toContain('<select aria-label="モデル"');
    expect(markup).toContain('<optgroup label="OpenAI">');
    expect(markup).toContain('<option value="gpt-5" selected="">GPT-5</option>');
    expect(markup).toContain("absolute inset-0 h-full w-full");
    expect(markup).toContain("appearance-none opacity-0");
  });
});
