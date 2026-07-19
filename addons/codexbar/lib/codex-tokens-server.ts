import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  lastTokenUsageFromText,
  sumUsage,
  zeroUsage,
  type CodexTokensResult,
  type TokenUsage,
} from "./codex-tokens";

const MAX_FILES = 300;
const MAX_FILE_BYTES = 64 * 1024 * 1024; // skip absurdly large files

type CacheEntry = { mtimeMs: number; size: number; usage: TokenUsage | null };
const cache = new Map<string, CacheEntry>();

function sessionsDir(): string {
  const override = process.env.OPENCODE_WEBUI_CODEX_SESSIONS;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".codex", "sessions");
}

async function listJsonl(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/** Aggregate cumulative Codex token usage across sessions touched in the window. */
export async function aggregateCodexTokens(days: number): Promise<CodexTokensResult> {
  const generatedAt = new Date().toISOString();
  const base: Omit<CodexTokensResult, "available" | "reason" | "sessions" | "totals"> = {
    days,
    generatedAt,
  };
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const dir = sessionsDir();

  const files = await listJsonl(dir);
  if (files.length === 0) {
    return {
      ...base,
      available: false,
      reason: "Codex セッションログが見つかりません",
      sessions: 0,
      totals: zeroUsage(),
    };
  }

  const stats: { file: string; mtimeMs: number; size: number }[] = [];
  for (const file of files) {
    try {
      const s = await fs.stat(file);
      if (s.mtimeMs >= sinceMs) {
        stats.push({ file, mtimeMs: s.mtimeMs, size: s.size });
      }
    } catch {
      /* ignore */
    }
  }
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const selected = stats.slice(0, MAX_FILES);

  const usages: TokenUsage[] = [];
  for (const { file, mtimeMs, size } of selected) {
    if (size > MAX_FILE_BYTES) continue;
    const cached = cache.get(file);
    let usage: TokenUsage | null;
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      usage = cached.usage;
    } else {
      let text: string;
      try {
        text = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      usage = lastTokenUsageFromText(text);
      cache.set(file, { mtimeMs, size, usage });
    }
    if (usage) usages.push(usage);
  }

  return {
    ...base,
    available: true,
    reason: null,
    sessions: usages.length,
    totals: sumUsage(usages),
  };
}
