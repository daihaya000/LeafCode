"use client";

import { Bell } from "lucide-react";
import { Badge } from "@/components/ui";
import { useOptionalGlobalAttention } from "./GlobalAttentionProvider";

export function AttentionBadge() {
  const ctx = useOptionalGlobalAttention();
  const count = ctx?.actionableItems.length ?? 0;
  if (!ctx || count === 0) return null;
  const { openNext } = ctx;
  return (
    <button
      type="button"
      onClick={() => openNext()}
      className="inline-flex h-8 items-center justify-center rounded-lg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      aria-label={`待機中の要求 ${count} 件`}
      title="待機中の要求"
    >
      <Badge tone="warning" pulse>
        <Bell className="h-3 w-3" />
        待機 {count}
      </Badge>
    </button>
  );
}
