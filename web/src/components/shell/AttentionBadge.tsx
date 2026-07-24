"use client";

import { Bell } from "lucide-react";
import { Badge } from "@/components/ui";
import { useOptionalGlobalAttention } from "./GlobalAttentionProvider";

export function AttentionBadge() {
  const ctx = useOptionalGlobalAttention();
  if (!ctx || ctx.items.length === 0) return null;
  const { items, openNext } = ctx;
  return (
    <button
      type="button"
      onClick={() => openNext()}
      className="inline-flex h-8 items-center justify-center rounded-lg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      aria-label={`待機中の要求 ${items.length} 件`}
      title="待機中の要求"
    >
      <Badge tone="warning" pulse>
        <Bell className="h-3 w-3" />
        待機 {items.length}
      </Badge>
    </button>
  );
}
