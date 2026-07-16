"use client";

import { ACCESS_MODE_OPTIONS, type AccessMode } from "@/lib/access-mode";
import { cx } from "@/components/ui";

export function AccessModeSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: AccessMode;
  onChange: (mode: AccessMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  const current = ACCESS_MODE_OPTIONS.find((o) => o.value === value);
  return (
    <select
      value={value}
      disabled={disabled}
      title={current?.title}
      onChange={(e) => onChange(e.target.value as AccessMode)}
      className={cx(
        "h-8 max-w-36 shrink-0 cursor-pointer rounded-lg border px-2 text-xs font-medium outline-none disabled:opacity-50",
        value === "full"
          ? "border-warning/50 bg-warning-bg text-warning hover:border-warning"
          : "border-border bg-surface-2 text-muted hover:text-text",
        className,
      )}
    >
      {ACCESS_MODE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
