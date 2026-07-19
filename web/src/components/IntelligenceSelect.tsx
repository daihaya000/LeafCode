"use client";

import { Cpu } from "lucide-react";
import { GhostSelect } from "@/components/ui";
import type { IntelligenceVariant } from "@/lib/model-variants";

/**
 * Intelligence variant selector built on top of GhostSelect.
 *
 * Renders `デフォルト` plus the supplied variants in fixed order
 * (`high` then `low`). The empty string represents `デフォルト` and is
 * omitted from request payloads by the caller.
 */
export function IntelligenceSelect({
  variants,
  value,
  onChange,
  disabled,
}: {
  variants: IntelligenceVariant[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <GhostSelect
      value={value}
      disabled={disabled}
      aria-label="インテリジェンス"
      icon={<Cpu className="h-3.5 w-3.5" />}
      valueLabel={value || "デフォルト"}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0"
    >
      <option value="">デフォルト</option>
      {variants.includes("high") && <option value="high">high</option>}
      {variants.includes("low") && <option value="low">low</option>}
    </GhostSelect>
  );
}