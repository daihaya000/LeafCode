import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getJson, ocJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  ocJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ getJson, ocJson, sendJson }));

import { SessionSwitcher } from "./SessionSwitcher";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionSwitcher controlled snap-back", () => {
  it("keeps the selected session after onChange without external reset", async () => {
    getJson.mockResolvedValue({
      sessions: [
        { opencodeSessionId: "ses_1", title: "Session 1", updatedAt: "t1" },
        { opencodeSessionId: "ses_2", title: "Session 2", updatedAt: "t2" },
      ],
    });
    sendJson.mockResolvedValue({});
    ocJson.mockResolvedValue({ id: "ses_new" });

    const onSwitch = vi.fn();
    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId="ses_1"
        onSwitch={onSwitch}
      />,
    );

    const select = await screen.findByRole("combobox", { name: "セッション切替" });
    expect((select as HTMLSelectElement).value).toBe("ses_1");

    fireEvent.change(select, { target: { value: "ses_2" } });

    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("ses_2");
    });
    expect(onSwitch).toHaveBeenCalled();
  });

  it("ignores a second session switch while the first is pending", async () => {
    getJson.mockResolvedValue({
      sessions: [
        { opencodeSessionId: "ses_1", title: "Session 1", updatedAt: "t1" },
        { opencodeSessionId: "ses_2", title: "Session 2", updatedAt: "t2" },
        { opencodeSessionId: "ses_3", title: "Session 3", updatedAt: "t3" },
      ],
    });
    let resolveBind: (value: unknown) => void = () => {};
    sendJson.mockImplementation(
      () => new Promise((resolve) => { resolveBind = resolve; }),
    );

    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId="ses_1"
        onSwitch={vi.fn()}
      />,
    );
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "ses_2" } });
    fireEvent.change(select, { target: { value: "ses_3" } });

    expect(sendJson).toHaveBeenCalledTimes(1);
    resolveBind({});
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
  });

  it("keeps the existing session choices visible when a refresh fails", async () => {
    getJson
      .mockResolvedValueOnce({
        sessions: [
          { opencodeSessionId: "ses_1", title: "Session 1", updatedAt: "t1" },
          { opencodeSessionId: "ses_2", title: "Session 2", updatedAt: "t2" },
        ],
      })
      .mockRejectedValueOnce(new Error("接続が切断されました"));

    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId="ses_1"
        onSwitch={vi.fn()}
      />,
    );

    const select = await screen.findByRole("combobox", { name: "セッション切替" });
    fireEvent.focus(select);

    const status = await screen.findByRole("combobox", { name: "セッション切替" });
    expect(status.querySelectorAll("option")).toHaveLength(2);
    expect(status.getAttribute("title")).toBe("接続が切断されました");
  });

  it("shows a loading state before allowing the first session to be added", async () => {
    getJson.mockReturnValue(new Promise(() => undefined));

    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId={null}
        onSwitch={vi.fn()}
      />,
    );

    const button = await screen.findByRole("button", { name: "セッション一覧を読み込み中" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("retries loading the session list after an error", async () => {
    getJson
      .mockRejectedValueOnce(new Error("session list unavailable"))
      .mockResolvedValueOnce({
        sessions: [
          { opencodeSessionId: "ses_1", title: "Session 1", updatedAt: "t1" },
          { opencodeSessionId: "ses_2", title: "Session 2", updatedAt: "t2" },
        ],
      });

    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId="ses_1"
        onSwitch={vi.fn()}
      />,
    );

    const retry = await screen.findByRole("button", {
      name: /session list unavailable/,
    });
    fireEvent.click(retry);

    await screen.findByRole("combobox");
    expect(screen.getByRole("option", { name: "Session 2" })).toBeTruthy();
  });

  it("does not let an old workspace refresh overwrite the new session list", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldRequest = new Promise((resolve) => {
      resolveOld = resolve;
    });
    let calls = 0;
    getJson.mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? oldRequest
        : Promise.resolve({
            sessions: [
              { opencodeSessionId: "new", title: "New", updatedAt: "t2" },
              { opencodeSessionId: "new-2", title: "New 2", updatedAt: "t2" },
            ],
          });
    });

    const { rerender } = render(
      <SessionSwitcher
        workspaceId="old"
        directory="/old"
        currentSessionId="old"
        onSwitch={vi.fn()}
      />,
    );
    rerender(
      <SessionSwitcher
        workspaceId="new"
        directory="/new"
        currentSessionId="new"
        onSwitch={vi.fn()}
      />,
    );

    await screen.findByRole("option", { name: "New" });
    await act(async () => {
      resolveOld({
        sessions: [
          { opencodeSessionId: "old", title: "Old", updatedAt: "t1" },
          { opencodeSessionId: "old-2", title: "Old 2", updatedAt: "t1" },
        ],
      });
    });

    expect(screen.queryByRole("option", { name: "Old" })).toBeNull();
  });

  it("announces a session switch failure and restores the real selection", async () => {
    getJson.mockResolvedValue({
      sessions: [
        { opencodeSessionId: "ses_1", title: "Session 1", updatedAt: "t1" },
        { opencodeSessionId: "ses_2", title: "Session 2", updatedAt: "t2" },
      ],
    });
    sendJson.mockRejectedValue(new Error("切替に失敗しました"));

    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId="ses_1"
        onSwitch={vi.fn()}
      />,
    );
    const select = await screen.findByRole("combobox", { name: "セッション切替" });
    fireEvent.change(select, { target: { value: "ses_2" } });

    expect(await screen.findByText("セッション切替に失敗しました")).toBeTruthy();
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("ses_1"));
    expect(screen.getByRole("status").getAttribute("title")).toBe("切替に失敗しました");
  });
});
