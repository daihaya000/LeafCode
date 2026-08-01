import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

afterEach(cleanup);

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onChange = vi.fn();
  const onKeyDown = vi.fn();
  const onRemoveAttachment = vi.fn();
  const onFilesSelected = vi.fn();
  const onTrigger = vi.fn();
  const onSelect = vi.fn();
  const textareaRef = createRef<HTMLTextAreaElement>();
  const inputRef = createRef<HTMLInputElement>();

  render(
    <Composer
      className="composer"
      attachments={[
        { uri: "data:image/png;base64,AA", mime: "image/png", name: "image.png" },
      ]}
      onRemoveAttachment={onRemoveAttachment}
      attachmentRemovalLabel={(attachment) => `${attachment.name}を削除`}
      slash={{
        items: [{ name: "review" }],
        activeIndex: 0,
        onHover: vi.fn(),
        onSelect,
      }}
      textarea={{
        ref: textareaRef,
        value: "/rev",
        rows: 1,
        ariaLabel: "プロンプト",
        placeholder: "入力",
        className: "textarea",
        onChange,
        onClick: vi.fn(),
        onKeyUp: vi.fn(),
        onSelect: vi.fn(),
        onPaste: vi.fn(),
        onCompositionStart: vi.fn(),
        onCompositionEnd: vi.fn(),
        onKeyDown,
      }}
      attachmentControl={{
        inputRef,
        buttonTitle: "画像を添付",
        onFilesSelected,
        onTrigger,
      }}
      toolbar={<span>設定</span>}
      action={<button type="button">送信</button>}
      {...overrides}
    />,
  );

  return { onChange, onKeyDown, onRemoveAttachment, onFilesSelected, onTrigger, onSelect };
}

describe("Composer", () => {
  it("exposes the horizontally scrollable toolbar as a keyboard-focusable group", () => {
    renderComposer();

    const toolbar = screen.getByRole("group", { name: "タスク設定" });
    expect(toolbar.getAttribute("tabindex")).toBe("0");
    expect(toolbar.className).toContain("overflow-x-auto");
  });

  it("keeps the input controlled and delegates input events to its parent", () => {
    const { onChange, onKeyDown } = renderComposer();
    const textarea = screen.getByRole("combobox", { name: "プロンプト" });

    expect((textarea as HTMLTextAreaElement).value).toBe("/rev");
    expect(textarea.getAttribute("aria-controls")).toBe("slash-suggest-listbox");
    fireEvent.change(textarea, { target: { value: "next" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("renders attachment controls without owning attachment state", () => {
    const { onRemoveAttachment, onTrigger } = renderComposer();
    const removeButton = screen.getByRole("button", { name: "image.pngを削除" });

    expect(removeButton.className).toContain("min-h-6");
    expect(removeButton.className).toContain("min-w-6");

    fireEvent.click(removeButton);
    fireEvent.click(screen.getByRole("button", { name: "画像を添付" }));

    expect(onRemoveAttachment).toHaveBeenCalledWith(0);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(screen.getByText("設定")).toBeTruthy();
    expect(screen.getByRole("button", { name: "送信" })).toBeTruthy();
  });

  it("preserves the parent-selected root semantics for the home form", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    renderComposer({ form: { ariaLabel: "タスク作成", onSubmit } });

    fireEvent.submit(screen.getByRole("form", { name: "タスク作成" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("forwards attachment drag events through the home form path", () => {
    const onDrop = vi.fn();
    const onDragOver = vi.fn();
    renderComposer({
      form: { ariaLabel: "タスク作成", onSubmit: vi.fn() },
      onDrop,
      onDragOver,
    });

    const form = screen.getByRole("form", { name: "タスク作成" });
    fireEvent.dragOver(form);
    fireEvent.drop(form);

    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
