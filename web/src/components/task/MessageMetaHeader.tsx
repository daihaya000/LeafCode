"use client";

import { Fragment } from "react";
import { cx, formatMessageTime } from "@/components/ui";
import { formatCost, type CostDisplayPrefs } from "@/lib/currency";
import type { MessageInfo } from "@/lib/types";
import { ProviderIcon } from "./ProviderIcon";

type MetaInfo = Pick<
  MessageInfo,
  "providerID" | "modelID" | "cost" | "time"
>;

export function MessageMetaHeader({
  info,
  modelLabel,
  effort,
  costPrefs,
  compact = false,
}: {
  info: MetaInfo;
  modelLabel?: string;
  effort?: string;
  costPrefs: CostDisplayPrefs;
  compact?: boolean;
}) {
  const model = modelLabel?.trim() || info.modelID?.trim() || "";
  const effortLabel = effort?.trim() || "";
  const cost =
    typeof info.cost === "number" && info.cost > 0
      ? formatCost(info.cost, costPrefs)
      : "";
  const time = formatMessageTime(info.time?.completed ?? info.time?.created);
  const fields = [
    model ? { key: "model", text: model } : null,
    effortLabel ? { key: "effort", text: `effort ${effortLabel}` } : null,
    time ? { key: "time", text: time } : null,
    cost ? { key: "cost", text: cost } : null,
  ].filter((field): field is { key: string; text: string } => field !== null);

  if (fields.length === 0) return null;

  return (
    <div
      aria-label="応答メタデータ"
      className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted"
    >
      <ProviderIcon
        key={info.providerID ?? "unknown"}
        providerID={info.providerID}
      />
      {fields.map((field, index) => (
        <Fragment key={field.key}>
          {index > 0 && <span aria-hidden="true">·</span>}
          <span
            className={cx(
              field.key === "model" && "min-w-0 truncate",
              field.key === "model" && (compact ? "max-w-40" : "max-w-64"),
              field.key !== "model" && "shrink-0",
            )}
            title={field.key === "model" ? field.text : undefined}
          >
            {field.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
