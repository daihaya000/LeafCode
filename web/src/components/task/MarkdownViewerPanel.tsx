"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, MessageSquare, RefreshCw } from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { getJson } from "@/lib/client";
import { isImageFilePart } from "@/lib/message-parts";
import type { MessageWithParts } from "@/lib/types";
import { Markdown } from "./Markdown";

type Document = { name: string; content: string };

type LoadState =
  | { status: "idle" }
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

function snippet(text: string, max = 24): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
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

export type MarkdownViewerEntry =
  | {
      kind: "file";
      id: string;
      /** Absolute path used as the selection key and to fetch content. */
      path: string;
      /** Stable relative label for display (basename). */
      name: string;
      /** Originating assistant message id. */
      messageId: string;
    }
  | {
      kind: "text";
      id: string;
      /** Synthetic key used as the selection key. */
      path: string;
      /** Short preview used as the list label. */
      name: string;
      /** Full Markdown text to render. */
      text: string;
      /** Originating assistant message id. */
      messageId: string;
    };

/** Collect assistant-submitted Markdown file paths and inline Markdown text
 *  parts from the session timeline. Image attachments are skipped. */
export function collectMarkdownEntries(
  messages: MessageWithParts[],
): MarkdownViewerEntry[] {
  const seenPaths = new Set<string>();
  const fileEntries: MarkdownViewerEntry[] = [];
  const textEntries: MarkdownViewerEntry[] = [];
  let textIndex = 0;
  for (const message of messages) {
    if (message.info.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type === "file" && isImageFilePart(part)) continue;
      const filePath = partMarkdownPath(part.text, part.filename);
      if (filePath) {
        if (seenPaths.has(filePath)) continue;
        seenPaths.add(filePath);
        fileEntries.push({
          kind: "file",
          id: `${message.info.id}:${part.id}`,
          path: filePath,
          name: basename(filePath),
          messageId: message.info.id,
        });
        continue;
      }
      if (part.type === "text") {
        const text = part.text?.trim() ?? "";
        // Only treat this text part as a standalone Markdown viewer entry if
        // it is a meaningful Markdown body (multi-line or has Markdown syntax).
        // Single-line bare paths that are not absolute .md files are ignored
        // because they are usually just inline references.
        if (!text) continue;
        if (partMarkdownPath(text)) continue; // handled as a file entry above
        const isMarkdownLike =
          text.includes("\n") ||
          /^\s*#{1,6}\s+/.test(text) ||
          /\*\*|__|`{1,3}|\[.*?\]\(.*?\)|^\s*[-*+]\s+/m.test(text);
        if (!isMarkdownLike) continue;
        textIndex += 1;
        textEntries.push({
          kind: "text",
          id: `${message.info.id}:${part.id}`,
          path: `__text__:${message.info.id}:${part.id}`,
          name: `メッセージ #${textIndex} — ${snippet(text)}`,
          text,
          messageId: message.info.id,
        });
      }
    }
  }
  return [...fileEntries, ...textEntries];
}

export function MarkdownViewerPanel({
  directory,
  messages,
}: {
  directory: string;
  messages: MessageWithParts[];
}) {
  const entries = useMemo(
    () => collectMarkdownEntries(messages),
    [messages],
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
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

  const selectedEntry = useMemo(
    () => entries.find((e) => e.path === selectedPath) ?? null,
    [entries, selectedPath],
  );

  const loadFile = useCallback(
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
    if (!selectedEntry) {
      setLoadState({ status: "idle" });
      return;
    }
    if (selectedEntry.kind === "text") {
      setLoadState({ status: "ready", document: { name: "", content: selectedEntry.text } });
      return;
    }
    void loadFile(selectedEntry.path);
  }, [selectedEntry, loadFile, reload]);

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
          disabled={!selectedPath || selectedEntry?.kind === "text"}
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
          <ul className="shrink-0 overflow-y-auto border-b border-border bg-surface-2/40 md:w-52 md:border-b-0 md:border-r">
            {entries.map((entry) => {
              const active = entry.path === selectedPath;
              const Icon = entry.kind === "text" ? MessageSquare : FileText;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(entry.path)}
                    title={entry.name}
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
                    <Icon
                      className={cx(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-text" : "text-faint",
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
            {selectedEntry?.kind === "file" && selectedPath && (
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
