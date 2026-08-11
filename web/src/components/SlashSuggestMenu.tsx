"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cx } from "@/components/ui";
import { isSkillCommand, type SlashCommand } from "@/lib/slash-command";

export function SlashSuggestMenu({
  items,
  activeIndex,
  onHover,
  onSelect,
}: {
  items: SlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
}) {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const active = items[activeIndex];
    if (!active) return;
    const element = itemRefs.current.get(active.name);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, items]);

  if (items.length === 0) return null;

  return (
    <div
      id="slash-suggest-listbox"
      role="listbox"
      aria-label="スラッシュコマンド"
      className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        const isSkill = item.source === "skill";
        return (
          <button
            key={item.name}
            ref={(element) => {
              if (element) itemRefs.current.set(item.name, element);
              else itemRefs.current.delete(item.name);
            }}
            type="button"
            role="option"
            id={`slash-cmd-${item.name}`}
            aria-selected={active}
            title={item.description || undefined}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(e) => {
              // Prevent textarea blur before click applies.
              e.preventDefault();
              onSelect(item);
            }}
            className={cx(
              "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors",
              active
                ? "border-l-2 border-accent bg-working-bg pl-2.5"
                : "border-l-2 border-transparent hover:bg-surface-2",
            )}
          >
            <Sparkles
              className={cx(
                "mt-0.5 h-3.5 w-3.5 shrink-0",
                isSkill || active ? "text-accent" : "text-muted",
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span
                className={cx(
                  "block truncate font-semibold",
                  isSkill
                    ? "text-accent"
                    : active
                      ? "text-text"
                      : "text-fg",
                )}
              >
                {item.name}
              </span>
              {item.description ? (
                <span
                  className={cx(
                    "mt-0.5 block line-clamp-2 text-xs leading-4",
                    active ? "text-text/70" : "text-muted",
                  )}
                >
                  {item.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
