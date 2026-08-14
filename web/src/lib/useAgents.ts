"use client";

import { timedFetch } from "@/lib/client";
import { directoryHeaders, withDirectoryQuery } from "@/lib/directory-header";
import { useEffect, useState } from "react";
import type { AgentMention } from "@/lib/agent-mention";
import type { AgentDto } from "@/lib/agent-utils";

type AgentListResponse = {
  agents: (AgentDto & { hidden?: boolean })[];
};

/**
 * Load the engine agent list for `@agent` autocomplete. Only agents the user
 * can delegate to are surfaced: hidden agents are filtered out, and when
 * `subagentOnly` is true only `mode === "subagent"` (or "all") agents are
 * returned — primary agents are invoked via the top-level selector instead.
 */
export function useAgents(
  directory?: string | null,
  options?: { subagentOnly?: boolean },
): AgentMention[] {
  const [agents, setAgents] = useState<AgentMention[]>([]);

  useEffect(() => {
    let cancelled = false;
    const headers: HeadersInit = directoryHeaders(directory);
    const base = new URL("/api/extensions/agents", window.location.origin);
    const url = withDirectoryQuery(base, directory).toString();

    void timedFetch(url, { headers })
      .then((res) => (res.ok ? res.json() : ({ agents: [] } as AgentListResponse)))
      .then((data: AgentListResponse) => {
        if (cancelled) return;
        const subagentOnly = options?.subagentOnly === true;
        const mentions = (data.agents ?? [])
          .filter((a) => !a.hidden)
          .filter((a) => (subagentOnly ? a.mode !== "primary" : true))
          .map((a) => ({
            name: a.name,
            label: a.name,
            ...(a.description ? { description: a.description } : {}),
            ...(a.mode ? { mode: a.mode } : {}),
          }));
        setAgents(mentions);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });

    return () => {
      cancelled = true;
    };
    }, [directory, options?.subagentOnly]);

  return agents;
}