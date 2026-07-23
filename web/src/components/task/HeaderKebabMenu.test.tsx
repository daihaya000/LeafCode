import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeaderKebabMenu } from "./HeaderKebabMenu";

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

  it("closes when the trigger is clicked while a popup item is focused", async () => {
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

    fireEvent.pointerDown(trigger);
    item.blur();
    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
