import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderKebabMenu } from "./HeaderKebabMenu";

afterEach(() => cleanup());

describe("HeaderKebabMenu", () => {
  it("renders custom group content, skips it with arrows, and preserves Tab traversal", async () => {
    const onSelect = vi.fn();
    render(
      <>
        <HeaderKebabMenu
          groups={[
            {
              id: "first",
              label: "先頭",
              items: [{ id: "first-item", label: "先頭の操作", onSelect }],
            },
            {
              id: "session-switcher",
              label: "セッション切替",
              items: [{ id: "ignored", label: "描画されない操作", onSelect }],
              renderContent: () => (
                <div>
                  <select aria-label="セッション切替">
                    <option>Session 1</option>
                  </select>
                  <button type="button" aria-label="新セッション">
                    追加
                  </button>
                </div>
              ),
            },
            {
              id: "last",
              label: "末尾",
              items: [{ id: "last-item", label: "末尾の操作", onSelect }],
            },
          ]}
        />
        <button type="button">メニュー外</button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
    const first = await screen.findByRole("menuitem", { name: "先頭の操作" });
    const last = screen.getByRole("menuitem", { name: "末尾の操作" });
    const select = screen.getByRole("combobox", { name: "セッション切替" });

    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(screen.queryByRole("menuitem", { name: "描画されない操作" })).toBeNull();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    const tab = createEvent.keyDown(first, { key: "Tab" });
    fireEvent(first, tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();

    // JSDOM は Tab のブラウザ既定フォーカス移動を実行しないため、移動先だけを再現する。
    (select as HTMLSelectElement).focus();
    expect(document.activeElement).toBe(select);
    const add = screen.getByRole("button", { name: "新セッション" });
    const customTab = createEvent.keyDown(select, { key: "Tab" });
    fireEvent(select, customTab);
    expect(customTab.defaultPrevented).toBe(false);
    (add as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(add);
  });

  it("closes (and does not reopen) when the trigger is clicked while a popup item is focused", async () => {
    // Reproduces the real-browser event order: mousedown on the trigger
    // moves focus away from the focused popup item (firing blur with
    // relatedTarget = the trigger) *before* the click event fires. A naive
    // `onClick={() => setOpen(!open)}` would read the just-closed `open`
    // state and reopen the menu; this must not happen.
    render(
      <HeaderKebabMenu
        groups={[
          {
            id: "actions",
            items: [{ id: "action", label: "操作", onSelect: vi.fn() }],
          },
        ]}
        triggerLabel="テストメニュー"
      />,
    );

    const trigger = screen.getByRole("button", { name: "テストメニュー" });
    fireEvent.click(trigger);
    const item = await screen.findByRole("menuitem", { name: "操作" });
    await waitFor(() => expect(document.activeElement).toBe(item));

    // pointerdown -> mousedown moves focus to the trigger, blurring the item
    // with relatedTarget pointing at the trigger -> mouseup -> click.
    fireEvent.pointerDown(trigger);
    fireEvent.blur(item, { relatedTarget: trigger });
    trigger.focus();
    expect(screen.queryByRole("menu")).toBeTruthy(); // blur-close is suppressed mid-gesture
    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("still opens on a plain click of the trigger", () => {
    render(
      <HeaderKebabMenu
        groups={[
          {
            id: "actions",
            items: [{ id: "action", label: "操作", onSelect: vi.fn() }],
          },
        ]}
        triggerLabel="テストメニュー"
      />,
    );

    const trigger = screen.getByRole("button", { name: "テストメニュー" });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes on outside click and does not reopen via a stray pointerdown-only gesture", async () => {
    render(
      <>
        <HeaderKebabMenu
          groups={[
            {
              id: "actions",
              items: [{ id: "action", label: "操作", onSelect: vi.fn() }],
            },
          ]}
          triggerLabel="テストメニュー"
        />
        <button type="button">外側</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "テストメニュー" });
    fireEvent.click(trigger);
    await screen.findByRole("menuitem", { name: "操作" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "外側" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
