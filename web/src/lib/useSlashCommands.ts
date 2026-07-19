"use client";

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
    const headers: HeadersInit = {};
    if (directory) headers["x-opencode-directory"] = directory;
    const url = directory
      ? `/api/opencode/command?directory=${encodeURIComponent(directory)}`
      : "/api/opencode/command";

    void fetch(url, { cache: "no-store", headers })
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
