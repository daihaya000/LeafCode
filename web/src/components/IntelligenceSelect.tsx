"use client";

import { Cpu } from "lucide-react";
import { GhostSelect } from "@/components/ui";
import type { IntelligenceVariant } from "@/lib/model-variants";

/**
 * Intelligence variant selector built on top of GhostSelect.
 *
 * Renders `デフォルト` plus the supplied variants in the order provided by
 * the caller (typically the model-specific list from
 * `getIntelligenceVariants`). The empty string represents `デフォルト` and
 * is omitted from request payloads by the caller.
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
      onChange={onChange}
      className="min-w-0"
    >
      <option value="">デフォルト</option>
      {variants.map((variant) => (
        <option key={variant} value={variant}>
          {variant}
        </option>
      ))}
    </GhostSelect>
  );
}
