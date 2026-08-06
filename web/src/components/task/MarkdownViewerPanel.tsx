"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, RefreshCw } from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { getJson } from "@/lib/client";
import { isImageFilePart } from "@/lib/message-parts";
import type { MessageWithParts } from "@/lib/types";
import { Markdown } from "./Markdown";

type Document = { name: string; content: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; document: Document }
  | { status: "error" };

const MD_EXT_RE = /\.md$/i;

function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function isAbsoluteFilePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(value);
}

/** Extract a Markdown file path from a part's text or filename, mirroring
 *  extractPlanMarkdownPath's acceptance rules (backtick-wrapped paths allowed)
 *  but dropping the agent="plan"/completed gating so any assistant-emitted
 *  .md path surfaces here. */
function partMarkdownPath(text?: string, filename?: string): string | null {
  const candidates: string[] = [];
  if (filename) candidates.push(filename);
  if (text) {
    let value = text.trim();
    if (value.startsWith("`") && value.endsWith("`") && value.length > 2) {
      value = value.slice(1, -1).trim();
    }
    if (value && !value.includes("\n") && MD_EXT_RE.test(value)) {
      candidates.push(value);
    }
  }
  for (const candidate of candidates) {
    if (isAbsoluteFilePath(candidate) && MD_EXT_RE.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export interface MarkdownViewerEntry {
  id: string;
  path: string;
  /** Stable relative label for display (basename). */
  name: string;
  /** Originating assistant message id (for stable ordering / dedupe). */
  messageId: string;
}

/** Collect assistant-submitted Markdown file paths from the session timeline.
 *  Image attachments are skipped (rendered inline elsewhere). The latest
 *  occurrence of each path wins, preserving the order of first appearance. */
export function collectMarkdownFiles(
  messages: MessageWithParts[],
): MarkdownViewerEntry[] {
  const seen = new Set<string>();
  const entries: MarkdownViewerEntry[] = [];
  for (const message of messages) {
    if (message.info.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "file" && part.type !== "text") continue;
      if (part.type === "file" && isImageFilePart(part)) continue;
      const path = partMarkdownPath(part.text, part.filename);
      if (!path) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      entries.push({
        id: `${message.info.id}:${part.id}`,
        path,
        name: basename(path),
        messageId: message.info.id,
      });
    }
  }
  return entries;
}

export function MarkdownViewerPanel({
  directory,
  messages,
}: {
  directory: string;
  messages: MessageWithParts[];
}) {
  const entries = useMemo(() => collectMarkdownFiles(messages), [messages]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const reqIdRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqIdRef.current += 1;
    };
  }, []);

  // Auto-select the first entry when the list populates or the selection
  // disappears (e.g. session switched, plan removed).
  useEffect(() => {
    if (entries.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (selectedPath && entries.some((e) => e.path === selectedPath)) return;
    setSelectedPath(entries[0]!.path);
  }, [entries, selectedPath]);

  const load = useCallback(
    async (path: string) => {
      const id = ++reqIdRef.current;
      setLoadState({ status: "loading" });
      try {
        const document = await getJson<Document>("/api/files/content", {
          directory,
          path,
        });
        if (!mountedRef.current || id !== reqIdRef.current) return;
        setLoadState({ status: "ready", document });
      } catch {
        if (!mountedRef.current || id !== reqIdRef.current) return;
        setLoadState({ status: "error" });
      }
    },
    [directory],
  );

  useEffect(() => {
    if (!selectedPath) {
      setLoadState({ status: "loading" });
      return;
    }
    void load(selectedPath);
  }, [selectedPath, load, reload]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-border bg-surface lg:border-l">
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="shrink-0 text-xs font-semibold text-muted">Markdown</span>
        <span className="min-w-2 flex-1" />
        <Button
          variant="ghost"
          size="icon"
          title="再読み込み"
          aria-label="Markdown を再読み込み"
          disabled={!selectedPath}
          className="h-9 w-9"
          onClick={() => setReload((v) => v + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 py-10 text-center text-xs text-faint">
          エージェントが提出した Markdown ファイルはありません
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <ul className="shrink-0 overflow-y-auto border-b border-border bg-surface-2/40 md:w-48 md:border-b-0 md:border-r">
            {entries.map((entry) => {
              const active = entry.path === selectedPath;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(entry.path)}
                    title={entry.path}
                    className={cx(
                      "flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs",
                      active
                        ? "bg-surface-3 text-text"
                        : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <ChevronRight
                      className={cx(
                        "h-3 w-3 shrink-0 text-faint transition-transform",
                        active && "rotate-90",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selectedPath && (
              <div className="shrink-0 border-b border-border px-3 py-1 font-mono text-[10px] text-faint">
                {selectedPath}
              </div>
            )}
            <div className="md min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3 text-[0.925rem]">
              {loadState.status === "loading" && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 text-sm text-muted"
                >
                  <span aria-hidden="true">
                    <Spinner />
                  </span>
                  読み込み中…
                </div>
              )}
              {loadState.status === "error" && (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert" className="text-sm text-danger">
                    読み込めませんでした
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setReload((v) => v + 1)}
                  >
                    再試行
                  </Button>
                </div>
              )}
              {loadState.status === "ready" && (
                <Markdown text={loadState.document.content} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}