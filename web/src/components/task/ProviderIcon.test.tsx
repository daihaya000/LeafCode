import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderIcon } from "./ProviderIcon";

afterEach(() => cleanup());

describe("ProviderIcon", () => {
  it("renders the brand image for a known provider id", () => {
    render(<ProviderIcon providerID="anthropic" />);
    const img = screen.getByAltText("");
    expect(img.getAttribute("src")).toBe("/icons/claude.png");
    expect(img.className).toContain("rounded-[3px]");
  });

  it("aliases ollama-cloud to the ollama icon", () => {
    render(<ProviderIcon providerID="ollama-cloud" />);
    expect(screen.getByAltText("").getAttribute("src")).toBe(
      "/icons/ollama.png",
    );
  });

  it("falls back to the CPU glyph for unknown providers", () => {
    render(<ProviderIcon providerID="mystery" />);
    expect(screen.getByTestId("provider-icon-fallback")).toBeTruthy();
  });

  it("falls back to the CPU glyph when the image fails to load", () => {
    render(<ProviderIcon providerID="anthropic" />);
    fireEvent.error(screen.getByAltText(""));
    expect(screen.getByTestId("provider-icon-fallback")).toBeTruthy();
  });

  it("uses the CPU glyph when no provider id is given", () => {
    render(<ProviderIcon />);
    expect(screen.getByTestId("provider-icon-fallback")).toBeTruthy();
  });

  it("applies a custom className to both image and fallback", () => {
    const { rerender } = render(
      <ProviderIcon providerID="anthropic" className="size-6" />,
    );
    expect(screen.getByAltText("").className).toBe("size-6");

    rerender(<ProviderIcon providerID="mystery" className="size-6" />);
    expect(screen.getByTestId("provider-icon-fallback").getAttribute("class")).toContain(
      "size-6",
    );
  });
});
