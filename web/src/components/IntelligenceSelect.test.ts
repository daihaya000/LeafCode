import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntelligenceSelect } from "./IntelligenceSelect";

describe("IntelligenceSelect", () => {
  it("renders デフォルト + high when only high is available", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["high"],
        value: "",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(markup).toContain('aria-label="インテリジェンス"');
    expect(markup).toContain(">デフォルト<");
    expect(markup).toContain(">high<");
    expect(markup).not.toContain('value="low"');
  });

  it("renders デフォルト + low when only low is available", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["low"],
        value: "",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(markup).toContain(">デフォルト<");
    expect(markup).toContain(">low<");
    expect(markup).not.toContain('value="high"');
  });

  it("renders all supplied variants in order", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["none", "low", "medium", "high", "xhigh"],
        value: "",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(markup).toContain(">デフォルト<");
    expect(markup).toContain(">none<");
    expect(markup).toContain(">low<");
    expect(markup).toContain(">medium<");
    expect(markup).toContain(">high<");
    expect(markup).toContain(">xhigh<");
  });

  it("marks the selected value", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["high", "low"],
        value: "high",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(markup).toContain('<option value="high" selected="">');
  });

  it("passes disabled to the native select", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["high"],
        value: "",
        onChange: () => {},
        disabled: true,
      }),
    );
    expect(markup).toContain('disabled=""');
  });

  it("uses デフォルト as the visible label when value is empty", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["high"],
        value: "",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(markup).toContain("デフォルト");
  });

  it("uses the selected variant as the visible label when set", () => {
    const markup = renderToStaticMarkup(
      createElement(IntelligenceSelect, {
        variants: ["medium", "high"],
        value: "medium",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(markup).toContain(">medium<");
  });
});
