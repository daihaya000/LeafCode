"use client";

import React, {
  ButtonHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  forwardRef,
} from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Loader2, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export { cx };

export function GhostSelect({
  icon,
  valueLabel,
  tone = "default",
  className,
  selectClassName,
  disabled,
  children,
  ...selectProps
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "disabled"> & {
  icon: ReactNode;
  valueLabel: ReactNode;
  tone?: "default" | "warning";
  className?: string;
  selectClassName?: string;
  disabled?: boolean;
}) {
  return (
    <span
      className={cx(
        "group relative inline-flex min-w-0 items-center gap-1.5 rounded-lg border bg-bg px-2 py-1.5 text-xs font-medium shadow-sm transition-colors focus-within:ring-2 focus-within:ring-primary/30",
        tone === "warning"
          ? "border-warning/40 text-warning hover:bg-warning-bg focus-within:bg-warning-bg"
          : "border-border text-muted hover:bg-surface-2 hover:text-text focus-within:border-border-strong focus-within:bg-surface-2 focus-within:text-text",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span aria-hidden="true" className="min-w-0 truncate">
        {valueLabel}
      </span>
      <span aria-hidden="true" className="shrink-0 text-faint">
        <ChevronDown className="h-3.5 w-3.5" />
      </span>
      <select
        {...selectProps}
        disabled={disabled}
        className={cx(
          "absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed",
          selectClassName,
        )}
      >
        {children}
      </select>
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg hover:opacity-90 disabled:opacity-40 font-medium",
  secondary:
    "bg-surface-2 text-text hover:bg-surface-3 disabled:opacity-40 border border-border",
  outline:
    "bg-transparent text-text hover:bg-surface-2 disabled:opacity-40 border border-border-strong",
  ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40",
  danger:
    "bg-danger-bg text-danger hover:opacity-80 disabled:opacity-40 border border-danger/30",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs rounded-lg gap-1.5",
  md: "h-10 px-3.5 text-sm rounded-lg gap-2",
  lg: "h-12 px-5 text-sm rounded-xl gap-2",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    busy?: boolean;
  }
>(function Button(
  { variant = "secondary", size = "md", busy, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors select-none disabled:cursor-not-allowed",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export function Badge({
  tone = "neutral",
  children,
  pulse,
  className,
}: {
  tone?: "neutral" | "working" | "success" | "warning" | "danger";
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-2 text-muted border-border",
    working: "bg-working-bg text-working border-working/25",
    success: "bg-success-bg text-success border-success/25",
    warning: "bg-warning-bg text-warning border-warning/25",
    danger: "bg-danger-bg text-danger border-danger/25",
  };
  const dotColor: Record<string, string> = {
    neutral: "bg-faint",
    working: "bg-working",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          dotColor[tone],
          pulse && "status-pulse",
        )}
      />
      {children}
    </span>
  );
}

export function DiffStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      <span className="text-success">+{additions}</span>
      <span className="text-danger">−{deletions}</span>
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-4 w-4 animate-spin text-muted", className)} />;
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-9 w-9" />;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="テーマ切替"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4.5 w-4.5" />
      ) : (
        <Moon className="h-4.5 w-4.5" />
      )}
    </Button>
  );
}

/** Format an absolute date/time for message timestamps. */
export function formatMessageTime(
  iso: string | number | null | undefined,
): string {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Codex-like relative time: 3m / 2h / 5d */
export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return "たった今";
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}日前`;
  return new Date(t).toLocaleDateString();
}
