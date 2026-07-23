import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AttentionQueueModal } from "./AttentionQueueModal";
import type { AttentionItem } from "@/lib/attention";

const { attentionState, mockOcJson, mockApiError } = vi.hoisted(() => {
  const mockOcJson = vi.fn();
  const mockApiError = class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  };
  return {
    attentionState: {
      items: [] as AttentionItem[],
      open: false,
      setOpen: vi.fn(),
      openNext: vi.fn(),
      remove: vi.fn(),
      resolveSessionTitle: vi.fn((_item: AttentionItem) => null as string | null),
    },
    mockOcJson,
    mockApiError,
  };
});

vi.mock("./GlobalAttentionProvider", () => ({
  useGlobalAttention: () => attentionState,
}));

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: mockOcJson,
  ApiError: mockApiError,
}));

function questionItem(sessionID = "ses_abc"): AttentionItem {
  return {
    kind: "question",
    directory: "/repo",
    request: {
      id: "q1",
      version: "v1",
      sessionID,
      questions: [
        {
          header: "",
          question: "進めますか？",
          options: [
            { label: "はい", description: "" },
            { label: "いいえ", description: "" },
          ],
        },
      ],
      receivedAt: 1,
    },
  };
}

describe("AttentionQueueModal", () => {
  beforeEach(() => {
    cleanup();
    attentionState.items = [];
    attentionState.open = false;
    attentionState.resolveSessionTitle.mockReset();
    attentionState.resolveSessionTitle.mockReturnValue(null);
  });

  it("renders nothing when the queue is empty", () => {
    const { container } = render(<AttentionQueueModal />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the resolved session title in the header", () => {
    const item = questionItem();
    attentionState.items = [item];
    attentionState.open = true;
    attentionState.resolveSessionTitle.mockReturnValue("画像タスクの修正");

    render(<AttentionQueueModal />);

    expect(screen.getByRole("dialog", { name: "確認が必要です" })).toBeTruthy();
    expect(screen.getByText("画像タスクの修正")).toBeTruthy();
    expect(screen.getByTitle("ses_abc")).toBeTruthy();
    expect(attentionState.resolveSessionTitle).toHaveBeenCalledWith(item);
  });

  it("falls back to sessionID when no title is resolved", () => {
    attentionState.items = [questionItem("ses_fallback")];
    attentionState.open = true;
    attentionState.resolveSessionTitle.mockReturnValue(null);

    render(<AttentionQueueModal />);

    expect(screen.getByText("ses_fallback")).toBeTruthy();
  });

  describe("busy release regression", () => {
    beforeEach(() => {
      mockOcJson.mockReset();
      attentionState.remove.mockReset();
    });

    it("releases busy and removes item on successful reply", async () => {
      mockOcJson.mockResolvedValueOnce({});
      const item = questionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      // Click the first option button (quick reply)
      const optionBtn = screen.getByText("はい");
      await act(async () => {
        optionBtn.click();
      });

      // After success: remove called, busy released (modal closes since queue empty)
      expect(attentionState.remove).toHaveBeenCalledWith(
        item.request.id,
        item.request.sessionID,
      );
    });

    it("releases busy and removes item on 404 reply", async () => {
      mockOcJson.mockRejectedValueOnce(new mockApiError(404, "not found"));
      const item = questionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const optionBtn = screen.getByText("はい");
      await act(async () => {
        optionBtn.click();
      });

      // 404 still removes the item and releases busy
      expect(attentionState.remove).toHaveBeenCalledWith(
        item.request.id,
        item.request.sessionID,
      );
    });

    it("releases busy and shows error on non-404 failure", async () => {
      mockOcJson.mockRejectedValueOnce(new Error("network error"));
      const item = questionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const optionBtn = screen.getByRole("button", { name: "はい" });
      await act(async () => {
        optionBtn.click();
      });

      // Error shown, remove NOT called
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(attentionState.remove).not.toHaveBeenCalled();
      // Modal's own busy released: the "後で" button is re-enabled
      const laterBtn = screen.getByRole("button", { name: "後で" }) as HTMLButtonElement;
      expect(laterBtn.disabled).toBe(false);
    });
  });
});
