"use client";

import { Bell } from "lucide-react";
import { Badge } from "@/components/ui";
import { useGlobalAttention } from "./GlobalAttentionProvider";

export function AttentionBadge() {
  const { items, openNext } = useGlobalAttention();
  if (items.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openNext()}
      className="inline-flex h-8 items-center justify-center rounded-lg hover:bg-surface-2"
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
