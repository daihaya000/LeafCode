import type { ReactNode } from "react";
import { GhostSelect } from "@/components/ui";

/**
 * GhostSelect のラッパー共通化（REFACTORING_PLAN P5-d / IMPROVEMENT 1-3）。
 * 固定 options を持つ選択 UI（アクセスモード / スキル / サブエージェント等）を
 * 1 つの実装で共有する。各ラッパーは options と表示メタデータのみを渡す。
 */
export interface PermissionOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export function PermissionGhostSelect<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className,
  ariaLabel,
  icon,
  tone,
}: {
  value: T;
  onChange: (value: T) => void;
  options: PermissionOption<T>[];
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
  icon: ReactNode;
  tone?: "default" | "warning";
}) {
  const current = options.find((o) => o.value === value);
  return (
    <GhostSelect
      value={value}
      disabled={disabled}
      title={current?.title}
      aria-label={ariaLabel}
      icon={icon}
      valueLabel={current?.label ?? value}
      tone={tone}
      onChange={(v) => onChange(v as T)}
      className={className}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </GhostSelect>
  );
}
