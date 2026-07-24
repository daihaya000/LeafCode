import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
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

vi.mock("@/components/addons/AddonHost", () => ({
  AddonHost: () => <div data-testid="addon-host" />,
}));

vi.mock("./Sidebar", () => ({
  Sidebar: ({ mobileOpen }: { mobileOpen: boolean }) => (
    <aside data-testid="sidebar" data-mobile-open={mobileOpen} />
  ),
}));

vi.mock("./GlobalAttentionProvider", () => ({
  GlobalAttentionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useOptionalGlobalAttention: () => null,
}));

vi.mock("./AttentionQueueModal", () => ({
  AttentionQueueModal: () => null,
}));

vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

describe("AppShell", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", class {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readyState = 1;
      close = vi.fn(() => {
        this.readyState = 2;
      });
      private listeners = new Map<string, Array<() => void>>();

      addEventListener(type: string, listener: () => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      removeEventListener(type: string, listener: () => void) {
        const list = this.listeners.get(type);
        if (!list) return;
        this.listeners.set(
          type,
          list.filter((l) => l !== listener),
        );
      }
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders children", () => {
    const { getByText } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );
    expect(getByText("child")).toBeTruthy();
  });

  it("does not render AddonHost outside the sidebar", () => {
    const { container } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    expect(container.querySelector('[data-testid="addon-host"]')).toBeNull();
  });

  it("no longer renders the legacy mobile brand bar", () => {
    const { queryByText, queryByLabelText } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    // The old top bar had an "OpenCodeWebUI" brand link and its own メニュー
    // button; those moved into per-page headers, so AppShell must not render
    // them anymore.
    expect(queryByText("OpenCodeWebUI")).toBeNull();
    expect(queryByLabelText("メニュー")).toBeNull();
  });

  it("starts with the mobile drawer closed", () => {
    const { getByTestId } = render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    expect(getByTestId("sidebar").getAttribute("data-mobile-open")).toBe(
      "false",
    );
  });
});
