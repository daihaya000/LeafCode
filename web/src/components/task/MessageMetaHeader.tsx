"use client";

import { Fragment, useState } from "react";
import { Cpu } from "lucide-react";
import { cx, formatMessageTime } from "@/components/ui";
import { formatCost, type CostDisplayPrefs } from "@/lib/currency";
import { providerIconSrcForOpencodeId } from "@/lib/plugins/codexbar";
import type { MessageInfo } from "@/lib/types";

type MetaInfo = Pick<
  MessageInfo,
  "providerID" | "modelID" | "cost" | "time"
>;

function ProviderIcon({ providerID }: { providerID?: string }) {
  const src = providerIconSrcForOpencodeId(providerID ?? "");
  const [broken, setBroken] = useState(false);

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <Cpu
      aria-hidden="true"
      data-testid="provider-icon-fallback"
      className="h-3.5 w-3.5 shrink-0"
    />
  );
}

export function MessageMetaHeader({
  info,
  modelLabel,
  costPrefs,
  compact = false,
}: {
  info: MetaInfo;
  modelLabel?: string;
  costPrefs: CostDisplayPrefs;
  compact?: boolean;
}) {
  const model = modelLabel?.trim() || info.modelID?.trim() || "";
  const cost =
    typeof info.cost === "number" && info.cost > 0
      ? formatCost(info.cost, costPrefs)
      : "";
  const time = formatMessageTime(info.time?.completed ?? info.time?.created);
  const fields = [
    model ? { key: "model", text: model } : null,
    cost ? { key: "cost", text: cost } : null,
    time ? { key: "time", text: time } : null,
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
