import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageRevertButton, useSessionActions } from "./SessionActions";
import type { MessageWithParts } from "@/lib/types";

const { ocJson } = vi.hoisted(() => ({ ocJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ ocJson }));

const messages: MessageWithParts[] = [
  {
    info: { id: "msg-1", role: "user" },
    parts: [{ id: "part-1", messageID: "msg-1", type: "text", text: "hello" }],
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

  it("renders message revert failures as an accessible inline alert", async () => {
    ocJson.mockRejectedValueOnce(new Error("revert failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
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

    const message = await screen.findByRole("alert");
    expect(message.textContent).toBe("revert failed");
    expect(alert.mock.calls).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull(),
    );
  });
});
