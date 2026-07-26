"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ACCESS_MODE_OPTIONS, type AccessMode } from "@/lib/access-mode";
import { GhostSelect } from "@/components/ui";

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
    <GhostSelect
      value={value}
      disabled={disabled}
      title={current?.title}
      aria-label="アクセスモード"
      icon={
        value === "full" ? (
          <ShieldAlert className="h-3.5 w-3.5" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )
      }
      valueLabel={current?.label ?? value}
      tone={value === "full" ? "warning" : "default"}
      onChange={(value) => onChange(value as AccessMode)}
      className={className}
    >
      {ACCESS_MODE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </GhostSelect>
  );
}
