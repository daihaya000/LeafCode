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
      close = vi.fn();
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
