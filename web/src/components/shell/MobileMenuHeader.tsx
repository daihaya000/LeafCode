"use client";

import { MobileMenuButton } from "./MobileMenuButton";
import { AttentionBadge } from "./AttentionBadge";
import { useMobileScrollTargetCurrent } from "./MobileScrollTargetContext";

/**
 * Minimal mobile-only header that keeps a navigation entry point on pages
 * without their own top bar (home, settings). Honors the top safe-area inset
 * and surfaces the global AttentionBadge. Hidden on md+ (desktop sidebar).
 *
 * The center area is a double-tap target that scrolls the current page's
 * primary scrollable region back to the top, matching iOS-style behavior.
 */
export function MobileMenuHeader() {
  const scrollTarget = useMobileScrollTargetCurrent();

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
      <MobileMenuButton />
      <button
        type="button"
        aria-label="ダブルタップで最上段へスクロール"
        className="flex min-h-11 flex-1 cursor-pointer touch-manipulation appearance-none items-center justify-center border-0 bg-transparent p-0"
        onDoubleClick={() => {
          const el = scrollTarget;
          if (!el) return;
          el.scrollTop = 0;
        }}
      >
        <span className="sr-only">ダブルタップで最上段へスクロール</span>
      </button>
      <AttentionBadge />
    </div>
  );
}
