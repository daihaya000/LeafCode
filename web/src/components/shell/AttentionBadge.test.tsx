import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttentionBadge } from "./AttentionBadge";

const { useOptionalGlobalAttention } = vi.hoisted(() => ({
  useOptionalGlobalAttention: vi.fn(),
}));

vi.mock("./GlobalAttentionProvider", () => ({
  useOptionalGlobalAttention,
}));

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: vi.fn(),
  getJson: vi.fn(),
}));

describe("AttentionBadge", () => {
  beforeEach(() => {
    useOptionalGlobalAttention.mockReturnValue(null);
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
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing when queue is empty", () => {
    const { container } = render(<AttentionBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("uses the shared focus-visible outline when attention is pending", () => {
    useOptionalGlobalAttention.mockReturnValue({
      items: [{ id: "attention-1" }],
      openNext: vi.fn(),
    });

    render(<AttentionBadge />);

    const button = screen.getByLabelText("待機中の要求 1 件");
    expect(button.className).toContain("focus-visible:outline-2");
    expect(button.className).toContain("focus-visible:outline-offset-1");
    expect(button.className).toContain("focus-visible:outline-primary");
  });
});
