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
      resolveSessionTitle: vi.fn(() => null as string | null),
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

function permissionItem(sessionID = "ses_abc"): AttentionItem {
  return {
    kind: "permission",
    directory: "/repo",
    request: {
      id: "p1",
      version: "v1",
      sessionID,
      permission: "bash",
      patterns: [],
      receivedAt: 1,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

    it("QuestionCard re-enables its reply button after a successful reply", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = questionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const optionBtn = screen.getByRole("button", { name: "はい" }) as HTMLButtonElement;
      expect(optionBtn.disabled).toBe(false);
      act(() => {
        optionBtn.click();
      });
      expect(optionBtn.disabled).toBe(true);

      await act(async () => {
        request.resolve({});
        await request.promise;
      });

      expect(attentionState.remove).toHaveBeenCalledWith(
        item.request.id,
        item.request.sessionID,
      );
      expect(optionBtn.disabled).toBe(false);
    });

    it("QuestionCard re-enables its reply button after a 404 reply", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = questionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const optionBtn = screen.getByRole("button", { name: "はい" }) as HTMLButtonElement;
      expect(optionBtn.disabled).toBe(false);
      act(() => {
        optionBtn.click();
      });
      expect(optionBtn.disabled).toBe(true);

      await act(async () => {
        request.reject(new mockApiError(404, "not found"));
        try {
          await request.promise;
        } catch {
          // AttentionQueueModal treats 404 as already answered.
        }
      });

      expect(attentionState.remove).toHaveBeenCalledWith(
        item.request.id,
        item.request.sessionID,
      );
      expect(optionBtn.disabled).toBe(false);
    });

    it("QuestionCard re-enables its reply button after a non-404 reply failure", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = questionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const optionBtn = screen.getByRole("button", { name: "はい" });
      expect((optionBtn as HTMLButtonElement).disabled).toBe(false);
      act(() => {
        optionBtn.click();
      });
      expect((optionBtn as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        request.reject(new Error("network error"));
        try {
          await request.promise;
        } catch {
          // AttentionQueueModal reports non-404 failures in the modal.
        }
      });

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(attentionState.remove).not.toHaveBeenCalled();
      expect((optionBtn as HTMLButtonElement).disabled).toBe(false);

      const retry = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(retry.promise);
      act(() => {
        optionBtn.click();
      });
      expect(mockOcJson).toHaveBeenCalledTimes(2);
      expect((optionBtn as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        retry.resolve({});
        await retry.promise;
      });
    });

    it("PermissionCard re-enables its reply button after a successful reply", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = permissionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const allowBtn = screen.getByRole("button", { name: "許可" }) as HTMLButtonElement;
      expect(allowBtn.disabled).toBe(false);
      act(() => {
        allowBtn.click();
      });
      expect(allowBtn.disabled).toBe(true);

      await act(async () => {
        request.resolve({});
        await request.promise;
      });

      expect(attentionState.remove).toHaveBeenCalledWith(
        item.request.id,
        item.request.sessionID,
      );
      expect(allowBtn.disabled).toBe(false);
    });

    it("PermissionCard re-enables its reply button after a 404 reply", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = permissionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const allowBtn = screen.getByRole("button", { name: "許可" }) as HTMLButtonElement;
      expect(allowBtn.disabled).toBe(false);
      act(() => {
        allowBtn.click();
      });
      expect(allowBtn.disabled).toBe(true);

      await act(async () => {
        request.reject(new mockApiError(404, "not found"));
        try {
          await request.promise;
        } catch {
          // AttentionQueueModal treats 404 as already answered.
        }
      });

      expect(attentionState.remove).toHaveBeenCalledWith(
        item.request.id,
        item.request.sessionID,
      );
      expect(allowBtn.disabled).toBe(false);
    });

    it("PermissionCard re-enables its reply button after a non-404 reply failure", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = permissionItem();
      attentionState.items = [item];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const allowBtn = screen.getByRole("button", { name: "許可" }) as HTMLButtonElement;
      expect(allowBtn.disabled).toBe(false);
      act(() => {
        allowBtn.click();
      });
      expect(allowBtn.disabled).toBe(true);

      await act(async () => {
        request.reject(new Error("network error"));
        try {
          await request.promise;
        } catch {
          // AttentionQueueModal reports non-404 failures in the modal.
        }
      });

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(attentionState.remove).not.toHaveBeenCalled();
      expect(allowBtn.disabled).toBe(false);

      const retry = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(retry.promise);
      act(() => {
        allowBtn.click();
      });
      expect(mockOcJson).toHaveBeenCalledTimes(2);
      expect(allowBtn.disabled).toBe(true);
      await act(async () => {
        retry.resolve({});
        await retry.promise;
      });
    });
  });
});
