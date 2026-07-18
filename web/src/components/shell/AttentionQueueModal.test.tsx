import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { GlobalAttentionProvider } from "./GlobalAttentionProvider";
import { AttentionQueueModal } from "./AttentionQueueModal";

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: vi.fn(),
}));

describe("AttentionQueueModal", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", class {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      close = vi.fn();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing when the queue is empty", () => {
    const { container } = render(
      <GlobalAttentionProvider activeScope={null}>
        <AttentionQueueModal />
      </GlobalAttentionProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
