"use client";

import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  CompositionEventHandler,
  CSSProperties,
  DragEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  RefObject,
  ReactEventHandler,
  ReactNode,
  UIEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { SlashSuggestMenu } from "@/components/SlashSuggestMenu";
import {
  segmentSkillHighlights,
  skillDescriptionAt,
  type SlashCommand,
} from "@/lib/slash-command";

export type ComposerAttachment = {
  uri: string;
  mime: string;
  name?: string;
  preview?: string;
};

type ComposerProps = {
  className: string;
  form?: {
    ariaLabel: string;
    onSubmit: FormEventHandler<HTMLFormElement>;
  };
  onDrop?: DragEventHandler<HTMLElement>;
  onDragOver?: DragEventHandler<HTMLElement>;
  slash?: {
    items: SlashCommand[];
    activeIndex: number;
    onHover: (index: number) => void;
    onSelect: (command: SlashCommand) => void;
  };
  /** Known slash commands; skills (source=skill) render blue with hover titles. */
  commands?: SlashCommand[];
  attachments: ComposerAttachment[];
  onRemoveAttachment: (index: number) => void;
  attachmentRemovalDisabled?: boolean;
  attachmentRemovalLabel: (attachment: ComposerAttachment, index: number) => string;
  textarea: {
    ref: RefObject<HTMLTextAreaElement | null>;
    value: string;
    rows: number;
    ariaLabel: string;
    busy?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    placeholder: string;
    className: string;
    style?: CSSProperties;
    onChange: ChangeEventHandler<HTMLTextAreaElement>;
    onClick: MouseEventHandler<HTMLTextAreaElement>;
    onKeyUp: KeyboardEventHandler<HTMLTextAreaElement>;
    onSelect: ReactEventHandler<HTMLTextAreaElement>;
    onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
    onCompositionStart: CompositionEventHandler<HTMLTextAreaElement>;
    onCompositionEnd: CompositionEventHandler<HTMLTextAreaElement>;
    onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  };
  afterTextarea?: ReactNode;
  attachmentControl: {
    inputRef: RefObject<HTMLInputElement | null>;
    inputDisabled?: boolean;
    inputAriaLabel?: string;
    buttonDisabled?: boolean;
    buttonTitle: string;
    buttonClassName?: string;
    onFilesSelected: (files: FileList) => void;
    onTrigger: () => void;
  };
  toolbar: ReactNode;
  action: ReactNode;
};

/**
 * Stateless, controlled composer presentation shared by task creation and
 * follow-up messages. Parents retain all state, request handling, drafts, and
 * keyboard policy; this component only renders and forwards input events.
 */
export function Composer({
  className,
  form,
  onDrop,
  onDragOver,
  slash,
  commands = [],
  attachments,
  onRemoveAttachment,
  attachmentRemovalDisabled,
  attachmentRemovalLabel,
  textarea,
  afterTextarea,
  attachmentControl,
  toolbar,
  action,
}: ComposerProps) {
  const slashOpen = Boolean(slash && slash.items.length > 0);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const highlightSegments = useMemo(
    () => segmentSkillHighlights(textarea.value, commands),
    [textarea.value, commands],
  );
  const hasSkillHighlight = highlightSegments.some((s) => s.kind === "skill");
  const skillTitle = useMemo(
    () => skillDescriptionAt(textarea.value, commands, caret),
    [textarea.value, commands, caret],
  );

  useEffect(() => {
    const el = textarea.ref.current;
    const mirror = highlightRef.current;
    if (!el || !mirror) return;
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
  }, [textarea.value, textarea.ref]);

  const syncHighlightScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const mirror = highlightRef.current;
    if (!mirror) return;
    mirror.scrollTop = event.currentTarget.scrollTop;
    mirror.scrollLeft = event.currentTarget.scrollLeft;
  };

  const trackCaret = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? 0);
  };

  const content = (
    <>
      {slashOpen && slash && (
        <SlashSuggestMenu
          items={slash.items}
          activeIndex={slash.activeIndex}
          onHover={slash.onHover}
          onSelect={slash.onSelect}
        />
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment, index) => (
            <div
              key={`${attachment.name ?? attachment.uri}-${index}`}
              className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface"
            >
              {attachment.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.preview}
                  alt={attachment.name ?? "添付画像"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-faint">
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(index)}
                disabled={attachmentRemovalDisabled}
                aria-label={attachmentRemovalLabel(attachment, index)}
                className="absolute right-0.5 top-0.5 min-h-6 min-w-6 rounded-full bg-bg/80 p-0.5 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 max-sm:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="relative">
        {hasSkillHighlight && (
          <div
            ref={highlightRef}
            aria-hidden="true"
            className={`${textarea.className} pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words text-text caret-transparent`}
            style={{
              ...textarea.style,
              color: "inherit",
            }}
          >
            {highlightSegments.map((segment, index) =>
              segment.kind === "skill" ? (
                <span
                  key={`skill-${index}-${segment.name}`}
                  className="font-medium text-accent"
                  title={segment.description}
                >
                  {segment.text}
                </span>
              ) : (
                <span key={`text-${index}`}>{segment.text}</span>
              ),
            )}
            {"\n"}
          </div>
        )}
        <textarea
          ref={textarea.ref}
          value={textarea.value}
          rows={textarea.rows}
          style={textarea.style}
          aria-label={textarea.ariaLabel}
          role="combobox"
          aria-busy={textarea.busy || undefined}
          aria-autocomplete="list"
          aria-controls={slashOpen ? "slash-suggest-listbox" : undefined}
          aria-expanded={slashOpen}
          aria-activedescendant={
            slashOpen && slash?.items[slash.activeIndex]
              ? `slash-cmd-${slash.items[slash.activeIndex].name}`
              : undefined
          }
          title={skillTitle}
          disabled={textarea.disabled}
          readOnly={textarea.readOnly}
          onChange={(event) => {
            trackCaret(event.currentTarget);
            textarea.onChange(event);
          }}
          onClick={(event) => {
            trackCaret(event.currentTarget);
            textarea.onClick(event);
          }}
          onKeyUp={(event) => {
            trackCaret(event.currentTarget);
            textarea.onKeyUp(event);
          }}
          onSelect={(event) => {
            trackCaret(event.currentTarget);
            textarea.onSelect(event);
          }}
          onPaste={textarea.onPaste}
          onCompositionStart={textarea.onCompositionStart}
          onCompositionEnd={textarea.onCompositionEnd}
          onKeyDown={textarea.onKeyDown}
          onScroll={syncHighlightScroll}
          placeholder={textarea.placeholder}
          className={
            hasSkillHighlight
              ? `${textarea.className} relative z-10 text-transparent caret-[var(--text)] selection:bg-accent/25`
              : textarea.className
          }
        />
      </div>
      {afterTextarea}
      <div className="flex items-center gap-2 pt-1">
        <div className="relative min-w-0 flex-1 overflow-x-auto">
          <div
            role="group"
            aria-label="タスク設定"
            tabIndex={0}
            className="flex min-w-0 items-center gap-2 overflow-x-auto rounded-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
          <input
            ref={attachmentControl.inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={attachmentControl.inputDisabled}
            aria-label={attachmentControl.inputAriaLabel}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) attachmentControl.onFilesSelected(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={attachmentControl.onTrigger}
            disabled={attachmentControl.buttonDisabled}
            aria-label="画像を添付"
            title={attachmentControl.buttonTitle}
            className={attachmentControl.buttonClassName ?? "flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg px-2 text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"}
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {toolbar}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-md bg-gradient-to-l from-bg to-transparent sm:hidden"
          />
        </div>
        {action}
      </div>
    </>
  );

  if (form) {
    return (
      <form
        aria-label={form.ariaLabel}
        className={className}
        onSubmit={form.onSubmit}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        {content}
      </form>
    );
  }

  return (
    <div className={className} onDrop={onDrop} onDragOver={onDragOver}>
      {content}
    </div>
  );
}
