import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderKebabMenu, type KebabGroup } from "./HeaderKebabMenu";

const standardGroup: KebabGroup = {
  id: "standard",
  items: [],
  // @ts-expect-error HeaderKebabMenu accepts standard KebabItem groups only.
  renderContent: () => null,
};
void standardGroup;

afterEach(() => cleanup());

describe("HeaderKebabMenu", () => {
  it("renders only standard menuitems and supports roving focus", async () => {
    const onFirst = vi.fn();
    const onLast = vi.fn();
    render(
      <HeaderKebabMenu
        groups={[
          {
            id: "first",
            label: "先頭",
            items: [{ id: "first-item", label: "先頭の操作", onSelect: onFirst }],
          },
          {
            id: "middle",
            label: "中央",
            items: [{ id: "disabled", label: "無効な操作", onSelect: vi.fn(), disabled: true }],
          },
          {
            id: "last",
            label: "末尾",
            items: [{ id: "last-item", label: "末尾の操作", onSelect: onLast }],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
    const menu = screen.getByRole("menu");
    const first = await screen.findByRole("menuitem", { name: "先頭の操作" });
    const last = screen.getByRole("menuitem", { name: "末尾の操作" });

    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(within(menu).getByRole("group", { name: "先頭" })).toBeTruthy();
    expect(within(menu).getByRole("group", { name: "中央" })).toBeTruthy();
    expect(within(menu).getByRole("group", { name: "末尾" })).toBeTruthy();
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(within(menu).queryByRole("combobox")).toBeNull();
    expect(within(menu).queryByRole("button")).toBeNull();
    expect(within(menu).queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Enter" });
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "その他の操作" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "末尾の操作" }), { key: " " });
    expect(onLast).toHaveBeenCalledTimes(1);
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

  it("renders the popup in a portal so mobile toolbar overflow does not clip it", () => {
    render(
      <div style={{ overflowX: "auto", width: 40 }}>
        <HeaderKebabMenu
          groups={[
            {
              id: "actions",
              items: [{ id: "action", label: "操作", onSelect: vi.fn() }],
            },
          ]}
          triggerLabel="テストメニュー"
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "テストメニュー" }));

    expect(screen.getByRole("menu").parentElement).toBe(document.body);
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
