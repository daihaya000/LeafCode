import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { AppShell } from "./AppShell";

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: vi.fn(),
  getJson: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/components/plugins/PluginHost", () => ({
  PluginHost: () => <div data-testid="plugin-host" />,
}));

vi.mock("./Sidebar", () => ({
  Sidebar: ({ mobileOpen }: { mobileOpen: boolean }) => (
    <aside data-testid="sidebar" data-mobile-open={mobileOpen} />
  ),
}));

vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

describe("AppShell", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", class {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      close = vi.fn();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders children", () => {
    const { getByText } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );
    expect(getByText("child")).toBeTruthy();
  });

  it("does not render PluginHost outside the sidebar", () => {
    const { container } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    expect(container.querySelector('[data-testid="plugin-host"]')).toBeNull();
  });
});
