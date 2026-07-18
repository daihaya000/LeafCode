import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "./PluginHost";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/lib/plugins/registry", () => ({
  PLUGINS: [
    {
      id: "test-plugin",
      name: "Test plugin",
      description: "Test plugin description",
      defaultEnabled: true,
      Widget: () => <div>Plugin widget</div>,
    },
  ],
}));

vi.mock("@/lib/plugins/state", () => ({
  PLUGINS_CHANGED_EVENT: "webui:plugins",
  isEnabled: () => true,
  readPluginPrefs: () => ({}),
  sanitizePrefs: (prefs: unknown) => prefs,
}));

describe("PluginHost", () => {
  beforeEach(() => {
    pathname = "/";
  });

  it("renders enabled widgets in normal sidebar flow", async () => {
    render(<PluginHost />);

    const widget = await screen.findByText("Plugin widget");
    const host = widget.parentElement?.parentElement;

    expect(host?.className).toContain("w-full");
    expect(host?.className).not.toMatch(/\bfixed\b|\bright-\d/);
  });
});
