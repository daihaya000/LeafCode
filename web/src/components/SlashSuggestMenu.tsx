"use client";

import { Sparkles } from "lucide-react";
import { cx } from "@/components/ui";
import type { SlashCommand } from "@/lib/slash-command";

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
  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="スラッシュコマンド"
      className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={item.name}
            type="button"
            role="option"
            id={`slash-cmd-${item.name}`}
            aria-selected={active}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(e) => {
              // Prevent textarea blur before click applies.
              e.preventDefault();
              onSelect(item);
            }}
            className={cx(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
              active ? "bg-accent" : "hover:bg-accent/60",
            )}
          >
            <Sparkles
              className={cx(
                "h-3.5 w-3.5 shrink-0",
                active ? "text-primary" : "text-muted",
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">
              <span
                className={cx(
                  "font-medium",
                  active ? "text-primary" : "text-fg",
                )}
              >
                {item.name}
              </span>
              {item.description ? (
                <span className="ml-2 text-xs text-muted">
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
