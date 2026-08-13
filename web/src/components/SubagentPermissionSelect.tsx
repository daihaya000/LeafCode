"use client";

import { Bot, BotOff } from "lucide-react";
import {
  SUBAGENT_PERMISSION_OPTIONS,
  type SubagentPermission,
} from "@/lib/subagent-permission";
import { PermissionGhostSelect } from "@/components/PermissionGhostSelect";

export function SubagentPermissionSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: SubagentPermission;
  onChange: (mode: SubagentPermission) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <PermissionGhostSelect
      value={value}
      onChange={onChange}
      options={SUBAGENT_PERMISSION_OPTIONS}
      disabled={disabled}
      className={className}
      ariaLabel="サブエージェント"
      icon={
        value === "deny" ? (
          <BotOff className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )
      }
      tone={value === "deny" ? "warning" : "default"}
    />
  );
}
