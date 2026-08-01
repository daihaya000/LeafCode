import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSwitcherDialog } from "./SessionSwitcherDialog";

vi.mock("./SessionSwitcher", () => ({
  SessionSwitcher: ({ onSwitch }: { onSwitch: () => void }) => (
    <div data-testid="session-switcher">
      <select aria-label="セッション切替">
        <option value="sess1">Session 1</option>
      </select>
      <button type="button" aria-label="新セッション" onClick={onSwitch}>
        追加
      </button>
    </div>
  ),
}));

afterEach(() => cleanup());

function renderDialog({
  onClose = vi.fn(),
  onSwitch = vi.fn().mockResolvedValue(undefined),
}: {
  onClose?: ReturnType<typeof vi.fn>;
  onSwitch?: ReturnType<typeof vi.fn>;
} = {}) {
  render(
    <SessionSwitcherDialog
      workspaceId="ws1"
      directory="/repo"
      currentSessionId="sess1"
      onSwitch={onSwitch}
      onClose={onClose}
    />,
  );
  return { onClose, onSwitch };
}

describe("SessionSwitcherDialog", () => {
  it("provides an accessible dialog and focuses the first control", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "セッションを切り替え・追加" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBe("session-switcher-desc");
    expect(screen.getByTestId("session-switcher")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "セッション切替" }),
      );
    });
  });

  it("traps Tab and Shift+Tab at the dialog boundaries", async () => {
    renderDialog();
    const select = screen.getByRole("combobox", { name: "セッション切替" });
    const create = screen.getByRole("button", { name: "新セッション" });
    await waitFor(() => expect(document.activeElement).toBe(select));

    create.focus();
    const tab = createEvent.keyDown(create, { key: "Tab" });
    fireEvent(create, tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(select);

    const shiftTab = createEvent.keyDown(select, { key: "Tab", shiftKey: true });
    fireEvent(select, shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(create);
  });

  it("closes with Escape or a backdrop click, but not a dialog click", () => {
    const { onClose } = renderDialog();
    const dialog = screen.getByRole("dialog");

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores focus to the opener when the parent removes the dialog", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "セッションメニュー";
    document.body.appendChild(opener);
    opener.focus();

    const view = render(<button type="button">起点</button>);
    view.rerender(
      <>
        <button type="button">起点</button>
        <SessionSwitcherDialog
          workspaceId="ws1"
          directory="/repo"
          currentSessionId="sess1"
          onSwitch={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </>,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "セッション切替" }),
      );
    });

    view.rerender(<button type="button">起点</button>);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it("delegates successful session actions without closing or refreshing itself", () => {
    const { onClose, onSwitch } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "新セッション" }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
