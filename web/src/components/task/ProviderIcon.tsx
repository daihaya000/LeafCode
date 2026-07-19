"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import { providerIconSrcForOpencodeId } from "@/lib/addons/codexbar";

/**
 * Brand icon for an OpenCode provider id (e.g. "anthropic", "openai",
 * "ollama-cloud"). Falls back to a generic CPU glyph when no bundled brand
 * icon matches or the image fails to load.
 */
export function ProviderIcon({
  providerID,
  className,
}: {
  providerID?: string;
  className?: string;
}) {
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
        className={className ?? "h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <Cpu
      aria-hidden="true"
      data-testid="provider-icon-fallback"
      className={className ?? "h-3.5 w-3.5 shrink-0"}
    />
  );
}
