"use client";

import { Menu } from "lucide-react";
import { cx } from "@/components/ui";
import { useShellMobileNav } from "./ShellContext";

/**
 * Hamburger trigger for the mobile navigation drawer (#mobile-nav).
 * Hidden on md+ (desktop keeps the persistent sidebar). 44px touch target.
 */
export function MobileMenuButton({ className }: { className?: string }) {
  const { mobileNavOpen, openMobileNav } = useShellMobileNav();
  return (
    <button
      type="button"
      aria-label="メニュー"
      aria-expanded={mobileNavOpen}
      aria-controls="mobile-nav"
      onClick={openMobileNav}
      className={cx(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text md:hidden",
        className,
      )}
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
