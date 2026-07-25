"use client";

import { timedFetch } from "@/lib/client";
import { directoryHeaders, withDirectoryQuery } from "@/lib/directory-header";
import { useEffect, useState } from "react";
import {
  normalizeCommands,
  type SlashCommand,
} from "@/lib/slash-command";

/** Load OpenCode slash commands (skills + commands) for autocomplete. */
export function useSlashCommands(directory?: string | null): SlashCommand[] {
  const [commands, setCommands] = useState<SlashCommand[]>([]);

  useEffect(() => {
    let cancelled = false;
    const headers: HeadersInit = directoryHeaders(directory);
    const base = new URL("/api/opencode/command", window.location.origin);
    const url = withDirectoryQuery(base, directory).toString();

    void timedFetch(url, { headers })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (!cancelled) setCommands(normalizeCommands(data));
      })
      .catch(() => {
        if (!cancelled) setCommands([]);
      });

    return () => {
      cancelled = true;
    };
  }, [directory]);

  return commands;
}
