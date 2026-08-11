import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactSession,
  isAmbiguousCompactionFailure,
  isCompactionLockConflict,
  MessageRevertButton,
  useSessionActions,
} from "./SessionActions";
import type { MessageWithParts } from "@/lib/types";

const { ocJson } = vi.hoisted(() => ({ ocJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ ocJson }));

const messages: MessageWithParts[] = [
  {
    info: { id: "msg-1", role: "user" },
    parts: [{ id: "part-1", messageID: "msg-1", type: "text", text: "hello" }],
  },
  {
    info: { id: "msg-2", role: "user" },
    parts: [
      { id: "part-2a", messageID: "msg-2", type: "text", text: "look" },
      {
        id: "part-2b",
        messageID: "msg-2",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AA",
        filename: "shot.png",
      },
    ],
  },
];

describe("SessionActions error UX", () => {
  afterEach(() => {
    cleanup();
    ocJson.mockReset();
    vi.restoreAllMocks();
  });

  it("exposes compact failures inline without blocking the page", async () => {
    ocJson.mockRejectedValueOnce(new Error("compact failed"));
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useSessionActions({
        directory: "/repo",
        sessionId: "ses-1",
        messages,
      }),
    );

    act(() => result.current.compact());

    await waitFor(() => expect(result.current.error).toBe("compact failed"));
    expect(result.current.busy).toBeNull();
    expect(alert.mock.calls).toHaveLength(0);
  });

  it("does not submit the same session action twice before the first finishes", async () => {
    let release!: (value: unknown) => void;
    ocJson.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useSessionActions({
        directory: "/repo",
        sessionId: "ses-1",
        messages,
      }),
    );

    act(() => {
      result.current.compact();
      result.current.compact();
    });
    expect(ocJson).toHaveBeenCalledTimes(1);

    release({ ok: true });
    await waitFor(() => expect(result.current.busy).toBeNull());
  });

  it("opens an inline revert confirmation without using the native dialog", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() =>
      useSessionActions({
        directory: "/repo",
        sessionId: "ses-1",
        lastUserMessageId: "msg-1",
        messages,
      }),
    );

    act(() => result.current.revert());
    expect(result.current.revertConfirmOpen).toBe(true);
    act(() => result.current.cancelRevert());
    expect(result.current.revertConfirmOpen).toBe(false);

    act(() => {
      result.current.revert();
      result.current.confirmRevert();
    });
    await waitFor(() => expect(ocJson).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("passes text and image attachments to onRestore on revert", async () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() =>
      useSessionActions({
        directory: "/repo",
        sessionId: "ses-1",
        lastUserMessageId: "msg-2",
        messages,
        onRestore,
      }),
    );

    act(() => {
      result.current.revert();
      result.current.confirmRevert();
    });
    await waitFor(() => expect(ocJson).toHaveBeenCalledTimes(1));
    expect(onRestore).toHaveBeenCalledTimes(1);
    const [text, attachments] = onRestore.mock.calls[0]!;
    expect(text).toBe("look");
    expect(attachments).toEqual([
      expect.objectContaining({
        uri: "data:image/png;base64,AA",
        mime: "image/png",
        name: "shot.png",
        preview: "data:image/png;base64,AA",
      }),
    ]);
  });

  it("renders message revert failures as an accessible inline alert", async () => {
    ocJson.mockRejectedValueOnce(new Error("revert failed"));
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    render(
      <MessageRevertButton
        directory="/repo"
        sessionId="ses-1"
        messageId="msg-1"
        messages={messages}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("dialog").querySelector("button")!);

    const message = await screen.findByRole("alert");
    expect(message.textContent).toBe("revert failed");
    expect(alert.mock.calls).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull(),
    );
  });

  it("focuses the revert confirmation and closes it with Escape", () => {
    render(
      <MessageRevertButton
        directory="/repo"
        sessionId="ses-1"
        messageId="msg-1"
        messages={messages}
      />,
    );
    const trigger = screen.getByRole("button", { name: "入力欄に戻す" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const confirm = dialog.querySelector("button") as HTMLElement;
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("passes text and image attachments to onRestore via MessageRevertButton", async () => {
    const onRestore = vi.fn();
    render(
      <MessageRevertButton
        directory="/repo"
        sessionId="ses-1"
        messageId="msg-2"
        messages={messages}
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("dialog").querySelector("button")!);

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    const [text, attachments] = onRestore.mock.calls[0]!;
    expect(text).toBe("look");
    expect(attachments).toEqual([
      expect.objectContaining({
        uri: "data:image/png;base64,AA",
        mime: "image/png",
        name: "shot.png",
        preview: "data:image/png;base64,AA",
      }),
    ]);
  });
});

describe("compactSession lock handling", () => {
  afterEach(() => {
    ocJson.mockReset();
  });

  it("retries a session-lock conflict and succeeds after the owner releases", async () => {
    ocJson
      .mockRejectedValueOnce(
        Object.assign(new Error("session compaction already in progress"), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(undefined);

    await compactSession("/repo", "ses-1");

    expect(ocJson).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unrelated OpenCode 409", async () => {
    const error = Object.assign(new Error("session is busy"), { status: 409 });
    ocJson.mockRejectedValueOnce(error);

    await expect(compactSession("/repo", "ses-1")).rejects.toBe(error);
    expect(ocJson).toHaveBeenCalledTimes(1);
  });

  it("distinguishes the WebUI lock conflict from other errors", () => {
    expect(
      isCompactionLockConflict(
        Object.assign(new Error("session compaction already in progress"), {
          status: 409,
        }),
      ),
    ).toBe(true);
    expect(
      isCompactionLockConflict(
        Object.assign(new Error("session is busy"), { status: 409 }),
      ),
    ).toBe(false);
  });

  it("classifies timeouts, network errors, and server failures as ambiguous", () => {
    expect(isAmbiguousCompactionFailure(new Error("network error"))).toBe(true);
    expect(isAmbiguousCompactionFailure(Object.assign(new Error("timeout"), { status: 408 }))).toBe(true);
    expect(isAmbiguousCompactionFailure(Object.assign(new Error("server"), { status: 503 }))).toBe(true);
    expect(isAmbiguousCompactionFailure(Object.assign(new Error("not found"), { status: 404 }))).toBe(false);
  });
});
