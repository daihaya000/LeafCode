import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileMenuButton } from "./MobileMenuButton";
import { ShellProvider } from "./ShellContext";

describe("MobileMenuButton", () => {
  afterEach(() => cleanup());

  it("exposes the drawer control attributes with a 44px touch target", () => {
    render(
      <ShellProvider>
        <MobileMenuButton />
      </ShellProvider>,
    );

    const button = screen.getByLabelText("メニュー");
    expect(button.getAttribute("aria-controls")).toBe("mobile-nav");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // h-11 / w-11 == 2.75rem == 44px touch target.
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("w-11");
    expect(button.className).toContain("focus-visible:outline-2");
    expect(button.className).toContain("focus-visible:outline-offset-1");
    expect(button.className).toContain("focus-visible:outline-primary");
  });

  it("reflects the open state through aria-expanded after a click", () => {
    render(
      <ShellProvider>
        <MobileMenuButton />
      </ShellProvider>,
    );

    const button = screen.getByLabelText("メニュー");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
