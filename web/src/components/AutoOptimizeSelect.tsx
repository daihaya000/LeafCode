"use client";

import { Gauge } from "lucide-react";
import { GhostSelect } from "@/components/ui";
import {
  AUTO_OPTIMIZE_MODES,
  autoOptimizeModeLabel,
  isAutoOptimizeMode,
  type AutoOptimizeMode,
} from "@/lib/auto-model";

/**
 * "Optimize For" selector for the Auto model mode, mirroring Cursor Router.
 *
 * Rendered in the composer toolbar in place of {@link IntelligenceSelect}:
 * Auto decides the reasoning effort itself, so the two controls are mutually
 * exclusive and share the same slot.
 */
export function AutoOptimizeSelect({
  value,
  onChange,
  disabled,
}: {
  value: AutoOptimizeMode;
  onChange: (value: AutoOptimizeMode) => void;
  disabled: boolean;
}) {
  return (
    <GhostSelect
      value={value}
      disabled={disabled}
      aria-label="Auto の最適化"
      icon={<Gauge className="h-3.5 w-3.5" />}
      valueLabel={autoOptimizeModeLabel(value)}
      onChange={(next) => {
        // GhostSelect is untyped; ignore anything outside the known modes
        // instead of widening the caller's state to `string`.
        if (isAutoOptimizeMode(next)) onChange(next);
      }}
      className="h-8 shrink-0"
    >
      {AUTO_OPTIMIZE_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {autoOptimizeModeLabel(mode)}
        </option>
      ))}
    </GhostSelect>
  );
}
