"use client";

import { MobileMenuButton } from "./MobileMenuButton";
import { AttentionBadge } from "./AttentionBadge";

/**
 * Minimal mobile-only header that keeps a navigation entry point on pages
 * without their own top bar (home, settings). Honors the top safe-area inset
 * and surfaces the global AttentionBadge. Hidden on md+ (desktop sidebar).
 */
export function MobileMenuHeader() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
      <MobileMenuButton />
      <div className="flex-1" />
      <AttentionBadge />
    </div>
  );
}
