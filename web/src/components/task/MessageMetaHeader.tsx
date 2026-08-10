"use client";

import { Fragment } from "react";
import { formatTokens } from "@addons/codexbar";
import { cx, formatMessageTime } from "@/components/ui";
import { formatCostValue, type CostDisplayPrefs } from "@/lib/currency";
import { estimateOpenAIApiCost } from "@/lib/openai-pricing";
import type { MessageInfo } from "@/lib/types";
import { formatElapsed } from "@/lib/useSessionStream";
import { ProviderIcon } from "./ProviderIcon";

type MetaInfo = Pick<
  MessageInfo,
  "providerID" | "modelID" | "cost" | "time" | "tokens"
>;

function thinkingDuration(info: MetaInfo): number | null {
  const created = info.time?.created;
  const completed = info.time?.completed;
  if (typeof created !== "number" || typeof completed !== "number") return null;
  const seconds = Math.max(0, Math.round((completed - created) / 1000));
  return seconds > 0 ? seconds : null;
}

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
  const reportedCost =
    typeof info.cost === "number" && info.cost > 0 ? info.cost : null;
  const estimatedCost = reportedCost === null ? estimateOpenAIApiCost(info) : null;
  const cost = reportedCost !== null
    ? formatCostValue(reportedCost, costPrefs)
    : estimatedCost !== null
      ? formatCostValue(estimatedCost, costPrefs)
      : "";
  const time = formatMessageTime(info.time?.completed ?? info.time?.created);
  const thinking = thinkingDuration(info);
  // `total` is the context snapshot for this turn. Show only tokens generated
  // by this response so the per-message metadata does not look cumulative.
  const tokens = info.tokens
    ? Math.max(0, info.tokens.output ?? 0) + Math.max(0, info.tokens.reasoning ?? 0)
    : 0;
  const fields = [
    model ? { key: "model", text: model } : null,
    effortLabel ? { key: "effort", text: effortLabel } : null,
    time ? { key: "time", text: time } : null,
    cost ? { key: "cost", text: `コスト ${cost}` } : null,
    tokens > 0 ? { key: "tokens", text: `トークン ${formatTokens(tokens)}` } : null,
    thinking != null
      ? { key: "thinking", text: `思考 ${formatElapsed(thinking)}` }
      : null,
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
