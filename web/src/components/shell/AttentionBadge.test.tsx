import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { AttentionBadge } from "./AttentionBadge";
import { GlobalAttentionProvider } from "./GlobalAttentionProvider";

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: vi.fn(),
  getJson: vi.fn(),
}));

describe("AttentionBadge", () => {
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
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing when queue is empty", () => {
    const { container } = render(
      <GlobalAttentionProvider activeScope={null}>
        <AttentionBadge />
      </GlobalAttentionProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
