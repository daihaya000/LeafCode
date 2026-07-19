import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddonHost } from "./AddonHost";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/lib/addons/registry", () => ({
  ADDONS: [
    {
      id: "test-addon",
      name: "Test addon",
      description: "Test addon description",
      defaultEnabled: true,
      Widget: () => <div>Addon widget</div>,
    },
  ],
}));

vi.mock("@/lib/addons/state", () => ({
  ADDONS_CHANGED_EVENT: "webui:addons",
  isEnabled: () => true,
  readAddonPrefs: () => ({}),
  sanitizePrefs: (prefs: unknown) => prefs,
}));

describe("AddonHost", () => {
  beforeEach(() => {
    pathname = "/";
    document.body.innerHTML = "";
  });

  it("renders enabled widgets in normal sidebar flow", async () => {
    render(<AddonHost />);

    const widget = await screen.findByText("Addon widget");
    const host = widget.parentElement?.parentElement;

    expect(host?.className).toContain("w-full");
    expect(host?.className).not.toMatch(/\bfixed\b|\bright-\d/);
  });

  it.each(["/settings", "/settings/addons"])(
    "does not render widgets on %s",
    (settingsPath) => {
      pathname = settingsPath;
      render(<AddonHost />);

      expect(screen.queryByTestId("addon-host")).toBeNull();
    },
  );
});
