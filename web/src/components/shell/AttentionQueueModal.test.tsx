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
      actionableItems: [] as AttentionItem[],
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
    attentionState.actionableItems = [];
    attentionState.open = false;
    attentionState.resolveSessionTitle.mockReset();
    attentionState.resolveSessionTitle.mockReturnValue(null);
  });

  function enqueue(...queue: AttentionItem[]) {
    attentionState.items = queue;
    attentionState.actionableItems = queue;
  }

  it("renders nothing when the queue is empty", () => {
    const { container } = render(<AttentionQueueModal />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the resolved session title in the header", () => {
    const item = questionItem();
    enqueue(item);
    attentionState.open = true;
    attentionState.resolveSessionTitle.mockReturnValue("画像タスクの修正");

    render(<AttentionQueueModal />);

    expect(screen.getByRole("dialog", { name: "確認が必要です" })).toBeTruthy();
    expect(screen.getByText("画像タスクの修正")).toBeTruthy();
    expect(screen.getByTitle("ses_abc")).toBeTruthy();
    expect(attentionState.resolveSessionTitle).toHaveBeenCalledWith(item);
  });

  it("falls back to sessionID when no title is resolved", () => {
    enqueue(questionItem("ses_fallback"));
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
      enqueue(item);
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
      enqueue(item);
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
      enqueue(item);
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
      enqueue(item);
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

    it("フルアクセス切替時、サブエージェント不許可なら残りの task 権限を reject する", async () => {
      localStorage.setItem("webui:subagent-permission", "deny");
      mockOcJson.mockResolvedValue({});
      const bashPerm = permissionItem();
      const taskPerm: AttentionItem = {
        kind: "permission",
        directory: "/repo",
        request: {
          id: "p_task",
          version: "v1",
          sessionID: "ses_abc",
          permission: "task",
          patterns: [],
          receivedAt: 2,
        },
      };
      // current = bash (older); task は自動 reject 対象なのでモーダル非表示、
      // enableFullAccess は raw items から残りの task を reject する。
      attentionState.items = [bashPerm, taskPerm];
      attentionState.actionableItems = [bashPerm];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const select = screen.getByTitle("常に許可 / フルアクセス") as HTMLSelectElement;
      await act(async () => {
        select.value = "full";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      // PermissionCard が現在の bash を once で承認したあと、
      // enableFullAccess が残りの task を reject する。
      expect(mockOcJson).toHaveBeenCalledWith(
        expect.stringContaining("/permissions/p1"),
        "/repo",
        expect.objectContaining({
          body: { response: "once" },
        }),
      );
      expect(mockOcJson).toHaveBeenCalledWith(
        expect.stringContaining("/permissions/p_task"),
        "/repo",
        expect.objectContaining({
          body: { response: "reject" },
        }),
      );
      localStorage.removeItem("webui:subagent-permission");
    });

    it("フルアクセス切替時、スキル不許可なら残りの skill 権限を reject する", async () => {
      localStorage.setItem("webui:skill-permission", "deny");
      mockOcJson.mockResolvedValue({});
      const bashPerm = permissionItem();
      const skillPerm: AttentionItem = {
        kind: "permission",
        directory: "/repo",
        request: {
          id: "p_skill",
          version: "v1",
          sessionID: "ses_abc",
          permission: "skill",
          patterns: [],
          receivedAt: 2,
        },
      };
      attentionState.items = [bashPerm, skillPerm];
      attentionState.actionableItems = [bashPerm];
      attentionState.open = true;

      render(<AttentionQueueModal />);

      const select = screen.getByTitle("常に許可 / フルアクセス") as HTMLSelectElement;
      await act(async () => {
        select.value = "full";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(mockOcJson).toHaveBeenCalledWith(
        expect.stringContaining("/permissions/p1"),
        "/repo",
        expect.objectContaining({
          body: { response: "once" },
        }),
      );
      expect(mockOcJson).toHaveBeenCalledWith(
        expect.stringContaining("/permissions/p_skill"),
        "/repo",
        expect.objectContaining({
          body: { response: "reject" },
        }),
      );
      localStorage.removeItem("webui:skill-permission");
    });

    it("サブエージェント不許可の task 権限はモーダルに出さずレース承認を防ぐ", async () => {
      localStorage.setItem("webui:subagent-permission", "deny");
      const taskPerm: AttentionItem = {
        kind: "permission",
        directory: "/repo",
        request: {
          id: "p_task_current",
          version: "v1",
          sessionID: "ses_abc",
          permission: "task",
          patterns: [],
          receivedAt: 1,
        },
      };
      attentionState.items = [taskPerm];
      attentionState.actionableItems = [];
      attentionState.open = true;

      const { container } = render(<AttentionQueueModal />);

      expect(screen.queryByTitle("常に許可 / フルアクセス")).toBeNull();
      expect(container.querySelector('[class*="warning"]')).toBeNull();
      localStorage.removeItem("webui:subagent-permission");
    });

    it("PermissionCard re-enables its reply button after a 404 reply", async () => {
      const request = deferred<unknown>();
      mockOcJson.mockReturnValueOnce(request.promise);
      const item = permissionItem();
      enqueue(item);
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
      enqueue(item);
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
