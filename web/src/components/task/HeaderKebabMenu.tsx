"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";

export type KebabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  active?: boolean;
  danger?: boolean;
};

export type KebabGroup = {
  id: string;
  label?: string;
  items: KebabItem[];
  /** 指定時は items ではなく、この内容をグループ内に描画する。 */
  renderContent?: () => ReactNode;
};

/**
 * Self-contained kebab dropdown for the TaskView header toolbar.
 *
 * - trigger: ghost icon button with MoreHorizontal
 * - popup: absolute, bottom-right of trigger, shadow-lg, bg-surface border-border
 * - keyboard: ArrowUp/Down to move (skip disabled), Enter/Space to run,
 *   Escape to close, and natural Tab traversal (leaving the popup closes it)
 * - outside click closes
 *
 * No new design tokens; only existing globals.css variables + Tailwind std classes.
 * z-30 keeps the popup above sticky headers (z-10) and the composer's slash
 * suggest (z-20) while staying below modals (z-40+).
 */
export function HeaderKebabMenu({
  groups,
  ariaLabel = "タスクその他操作",
  triggerLabel = "その他の操作",
}: {
  groups: KebabGroup[];
  ariaLabel?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const menuId = useId();
  // Captures `open` at trigger pointerdown time. In real browsers, mousedown on
  // the trigger moves focus away from a focused popup item *before* the click
  // event fires, which would otherwise let the popup's onBlurCapture close the
  // menu first and then have the trigger's onClick read the already-updated
  // (closed) `open` state and toggle it back open. While this ref is non-null,
  // the popup's blur-close is suppressed and the trigger's click resolves the
  // open/close decision from the state captured before the gesture started.
  const pointerDownOpenRef = useRef<boolean | null>(null);

  // Flatten visible (non-disabled-skipped) item ids in render order.
  const flatItems = groups.flatMap((g) => (g.renderContent ? [] : g.items));
  const focusableIds = flatItems
    .filter((it) => !it.disabled)
    .map((it) => it.id);

  const focusItem = useCallback((id: string) => {
    const el = itemRefs.current.get(id);
    el?.focus();
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // When opening, focus the first focusable item.
  useEffect(() => {
    if (!open) return;
    const first = focusableIds[0];
    if (!first) return;
    // Wait a tick for the popup to mount.
    const t = window.setTimeout(() => focusItem(first), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = useCallback(
    (dir: 1 | -1, currentId: string) => {
      const idx = focusableIds.indexOf(currentId);
      if (idx === -1) return;
      const next = (idx + dir + focusableIds.length) % focusableIds.length;
      focusItem(focusableIds[next]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusableIds.join("|")],
  );

  const visibleGroups = groups.filter(
    (g) => g.items.length > 0 || g.renderContent !== undefined,
  );
  if (visibleGroups.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={triggerLabel}
        title={triggerLabel}
        onPointerDown={() => {
          pointerDownOpenRef.current = open;
          // Safety net: if no click follows this pointerdown (e.g. the
          // pointer is dragged off and released elsewhere), don't leave the
          // popup's blur-close suppressed forever.
          window.setTimeout(() => {
            pointerDownOpenRef.current = null;
          }, 0);
        }}
        onClick={() => {
          const openBeforeGesture = pointerDownOpenRef.current;
          pointerDownOpenRef.current = null;
          setOpen(!(openBeforeGesture ?? open));
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          ref={popupRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onBlurCapture={(event) => {
            // A trigger pointerdown→click gesture is in flight: let the
            // trigger's onClick own the open/close decision instead of
            // closing here (see pointerDownOpenRef above).
            if (pointerDownOpenRef.current !== null) return;
            const next = event.relatedTarget as Node | null;
            if (!next || !popupRef.current?.contains(next)) close(false);
          }}
          className="absolute right-0 top-full z-30 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {visibleGroups.map((group, gi) => (
            <div
              key={group.id}
              role={group.label ? "group" : undefined}
              aria-label={group.label}
              className={cx(gi > 0 && "mt-1 border-t border-border pt-1")}
            >
              {group.renderContent ? (
                group.renderContent()
              ) : (
                group.items.map((item) => {
                const isDisabled = !!item.disabled;
                return (
                  <div
                    key={item.id}
                    ref={(el) => {
                      itemRefs.current.set(item.id, el);
                    }}
                    role="menuitem"
                    aria-disabled={isDisabled ? "true" : undefined}
                    aria-current={item.active ? "true" : undefined}
                    tabIndex={isDisabled ? -1 : 0}
                    title={item.label}
                    onClick={() => {
                      if (isDisabled) return;
                      item.onSelect();
                      close(true);
                    }}
                    onKeyDown={(e) => {
                      if (isDisabled) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        item.onSelect();
                        close(true);
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        move(1, item.id);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        move(-1, item.id);
                        return;
                      }
                      if (e.key === "Tab") {
                        return;
                      }
                    }}
                    className={cx(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs outline-none transition-colors",
                      "focus:bg-surface-2 focus:text-text",
                      item.danger
                        ? "text-danger hover:bg-danger-bg"
                        : "text-muted hover:bg-surface-2 hover:text-text",
                      isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                    )}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {item.busy ? <Spinner className="h-3.5 w-3.5" /> : item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.active && (
                      <span
                        aria-hidden="true"
                        className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
                      />
                    )}
                  </div>
                );
                })
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
