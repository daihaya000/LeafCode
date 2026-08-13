import { Ban, Sparkles } from "lucide-react";
import {
  SKILL_PERMISSION_OPTIONS,
  type SkillPermission,
} from "@/lib/skill-permission";
import { PermissionGhostSelect } from "@/components/PermissionGhostSelect";

export function SkillPermissionSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: SkillPermission;
  onChange: (mode: SkillPermission) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <PermissionGhostSelect
      value={value}
      onChange={onChange}
      options={SKILL_PERMISSION_OPTIONS}
      disabled={disabled}
      className={className}
      ariaLabel="スキル"
      icon={
        value === "deny" ? (
          <Ban className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )
      }
      tone={value === "deny" ? "warning" : "default"}
    />
  );
}
