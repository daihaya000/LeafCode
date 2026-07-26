import { Ban, Sparkles } from "lucide-react";
import {
  SKILL_PERMISSION_OPTIONS,
  type SkillPermission,
} from "@/lib/skill-permission";
import { GhostSelect } from "@/components/ui";

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
  const current = SKILL_PERMISSION_OPTIONS.find((o) => o.value === value);
  return (
    <GhostSelect
      value={value}
      disabled={disabled}
      title={current?.title}
      aria-label="スキル"
      icon={
        value === "deny" ? (
          <Ban className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )
      }
      valueLabel={current?.label ?? value}
      tone={value === "deny" ? "warning" : "default"}
      onChange={(value) => onChange(value as SkillPermission)}
      className={className}
    >
      {SKILL_PERMISSION_OPTIONS.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </GhostSelect>
  );
}
