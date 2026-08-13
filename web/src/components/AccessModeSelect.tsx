"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ACCESS_MODE_OPTIONS, type AccessMode } from "@/lib/access-mode";
import { PermissionGhostSelect } from "@/components/PermissionGhostSelect";

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
  return (
    <PermissionGhostSelect
      value={value}
      onChange={onChange}
      options={ACCESS_MODE_OPTIONS}
      disabled={disabled}
      className={className}
      ariaLabel="アクセスモード"
      icon={
        value === "full" ? (
          <ShieldAlert className="h-3.5 w-3.5" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )
      }
      tone={value === "full" ? "warning" : "default"}
    />
  );
}
