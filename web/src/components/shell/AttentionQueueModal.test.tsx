import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AttentionQueueModal } from "./AttentionQueueModal";
import type { AttentionItem } from "@/lib/attention";

const { attentionState } = vi.hoisted(() => ({
  attentionState: {
    items: [] as AttentionItem[],
    open: false,
    setOpen: vi.fn(),
    openNext: vi.fn(),
    remove: vi.fn(),
    resolveSessionTitle: vi.fn((_item: AttentionItem) => null as string | null),
  },
}));

vi.mock("./GlobalAttentionProvider", () => ({
  useGlobalAttention: () => attentionState,
}));

vi.mock("@/lib/client", () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
  ocJson: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
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
});
